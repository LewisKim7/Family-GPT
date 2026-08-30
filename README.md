# Family GPT / Luna Chat

A minimal ChatGPT-style web client that uses the ChatGPT account's Codex entitlement with `gpt-5.6-luna` fixed as the model.

## Authentication

This version does **not** require a browser extension and does **not** use an OpenAI API key.

It follows Codex's device-code authentication flow:

1. The site requests a one-time device code from OpenAI.
2. The user approves that code at `https://auth.openai.com/codex/device`.
3. The server exchanges the approval for Codex OAuth tokens.
4. Tokens are kept in `HttpOnly`, `Secure`, `SameSite=Strict` cookies in that browser.
5. Access tokens are refreshed with the refresh token when needed.

The public Codex OAuth client ID is used by the server. A device user code is never hard-coded because OpenAI issues it per login and it expires after about 15 minutes.

## Data

- No database.
- Conversation history is stored only in browser `localStorage`.
- OAuth tokens are not committed to GitHub and are not exposed to client JavaScript.
- No Vercel environment variable or OpenAI API key is required.

## Model

`gpt-5.6-luna` only.

## Local development

```bash
npm install
npm run dev
```

## Deployment

Standard Next.js deployment on Vercel.
