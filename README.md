# crm-e

> A desktop app for tracking job applications, managing email outreach, and never losing track of who you've contacted.

Built with Tauri + React. Your data lives entirely on your machine — no cloud, no subscriptions.

---

## What it does

crm-e is a personal CRM for your job search. You track every application in one place, compose and send emails directly from the app, sync replies, and let AI summarise what stage each conversation is at.

```
┌─────────────────────────────────────────────────────────────────┐
│                         CRM-E DESKTOP                           │
│                                                                 │
│  Applications  │  Templates  │  Files  │  Leads  │  Profile    │
│────────────────┼─────────────┼─────────┼─────────┼─────────────│
│                                                                 │
│  Spotify ──────── Frontend Dev ── Interview ── 📧 Sync         │
│  Klarna ───────── iOS Engineer ── Applied ──── 📧 Sync         │
│  Bolt ─────────── Backend Dev ─── Draft ─────── ✏ Compose      │
│  King ──────────── Game Dev ────── Rejected ─── 📧 Sync        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core features

| Feature | What it does |
|---|---|
| **Application tracking** | Log every company, role, contact, status, dates and notes |
| **Email compose** | Send templated emails directly via Gmail or Outlook |
| **Email sync** | Pull full reply threads back into the app |
| **AI analysis** | Classifies emails automatically — rejection, interview, offer |
| **Templates** | Reusable email bodies and cover letters with live placeholders |
| **Cover letter PDF** | Generate and attach a PDF cover letter from a template |
| **File attachments** | Attach your CV, portfolio docs to outgoing emails |
| **Follow-up reminders** | Set a date — get a banner reminder when it's due |
| **Views / Intentions** | Group applications by keyword, status, or label |
| **Leads** | Separate contact list for recruiters and networking |
| **Local storage** | Everything saved to SQLite on your own machine |

---

## Email providers

This is the most important thing to understand before setting up crm-e.

```
┌─────────────────────────────────────────────────┐
│               EMAIL PROVIDER STATUS             │
│                                                 │
│   ✅  OUTLOOK / MICROSOFT 365                  │
│       Available to every user                   │
│       No limits — sign in with any              │
│       Microsoft or work account                 │
│                                                 │
│   ⚠️  GMAIL                                    │
│       Limited to 100 users total               │
│       While Google OAuth review is pending     │
│       After approval → unlimited               │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Why the Gmail limit?

crm-e sends email on your behalf using Google's official OAuth 2.0 flow — the same mechanism used by every reputable email client. Google requires apps that access Gmail to go through a verification process before they can serve more than 100 users. That review is in progress.

**What this means for you:**

```
Gmail early access (first 100 users)
─────────────────────────────────────
You log in → Google shows "unverified app" warning
You click "Continue anyway" → it works fully
All email stays in your actual Gmail inbox
Threading, replies, attachments — everything works

Gmail after the limit (user 101+)
───────────────────────────────────
Login is blocked until Google completes the review
Outlook works without any restrictions in the meantime
```

### Recommended setup

If you want to start right now with no friction, **connect Outlook**. It works for anyone, there is no review process, and the feature set is identical.

```
┌─────────────┐     OAuth PKCE      ┌──────────────────────┐
│             │ ──────────────────► │  Microsoft login page │
│   crm-e     │ ◄────────────────── │  (your browser)       │
│             │    access token     └──────────────────────┘
│  (desktop)  │
│             │   Microsoft Graph   ┌──────────────────────┐
│             │ ──────────────────► │  your Outlook inbox  │
│             │ ◄────────────────── │  send / sync / reply │
└─────────────┘                     └──────────────────────┘
```

---

## Application lifecycle

Every application moves through a set of statuses. crm-e can suggest status changes automatically based on email content.

