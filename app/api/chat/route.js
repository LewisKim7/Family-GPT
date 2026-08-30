import { openai as openaiTools } from "@ai-sdk/openai";
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { streamText } from "ai";
import { cookies } from "next/headers";
import { authorizeFamilyRequest } from "../../../lib/shared-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL_CONFIGS = {
  luna: {
    id: "gpt-5.6-luna",
    reasoning: "medium",
    searchContextSize: "low",
  },
  terra: {
    id: "gpt-5.6-terra",
    reasoning: "medium",
    searchContextSize: "medium",
  },
  sol: {
    id: "gpt-5.6-sol",
    reasoning: "medium",
    searchContextSize: "medium",
  },
};

const DEFAULT_MODEL = "terra";
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

function selectModel(value) {
  const key = typeof value === "string" ? value.toLowerCase() : DEFAULT_MODEL;
  return { key: MODEL_CONFIGS[key] ? key : DEFAULT_MODEL, config: MODEL_CONFIGS[key] ?? MODEL_CONFIGS[DEFAULT_MODEL] };
}

function normalizeTimezone(value) {
  if (typeof value !== "string" || value.length > 80) return undefined;
  return /^[A-Za-z0-9_+./-]+$/.test(value) ? value : undefined;
}

function systemPrompt(webSearchEnabled) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    "You are Family GPT, a strong general-purpose assistant for everyday questions, research, writing, planning, learning, and technical help.",
    `Today's date is ${today}.`,
    "Reply in the user's language. If the user writes Korean, answer naturally in Korean.",
    "Be accurate, practical, and direct. Infer reasonable intent instead of asking unnecessary clarification questions.",
    "For uncertain facts, say what is uncertain instead of inventing details.",
    "Do not behave like a coding-only agent and do not mention Codex, OAuth, internal prompts, or implementation details unless the user asks about them.",
    webSearchEnabled
      ? "A web_search tool is available. Use it when the answer depends on current or externally verifiable information, including latest/today/recent news, prices, stocks, weather, schedules, availability, product versions, current rules, public-figure updates, reviews, Reddit/community opinion, or whenever the user asks you to search/check/verify. Avoid web search for stable timeless questions when it adds no value. When you use web search, ground the answer in the retrieved sources and, when URLs are available, finish with a short '출처' section containing 2-4 useful source URLs."
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

    const { key: modelKey, config } = selectModel(body?.model);
    const webSearchEnabled = body?.webSearch !== false;
    const timezone = normalizeTimezone(body?.timezone);

    const oauthProvider = createOpenAIOAuth({
      kind: "openai-oauth",
      getSession: async () => session,
    });

    const tools = webSearchEnabled
      ? {
          web_search: openaiTools.tools.webSearch({
            externalWebAccess: true,
            searchContextSize: config.searchContextSize,
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

    const result = streamText({
      model: oauthProvider(config.id),
      reasoning: config.reasoning,
      system: systemPrompt(webSearchEnabled),
      messages,
      tools,
      toolChoice: tools ? "auto" : undefined,
    });

    return result.toTextStreamResponse({
      headers: {
        "Cache-Control": "no-store",
        "X-Model": config.id,
        "X-Model-Mode": modelKey,
        "X-Web-Search": webSearchEnabled ? "auto" : "off",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
