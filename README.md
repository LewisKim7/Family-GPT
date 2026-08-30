# Family GPT

A lightweight ChatGPT-style personal/family web client backed by a single ChatGPT Plus Codex session.

## Default experience

```text
GPT-5.6 Terra      default / balanced
GPT-5.6 Luna       fast / quota-saving
GPT-5.6 Sol        deep / higher usage
Web Search         automatic by default, user-toggleable
```

The server whitelists the three GPT-5.6 Codex models. Client-supplied arbitrary model IDs are ignored.

Reasoning is intentionally kept at `medium` for all three modes so the app stays useful without unnecessarily burning the Plus 5-hour and weekly allowances. Native OpenAI/Codex web search uses a low search-context size on Luna and medium on Terra/Sol. The system prompt tells the model to search only when current or externally verifiable information is actually needed.

The UI shows the existing Codex 5-hour/weekly usage meters. When usage reaches 75%, it recommends switching to Luna rather than silently changing the user's model.

## Architecture

```text
Owner: one-time ChatGPT Codex device login
        -> shared Codex session in Vercel Runtime Cache
        -> browser HttpOnly backup for cache-loss recovery
        -> fixed family PIN policy

Family browser
        -> family PIN once
        -> HttpOnly family-access cookie
        -> /api/chat
        -> shared Codex session
        -> Terra / Luna / Sol
        -> optional native Codex web search
```

No OpenAI API key, Supabase, Neon, or application database is used. Conversation history stays in each browser's `localStorage` and is capped at 200 local threads. Up to 200 recent user/assistant messages can be sent as conversational context, with an additional total-size guard.

## Codex usage UI

The sidebar reads Codex rate-limit usage from the same endpoint used by Codex itself:

```text
GET https://chatgpt.com/backend-api/wham/usage
```

The response is cached for 60 seconds to avoid unnecessary usage checks.

## Security

- The ChatGPT OAuth refresh token is never committed to GitHub.
- Authorized browsers keep an HttpOnly backup so the shared session can be rebuilt if Vercel Runtime Cache is evicted.
- The plaintext family PIN is not committed to GitHub.
- Family access uses a random server-side access secret and an HttpOnly cookie.
- The family PIN is protected by an online attempt limit of 5 failures per 10 minutes per client fingerprint.
- `잠금` clears that browser's family access and OAuth backup; it does not intentionally revoke the owner's OpenAI account.
- The server accepts only `luna`, `terra`, or `sol` mode keys and maps them to fixed model IDs.

## Development

```bash
npm install
npm run dev
```

The shared-session Runtime Cache portion is intended for Vercel production/preview deployments.
