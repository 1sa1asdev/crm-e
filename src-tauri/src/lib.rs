use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use tauri::Emitter;

const MS_TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MS_GRAPH_ME: &str = "https://graph.microsoft.com/v1.0/me";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO: &str = "https://www.googleapis.com/oauth2/v2/userinfo";

#[derive(serde::Serialize, Clone)]
struct OAuthTokens {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    user_email: String,
    provider: String,
}

#[tauri::command]
fn start_oauth_listener(
    app: tauri::AppHandle,
    verifier: String,
    provider: String,
    client_id: String,
    client_secret: String,
) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://localhost:{}", port);

    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = vec![0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);

            let code = req.lines().next().and_then(|line| {
                let path = line.split_whitespace().nth(1)?;
                let query = path.split('?').nth(1)?;
                query
                    .split('&')
                    .find(|p| p.starts_with("code="))
                    .map(|p| urlencoding_decode(&p[5..]))
            });

            let (body, success) = if code.is_some() {
                ("<html><head><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f1419;color:#e5e9f0}</style></head><body><h2>&#x2713; Connected &mdash; you can close this window</h2></body></html>", true)
            } else {
                ("<html><body>Authentication failed &mdash; you can close this window</body></html>", false)
            };

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());

            if success {
                if let Some(code) = code {
                    let app_clone = app.clone();
                    let verifier_clone = verifier.clone();
                    let redirect_uri_clone = redirect_uri.clone();
                    let provider_clone = provider.clone();
                    let client_id_clone = client_id.clone();
                    let client_secret_clone = client_secret.clone();
                    std::thread::spawn(move || {
                        match exchange_code(code, verifier_clone, redirect_uri_clone, provider_clone, client_id_clone, client_secret_clone) {
                            Ok(tokens) => { let _ = app_clone.emit("oauth_tokens", tokens); }
                            Err(e) => { let _ = app_clone.emit("oauth_error", e); }
                        }
                    });
                }
            }
        }
    });

    Ok(port)
}

fn exchange_code(code: String, verifier: String, redirect_uri: String, provider: String, client_id: String, client_secret: String) -> Result<OAuthTokens, String> {
    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    rt.block_on(async {
        let client = reqwest::Client::new();

        if provider == "google" {
            let mut params = HashMap::new();
            params.insert("client_id", client_id.as_str());
            params.insert("client_secret", client_secret.as_str());
            params.insert("code", code.as_str());
            params.insert("redirect_uri", redirect_uri.as_str());
            params.insert("code_verifier", verifier.as_str());
            params.insert("grant_type", "authorization_code");

            let res = client
                .post(GOOGLE_TOKEN_URL)
                .form(&params)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            let status = res.status();
            let json: serde_json::Value = res.json().await.map_err(|e| {
                format!("Failed to parse response: {}. Status: {}", e, status)
            })?;

            if let Some(err) = json.get("error") {
                let desc = json.get("error_description")
                    .and_then(|v| v.as_str())
                    .unwrap_or_else(|| err.as_str().unwrap_or("unknown error"));
                return Err(format!("{}: {}", err, desc));
            }

            let access_token = json["access_token"].as_str().ok_or("missing access_token")?.to_string();
            let refresh_token = json["refresh_token"].as_str().unwrap_or("").to_string();
            let expires_in = json["expires_in"].as_u64().unwrap_or(3600);

            let user_email = client
                .get(GOOGLE_USERINFO)
                .bearer_auth(&access_token)
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json::<serde_json::Value>()
                .await
                .map_err(|e| e.to_string())?
                .get("email")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            return Ok(OAuthTokens { access_token, refresh_token, expires_in, user_email, provider: "google".to_string() });
        }

        // Microsoft / Outlook
        let mut params = HashMap::new();
        params.insert("client_id", client_id.as_str());
        params.insert("code", code.as_str());
        params.insert("redirect_uri", redirect_uri.as_str());
        params.insert("code_verifier", verifier.as_str());
        params.insert("grant_type", "authorization_code");

        let res = client
            .post(MS_TOKEN_URL)
            .form(&params)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

        if let Some(err) = json.get("error") {
            let desc = json.get("error_description")
                .and_then(|v| v.as_str())
                .unwrap_or_else(|| err.as_str().unwrap_or("unknown error"));
            return Err(desc.to_string());
        }

        let access_token = json["access_token"].as_str().ok_or("missing access_token")?.to_string();
        let refresh_token = json["refresh_token"].as_str().unwrap_or("").to_string();
        let expires_in = json["expires_in"].as_u64().unwrap_or(3600);

        let me_res = client
            .get(MS_GRAPH_ME)
            .bearer_auth(&access_token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let me: serde_json::Value = me_res.json().await.map_err(|e| e.to_string())?;
        let user_email = me.get("mail")
            .or_else(|| me.get("userPrincipalName"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        Ok(OAuthTokens { access_token, refresh_token, expires_in, user_email, provider: "microsoft".to_string() })
    })
}

fn urlencoding_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.bytes().peekable();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next().unwrap_or(b'0');
            let h2 = chars.next().unwrap_or(b'0');
            if let Ok(decoded) = u8::from_str_radix(&format!("{}{}", h1 as char, h2 as char), 16) {
                result.push(decoded as char);
            }
        } else if b == b'+' {
            result.push(' ');
        } else {
            result.push(b as char);
        }
    }
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![start_oauth_listener])
        .run(tauri::generate_context!())
        .expect("error while running crm-e");
}
