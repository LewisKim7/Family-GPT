import {
  DEFAULT_OPENAI_OAUTH_CLIENT_ID,
  exchangeOpenAIOAuthCode,
} from "@openai-oauth/core";
import { cookies } from "next/headers";
import { createSharedSessionFromTokens } from "../../../../../lib/shared-auth";

export const runtime = "nodejs";

const AUTH_BASE_URL = "https://auth.openai.com";

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

  try {
    const shared = await createSharedSessionFromTokens(store, tokenResult);
    clearPending(store);
    return Response.json({
      status: "connected",
      accountId: shared.state.accountId,
      generatedPin: shared.generatedPin,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not persist shared session." },
      { status: 502 },
    );
  }
}
