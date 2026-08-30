import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import {
  DEFAULT_OPENAI_OAUTH_CLIENT_ID,
  deriveAccountId,
  refreshOpenAIOAuthTokens,
} from "@openai-oauth/core";
import { streamText } from "ai";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gpt-5.6-luna";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 24000;

function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge };
}

function normalizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    )
    .slice(-MAX_MESSAGES)
    .map((message) => ({ role: message.role, content: message.content.slice(0, MAX_MESSAGE_CHARS) }));
}

async function resolveSession(store) {
  let accessToken = store.get("luna_access")?.value;
  let refreshToken = store.get("luna_refresh")?.value;
  let accountId = store.get("luna_account")?.value;
  const expiresAt = Number(store.get("luna_expires")?.value ?? 0);

  if (accessToken && accountId && expiresAt > Date.now() + 60_000) {
    return { accessToken, refreshToken, accountId };
  }

  if (!refreshToken) return null;

  try {
    const tokens = await refreshOpenAIOAuthTokens({
      refreshToken,
      clientId: DEFAULT_OPENAI_OAUTH_CLIENT_ID,
    });

    accessToken = tokens.accessToken;
    refreshToken = tokens.refreshToken ?? refreshToken;
    accountId =
      tokens.accountId ??
      deriveAccountId(tokens.idToken) ??
      deriveAccountId(tokens.accessToken) ??
      accountId;

    if (!accountId) return null;

    const accessMaxAge = Math.max(60, Number(tokens.expiresIn ?? 3600));
    store.set("luna_access", accessToken, sessionCookieOptions(accessMaxAge));
    store.set("luna_refresh", refreshToken, sessionCookieOptions());
    store.set("luna_account", accountId, sessionCookieOptions());
    store.set("luna_expires", String(Date.now() + accessMaxAge * 1000), sessionCookieOptions());

    return { accessToken, refreshToken, accountId };
  } catch {
    return null;
  }
}

export async function POST(request) {
  try {
    const store = await cookies();
    const session = await resolveSession(store);

    if (!session) {
      return Response.json({ error: "ChatGPT connection required." }, { status: 401 });
    }

    const body = await request.json();
    const messages = normalizeMessages(body?.messages);

    if (!messages.length || messages.at(-1)?.role !== "user") {
      return Response.json({ error: "A user message is required." }, { status: 400 });
    }

    const openai = createOpenAIOAuth({
      kind: "openai-oauth",
      getSession: async () => session,
    });

    const result = streamText({
      model: openai(MODEL),
      system:
        "You are a helpful general-purpose assistant. Reply in the user's language. Be accurate, practical, and concise unless the user asks for detail.",
      messages,
    });

    return result.toTextStreamResponse({
      headers: { "Cache-Control": "no-store", "X-Model": MODEL },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
