/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AZURE_CLIENT_ID: string
  readonly VITE_GMAIL_CLIENT_ID: string
  readonly VITE_GMAIL_CLIENT_SECRET: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
