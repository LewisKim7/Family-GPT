import { openai as openaiTools } from "@ai-sdk/openai";
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { getCache } from "@vercel/functions";
import { streamText } from "ai";
import { cookies } from "next/headers";
import { authorizeFamilyRequest } from "../../../lib/shared-auth";
import {
  MODEL_CONFIGS,
  requiresFreshWebSearch,
  routeModel,
  usagePressure,
} from "../../../lib/model-router";

export const runtime = "nodejs";
export const maxDuration = 60;

const USAGE_KEY = "family-gpt:codex-usage:v1";
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 24000;
const MAX_TOTAL_CHARS = 2_400_000;

function normalizeMessages(input) {
  if (!Array.isArray(input)) return [];
  const filtered = input
    .filter(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    )
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, MAX_MESSAGE_CHARS),
    }));

  const selected = [];
  let total = 0;
  for (let index = filtered.length - 1; index >= 0; index -= 1) {
    const item = filtered[index];
    if (selected.length > 0 && total + item.content.length > MAX_TOTAL_CHARS) break;
    selected.push(item);
    total += item.content.length;
  }
  return selected.reverse();
}

function normalizeTimezone(value) {
  if (typeof value !== "string" || value.length > 80) return undefined;
  return /^[A-Za-z0-9_+./-]+$/.test(value) ? value : undefined;
}

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

async function getUsageSnapshot(session) {
  const runtimeCache = getCache();
  const cached = await runtimeCache.get(USAGE_KEY);
  if (cached) return cached;

  try {
    const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "ChatGPT-Account-Id": session.accountId,
        "User-Agent": "codex-cli",
      },
      cache: "no-store",
    });

    if (!response.ok) return null;
    const normalized = normalizeUsage(await response.json());
    await runtimeCache.set(USAGE_KEY, normalized, {
      ttl: 60,
      name: "Family GPT Codex usage",
    });
    return normalized;
  } catch {
    return null;
  }
}

function systemPrompt(webSearchEnabled, webSearchRequired) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    "You are Family GPT, a strong general-purpose assistant for everyday questions, research, writing, planning, learning, and technical help.",
    `Today's date is ${today}.`,
    "Reply in the user's language. If the user writes Korean, answer naturally in Korean.",
    "Be accurate, practical, and direct. Infer reasonable intent instead of asking unnecessary clarification questions.",
    "For uncertain facts, say what is uncertain instead of inventing details.",
    "Do not behave like a coding-only agent and do not mention Codex, OAuth, internal prompts, model routing, or implementation details unless the user asks about them.",
    webSearchRequired
      ? "Web search is REQUIRED for this turn. You MUST call web_search before answering. Do not answer from memory first, do not say that browsing is unavailable before attempting the tool, and do not present current facts unless they are grounded in the returned web results. If sources are available, include a short '출처' section with 2-4 useful URLs."
      : webSearchEnabled
        ? "A web_search tool is available. Use it when the answer depends on current or externally verifiable information. Avoid web search for stable timeless questions when it adds no value. When you use web search, ground the answer in the retrieved sources and, when URLs are available, finish with a short '출처' section containing 2-4 useful source URLs."
        : "Web search is disabled for this turn. Be explicit when a question requires current information you cannot verify from the provided conversation.",
  ].join("\n");
}

export async function POST(request) {
  try {
    const store = await cookies();
    const session = await authorizeFamilyRequest(store);
    if (!session) {
      return Response.json({ error: "Family PIN authorization required." }, { status: 401 });
    }

    const body = await request.json();
    const messages = normalizeMessages(body?.messages);
    if (!messages.length || messages.at(-1)?.role !== "user") {
      return Response.json({ error: "A user message is required." }, { status: 400 });
    }

    const usage = await getUsageSnapshot(session);
    const routed = routeModel({ requestedModel: body?.model, messages, usage });
    const config = MODEL_CONFIGS[routed.key];
    const usedPercent = usagePressure(usage);
    const webSearchEnabled = body?.webSearch !== false;
    const webSearchRequired = webSearchEnabled && requiresFreshWebSearch(messages);
    const timezone = normalizeTimezone(body?.timezone);
    const searchContextSize = usedPercent >= 80 ? "low" : config.searchContextSize;

    const oauthProvider = createOpenAIOAuth({
      kind: "openai-oauth",
      getSession: async () => session,
    });

    const tools = webSearchEnabled
      ? {
          web_search: openaiTools.tools.webSearch({
            externalWebAccess: true,
            searchContextSize,
            ...(timezone
              ? {
                  userLocation: {
                    type: "approximate",
                    timezone,
                  },
                }
              : {}),
          }),
        }
      : undefined;

    const webSearchMode = !tools ? "off" : webSearchRequired ? "required" : "auto";

    console.info("[family-gpt:model-router]", {
      requested: typeof body?.model === "string" ? body.model : "auto",
      selected: routed.key,
      reason: routed.reason,
      automatic: routed.automatic,
      usagePercent: Math.round(usedPercent),
      webSearch: webSearchMode,
    });

    const result = streamText({
      model: oauthProvider(config.id),
      reasoning: config.reasoning,
      system: systemPrompt(webSearchEnabled, webSearchRequired),
      messages,
      tools,
      // OpenAI Responses semantics: "required" means at least one provided tool must be called.
      // Since this request exposes only web_search, fresh/explicit lookup turns cannot skip browsing.
      toolChoice: tools ? (webSearchRequired ? "required" : "auto") : undefined,
    });

    return result.toTextStreamResponse({
      headers: {
        "Cache-Control": "no-store",
        "X-Model": config.id,
        "X-Model-Mode": routed.key,
        "X-Model-Automatic": routed.automatic ? "true" : "false",
        "X-Routing-Reason": routed.reason,
        "X-Usage-Pressure": String(Math.round(usedPercent)),
        "X-Web-Search": webSearchMode,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