```
                       ┌─────────┐
                       │  DRAFT  │  ← you created it, haven't sent yet
                       └────┬────┘
                            │  send email via Compose
                            ▼
                       ┌─────────┐
                       │ APPLIED │  ← email sent, waiting for a reply
                       └────┬────┘
                            │  they reply
                            ▼
                       ┌─────────┐
                       │ REPLIED │  ← generic reply, no clear next step
                       └────┬────┘
               ┌────────────┼────────────┐
               ▼            ▼            ▼
         ┌──────────┐  ┌────────┐  ┌──────────┐
         │INTERVIEW │  │ OFFER  │  │ REJECTED │
         └──────────┘  └────────┘  └──────────┘

         GHOSTED ← set manually if no reply after your follow-up date
```

---

## How email sync works

```
You click "Sync from Outlook / Gmail"
           │
           ▼
crm-e fetches every message in the tracked thread(s)
           │
           ├── Stores full email body (not just a snippet)
           ├── Detects direction (sent by you vs received)
           └── Classifies each message:
                    │
                    ├── "offer"      → keywords: offer, employment agreement…
                    ├── "rejection"  → keywords: unfortunately, tyvärr, inte gå vidare…
                    ├── "interview"  → keywords: schedule, availability, Calendly…
                    └── "incoming"   → everything else from the other side

           │
           ▼
  If OpenRouter key is set → AI reads the full thread
           │
           ├── Suggests a status update
           └── Writes a 1-2 sentence summary of where things stand
```

---

## Templates and placeholders

Templates live under the **Templates** tab. You can write email templates and cover letters once and reuse them across every application.

### Available placeholders

**Application data**
```
{{company}}       The company name
{{role}}          The job title
{{contact_name}}  Recruiter / hiring manager name
{{files}}         Names of attached files
```

**Your profile**
```
{{my_name}}       First name
{{my_last_name}}  Last name
{{my_full_name}}  Full name
{{my_email}}      Email address
{{my_phone}}      Phone number
{{my_address}}    Street, city, postal code, country
{{my_linkedin}}   LinkedIn URL
```

**Custom links** (set up in Profile → Custom links)
```
{{my_link_github}}     your GitHub URL
{{my_link_portfolio}}  your portfolio URL
{{my_link_dribbble}}   … and so on for every link you add
```

When you open Compose or Reply and pick a template, every `{{placeholder}}` is substituted with your real data before the email is sent.

---

## Cover letters

Cover letters are a special template type — they get their own editor and a live A4 preview as you type.

```
┌──────────────────────────────────────────────┐
│  Cover letter editor         │  A4 preview   │
│                              │               │
│  Hi {{contact_name}},        │  Hi Jane,     │
│                              │               │
│  I'm applying for the        │  I'm applying │
│  {{role}} role at            │  for the SWE  │
│  {{company}}…                │  role at Acme │
│                              │               │
│  [Attach as PDF] button ────────────────────►│
│                              │               │
└──────────────────────────────────────────────┘
```

Click **Attach as PDF** and the cover letter is generated with jsPDF and attached automatically to your outgoing email.

---

## AI email analysis

