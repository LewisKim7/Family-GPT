import {
  DEFAULT_OPENAI_OAUTH_CLIENT_ID,
  deriveAccountId,
  refreshOpenAIOAuthTokens,
} from "@openai-oauth/core";
import { cookies } from "next/headers";

export const runtime = "nodejs";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge };
}

function clearSession(store) {
  store.delete("luna_access");
  store.delete("luna_refresh");
  store.delete("luna_account");
  store.delete("luna_expires");
}

async function refreshSession(store, refreshToken, currentAccountId) {
  try {
    const tokens = await refreshOpenAIOAuthTokens({
      refreshToken,
      clientId: DEFAULT_OPENAI_OAUTH_CLIENT_ID,
    });

    const accountId =
      tokens.accountId ??
      deriveAccountId(tokens.idToken) ??
      deriveAccountId(tokens.accessToken) ??
      currentAccountId;

    if (!accountId) throw new Error("Missing ChatGPT account id.");

    const nextRefresh = tokens.refreshToken ?? refreshToken;
    const accessMaxAge = Math.max(60, Number(tokens.expiresIn ?? 3600));
    const expiresAt = Date.now() + accessMaxAge * 1000;

    store.set("luna_access", tokens.accessToken, sessionCookieOptions(accessMaxAge));
    store.set("luna_refresh", nextRefresh, sessionCookieOptions());
    store.set("luna_account", accountId, sessionCookieOptions());
    store.set("luna_expires", String(expiresAt), sessionCookieOptions());

    return { connected: true, accountId };
  } catch {
    clearSession(store);
    return { connected: false };
  }
}

export async function GET() {
  const store = await cookies();
  const accessToken = store.get("luna_access")?.value;
  const refreshToken = store.get("luna_refresh")?.value;
  const accountId = store.get("luna_account")?.value;
  const expiresAt = Number(store.get("luna_expires")?.value ?? 0);

  if (accessToken && accountId && expiresAt > Date.now() + 60_000) {
    return Response.json({ connected: true, accountId });
  }

  if (refreshToken) {
    return Response.json(await refreshSession(store, refreshToken, accountId));
  }

  return Response.json({ connected: false });
}
