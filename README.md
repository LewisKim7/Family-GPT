# Family GPT

A minimal ChatGPT-style personal/family web client backed by a single ChatGPT Plus Codex session and fixed to `gpt-5.6-luna`.

## Architecture

```text
Owner: one-time ChatGPT Codex device login
        -> shared Codex session in Vercel Runtime Cache
        -> fixed family PIN policy

Family browser
        -> family PIN once
        -> HttpOnly family-access cookie
        -> /api/chat
        -> shared Codex session
        -> gpt-5.6-luna
```

No OpenAI API key, Supabase, Neon, or application database is used. Conversation history stays in each browser's `localStorage` and is capped at 200 local threads. Up to 200 recent user/assistant messages can be sent as conversational context, with an additional total-size guard.

The shared OAuth session is held in Vercel Runtime Cache with a 30-day TTL and lightly touched while active. Access-token refreshes update the shared cache automatically. The family PIN policy is stored separately in Runtime Cache as a salted scrypt hash so the plaintext PIN is not committed to this public repository. If the shared Codex cache expires or the refresh token becomes invalid, the owner reconnects ChatGPT once and the stored PIN policy is reused when available.

## Codex usage UI

The sidebar reads Codex rate-limit usage from the same endpoint used by Codex itself:

```text
GET https://chatgpt.com/backend-api/wham/usage
```

The response is cached for 60 seconds to avoid unnecessary usage checks.

## Security

- The ChatGPT OAuth refresh token is never committed to GitHub or sent to the browser after setup.
- The plaintext family PIN is not committed to GitHub.
- Family access uses a random server-side access secret stored only in Runtime Cache and an HttpOnly cookie.
- The family PIN is protected by an online attempt limit of 5 failures per 10 minutes per client fingerprint.
- `잠금` clears only that browser's family-access cookie; it does not disconnect the shared owner session.

## Development

```bash
npm install
npm run dev
```

The Runtime Cache portion is intended for Vercel production/preview deployments.