crm-e integrates with [OpenRouter](https://openrouter.ai) so you can use any LLM to classify your email threads.

**Setup** (Settings → AI)
1. Create a free account at openrouter.ai
2. Generate an API key
3. Paste it into crm-e — pick any model (e.g. `mistralai/mistral-7b-instruct` is fast and cheap)

**What it does**
```
After every sync, if a key is configured:

Your email thread
       │
       ▼
┌─────────────────────────────────────────┐
│  AI reads the full conversation         │
│  (not just the latest message)          │
│                                         │
│  Returns:                               │
│    status  → draft / applied / replied  │
│              interview / offer /        │
│              rejected / ghosted         │
│                                         │
│    comment → 1-2 sentence summary       │
│              "They asked for a second   │
│               interview next Tuesday"   │
└─────────────────────────────────────────┘
       │
       ▼
crm-e shows a suggestion banner — you click Apply or Dismiss
```

No data is sent to Anthropic or any crm-e server. Your emails go directly from your machine to OpenRouter and back.

---

## File attachments

Upload your CV, portfolio, and other documents once under the **Files** tab. They are stored locally (as base64 in your database). When composing, tick the ones you want to attach — they are embedded in the MIME email and land in the recipient's inbox as regular file attachments.

Supported types: PDF, Word (.doc, .docx), images (JPEG, PNG, GIF, WebP), plain text.

---

## Follow-up reminders

Set a **Follow-up date** on any application (in the Edit dialog). When that date arrives, a yellow banner appears at the top of the Applications tab:

```
⏰ Follow up with Spotify — Frontend Dev    [Open emails]  [Dismiss]
```

Sending or replying to an email automatically clears the reminder.

---

## Data storage

Everything is stored in a SQLite database on your own machine:

```
Windows   C:\Users\<you>\AppData\Roaming\com.crme.app\crm-data.db
macOS     ~/Library/Application Support/com.crme.app/crm-data.db
```

No account required. No data ever leaves your machine except the emails you explicitly send and the thread syncs you trigger. OAuth tokens are stored in the same local database.

---

## Getting started

1. Download the installer from the [Releases](https://github.com/1sa1asdev/crm-e/releases) page
2. Install and open crm-e
3. Go to **Settings** and connect Outlook (recommended) or Gmail
4. Go to **Profile** and fill in your name, phone, address and any custom links
5. Go to **Templates** and create your first email template
6. Go to **Applications** and click **+ New**

---

## Installing on Windows — bypassing SmartScreen

Because crm-e is not yet signed with a paid Microsoft certificate, Windows will show a SmartScreen warning the first time you run the installer. The app is safe — here is how to get past it:

1. Double-click the downloaded `.msi` or `.exe` installer
2. Windows shows **"Windows protected your PC"**
3. Click **"More info"** (bottom-left of the dialog)
4. A **"Run anyway"** button appears — click it
5. The installer proceeds normally

```
┌──────────────────────────────────────────┐
│  Windows protected your PC               │
│                                          │
│  Microsoft Defender SmartScreen          │
│  prevented an unrecognised app from      │
│  starting.                               │
│                                          │
│  > More info          Don't run          │
└──────────────────────────────────────────┘
             ↓ after clicking More info
┌──────────────────────────────────────────┐
│  App: crm-e                              │
│  Publisher: Unknown                      │
│                                          │
│  > Run anyway         Don't run          │
└──────────────────────────────────────────┘
```

---

## Installing on macOS — bypassing Gatekeeper

macOS will block the app on first open because crm-e is not notarised with an Apple Developer certificate yet. Here is how to allow it:

1. Double-click the downloaded `.dmg` and drag crm-e to your Applications folder
2. Try to open crm-e — macOS will block it with a warning
3. Open **System Settings → Privacy & Security**
4. Scroll down to the **Security** section
5. You will see **"crm-e was blocked from use because it is not from an identified developer"**
6. Click **"Open Anyway"**
7. Confirm in the dialog that appears

```
┌──────────────────────────────────────────┐
│  Privacy & Security                      │
│                                          │
│  Security                                │
│                                          │
│  "crm-e" was blocked from use because   │
│  it is not from an identified developer. │
│                                          │
│                       [ Open Anyway ]  ◄─┘
└──────────────────────────────────────────┘
```

> These warnings appear because code-signing certificates cost money and require annual renewal. crm-e is fully open source — you can read every line of code at [github.com/1sa1asdev/crm-e](https://github.com/1sa1asdev/crm-e) before running it.

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) (Rust) |
| UI | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Storage | SQLite via tauri-plugin-sql |
| Email (Gmail) | Gmail API — OAuth 2.0 PKCE |
| Email (Outlook) | Microsoft Graph API — OAuth 2.0 PKCE |
| AI | OpenRouter (any LLM, user-supplied key) |
| PDF generation | jsPDF |
| Auto-update | tauri-plugin-updater |
