# Family GPT

A lightweight ChatGPT-style personal/family web client backed by a single ChatGPT Plus Codex session.

## Default experience

```text
Auto               default; routes each prompt without an extra model call
  -> GPT-5.6 Luna   lightweight / quota-saving work
  -> GPT-5.6 Terra  normal balanced work
  -> GPT-5.6 Sol    genuinely difficult work
Web Search          automatic by default, user-toggleable
```

Parents and other non-technical users can simply leave the model control on **Auto**. Luna and Sol remain available as explicit manual overrides.

The automatic router is deterministic and local to the server; it does not call a separate classifier model, so routing itself consumes no additional ChatGPT Plus/Codex inference allowance. It considers the latest prompt shape and the already-available Codex 5-hour/weekly usage snapshot:

- Normal everyday questions -> Terra.
- Short translation, correction, summarization, simple calculation, and small current-info lookups -> Luna.
- Explicit deep analysis, complex strategy/coding/math, or long multi-step prompts -> Sol.
- At 80%+ usage, Auto suppresses Sol and favors Terra/Luna.
- At 90%+ usage, Auto favors Luna and keeps Terra only for difficult prompts.

Reasoning stays at `medium` for all three models. Native OpenAI/Codex web search uses low search context on Luna and, when quota is healthy, medium context on Terra/Sol. At 80%+ usage, search context is also reduced to low.

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
        -> quota-aware Auto router
        -> Luna / Terra / Sol
        -> optional native Codex web search
```

No OpenAI API key, Supabase, Neon, or application database is used. Conversation history stays in each browser's `localStorage` and is capped at 200 local threads. Up to 200 recent user/assistant messages can be sent as conversational context, with an additional total-size guard.

## Codex usage UI

The sidebar reads Codex rate-limit usage from the same endpoint used by Codex itself:

```text
GET https://chatgpt.com/backend-api/wham/usage
```

The response is cached for 60 seconds. The same cached snapshot feeds the Auto router, avoiding an extra usage request on most turns.

## Security

- The ChatGPT OAuth refresh token is never committed to GitHub.
- Authorized browsers keep an HttpOnly backup so the shared session can be rebuilt if Vercel Runtime Cache is evicted.
- The plaintext family PIN is not committed to GitHub.
- Family access uses a random server-side access secret and an HttpOnly cookie.
- The family PIN is protected by an online attempt limit of 5 failures per 10 minutes per client fingerprint.
- `잠금` clears that browser's family access and OAuth backup; it does not intentionally revoke the owner's OpenAI account.
- The server maps only the supported Auto/Luna/Sol behavior to fixed GPT-5.6 model IDs; arbitrary client model IDs are ignored.

## Development

```bash
npm install
npm run dev
```

The shared-session Runtime Cache portion is intended for Vercel production/preview deployments.
