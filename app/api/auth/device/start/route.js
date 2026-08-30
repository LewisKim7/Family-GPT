import { DEFAULT_OPENAI_OAUTH_CLIENT_ID } from "@openai-oauth/core";
import { cookies } from "next/headers";
import { readSharedState } from "../../../../../lib/shared-auth";

export const runtime = "nodejs";

const AUTH_BASE_URL = "https://auth.openai.com";
const DEVICE_TTL_SECONDS = 15 * 60;
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/",
  maxAge: DEVICE_TTL_SECONDS,
};

export async function POST() {
  if (await readSharedState()) {
    return Response.json({ error: "공용 Codex 세션이 이미 연결되어 있습니다." }, { status: 409 });
  }

  const response = await fetch(`${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: DEFAULT_OPENAI_OAUTH_CLIENT_ID }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    return Response.json(
      { error: `Device login request failed (${response.status}).`, detail },
      { status: response.status },
    );
  }

  const payload = await response.json();
  const deviceAuthId = payload?.device_auth_id;
  const userCode = payload?.user_code ?? payload?.usercode;
  const interval = Number.parseInt(String(payload?.interval ?? "5"), 10) || 5;

  if (!deviceAuthId || !userCode) {
    return Response.json({ error: "OpenAI did not return a device code." }, { status: 502 });
  }

  const store = await cookies();
  store.set("luna_device_id", deviceAuthId, cookieOptions);
  store.set("luna_user_code", userCode, cookieOptions);
  store.set("luna_device_interval", String(interval), cookieOptions);

  return Response.json({
    verificationUrl: `${AUTH_BASE_URL}/codex/device`,
    userCode,
    interval,
    expiresIn: DEVICE_TTL_SECONDS,
  });
}
