import {
  DEFAULT_OPENAI_OAUTH_CLIENT_ID,
  deriveAccountId,
  exchangeOpenAIOAuthCode,
} from "@openai-oauth/core";
import { cookies } from "next/headers";

export const runtime = "nodejs";

const AUTH_BASE_URL = "https://auth.openai.com";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge,
  };
}

function clearPending(store) {
  store.delete("luna_device_id");
  store.delete("luna_user_code");
  store.delete("luna_device_interval");
}

export async function POST() {
  const store = await cookies();
  const deviceAuthId = store.get("luna_device_id")?.value;
  const userCode = store.get("luna_user_code")?.value;

  if (!deviceAuthId || !userCode) {
    return Response.json({ status: "expired" }, { status: 410 });
  }

  const response = await fetch(`${AUTH_BASE_URL}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
    cache: "no-store",
  });

  if (response.status === 403 || response.status === 404) {
    return Response.json({ status: "pending" }, { status: 202 });
  }

  if (!response.ok) {
    const detail = await response.text();
    return Response.json(
      { error: `Device authorization failed (${response.status}).`, detail },
      { status: response.status },
    );
  }

  const codePayload = await response.json();
  const authorizationCode = codePayload?.authorization_code;
  const codeVerifier = codePayload?.code_verifier;

  if (!authorizationCode || !codeVerifier) {
    return Response.json({ error: "OpenAI returned an incomplete authorization response." }, { status: 502 });
  }

  const tokenResult = await exchangeOpenAIOAuthCode({
    code: authorizationCode,
    codeVerifier,
    redirectUri: `${AUTH_BASE_URL}/deviceauth/callback`,
    clientId: DEFAULT_OPENAI_OAUTH_CLIENT_ID,
  });

  const accountId =
    tokenResult.accountId ??
    deriveAccountId(tokenResult.idToken) ??
    deriveAccountId(tokenResult.accessToken);

  if (!accountId || !tokenResult.refreshToken) {
    return Response.json({ error: "Could not establish a persistent ChatGPT session." }, { status: 502 });
  }

  const accessMaxAge = Math.max(60, Number(tokenResult.expiresIn ?? 3600));
  const expiresAt = Date.now() + accessMaxAge * 1000;

  store.set("luna_access", tokenResult.accessToken, sessionCookieOptions(accessMaxAge));
  store.set("luna_refresh", tokenResult.refreshToken, sessionCookieOptions());
  store.set("luna_account", accountId, sessionCookieOptions());
  store.set("luna_expires", String(expiresAt), sessionCookieOptions());
  clearPending(store);

  return Response.json({ status: "connected", accountId });
}
