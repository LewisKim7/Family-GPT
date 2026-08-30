import { getCache } from "@vercel/functions";
import { cookies } from "next/headers";
import { authorizeFamilyRequest } from "../../../lib/shared-auth";

export const runtime = "nodejs";

const USAGE_KEY = "family-gpt:codex-usage:v1";

function normalizeWindow(window) {
  if (!window || typeof window !== "object") return null;
  return {
    usedPercent: Number(window.used_percent ?? 0),
    windowSeconds: Number(window.limit_window_seconds ?? 0),
    resetAfterSeconds: Number(window.reset_after_seconds ?? 0),
    resetAt: Number(window.reset_at ?? 0),
  };
}

function normalizeUsage(payload) {
  const rate = payload?.rate_limit ?? null;
  return {
    planType: payload?.plan_type ?? null,
    primary: normalizeWindow(rate?.primary_window),
    secondary: normalizeWindow(rate?.secondary_window),
    credits: payload?.credits ?? null,
    resetCredits: payload?.rate_limit_reset_credits?.available_count ?? null,
    fetchedAt: Date.now(),
  };
}

export async function GET() {
  const store = await cookies();
  const session = await authorizeFamilyRequest(store);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const runtimeCache = getCache();
  const cached = await runtimeCache.get(USAGE_KEY);
  if (cached) {
    return Response.json(cached, { headers: { "Cache-Control": "no-store" } });
  }

  const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "ChatGPT-Account-Id": session.accountId,
      "User-Agent": "codex-cli",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return Response.json(
      { error: `Usage request failed (${response.status}).` },
      { status: response.status },
    );
  }

  const normalized = normalizeUsage(await response.json());
  await runtimeCache.set(USAGE_KEY, normalized, {
    ttl: 60,
    name: "Family GPT Codex usage",
  });

  return Response.json(normalized, { headers: { "Cache-Control": "no-store" } });
}
