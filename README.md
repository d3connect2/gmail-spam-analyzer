# Gmail Spam Analyzer

Web app (HTML, CSS, JavaScript + Node backend) that uses your Gmail credentials (email + app password) to:

- Read **unread** emails from the **Spam** folder
- Extract **Return-Path domain** and **PTR domain** from the `Received` header
- **Mark each checked email as read**
- Show results only for those previously unread spam messages

## Requirements

- Node.js 16+
- Gmail account with **App Password** (not your normal password)

### Gmail App Password

1. Enable 2-Step Verification on your Google account.
2. Go to [Google App Passwords](https://myaccount.google.com/apppasswords).
3. Create an app password for “Mail” and use that 16-character password in the app.

## Setup

```bash
cd gmail-spam-analyzer
npm install
npm start
```

Open **http://localhost:3000** in your browser.

## Usage

1. Enter your **Gmail address** and **App Password**.
2. Click **Fetch unread spam**.
3. The app connects via IMAP, opens `[Gmail]/Spam`, fetches only **UNSEEN** messages, parses each one, **marks them as read**, and returns:
   - **Return-Path domain** – domain from the `Return-Path` header (e.g. `bounce@example.com` → `example.com`)
   - **PTR domain** – hostname/domain taken from the `Received` header(s) (sender-side hop)
4. Results are shown in a table; only the unread spam that was just processed is included.

## Tech

- **Frontend:** HTML, CSS, vanilla JavaScript
- **Backend:** Node.js, Express
- **IMAP:** `imap` + `mailparser` for Gmail (Spam folder, UNSEEN, mark as read)

## Deploy on Vercel

The project is set up for Vercel: static files at root and the API as a serverless function at `/api/spam`.

**Option A – Deploy with Vercel CLI**

```bash
cd gmail-spam-analyzer
npm i -g vercel
vercel
```

Follow the prompts (link to your Vercel account, project name). Your app will be at `https://your-project.vercel.app`.

**Option B – Deploy from GitHub**

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com) → **Add New** → **Project**.
3. Import the `gmail-spam-analyzer` repo.
4. Leave **Build Command** and **Output Directory** empty (Vercel will serve root + `/api`).
5. Click **Deploy**.

**Note:** The `/api/spam` function has a 60s timeout (Pro plan). On the Hobby plan the limit is 10s; if IMAP is slow, use local `npm start` or upgrade.

## Security

- Credentials are sent to the server (or Vercel function) and from there to Gmail’s IMAP. On Vercel they are not stored.
- Use HTTPS (Vercel provides it). Prefer a dedicated Gmail App Password.
