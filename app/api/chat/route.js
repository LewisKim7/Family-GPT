import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import { streamText } from "ai";
import { cookies } from "next/headers";
import { authorizeFamilyRequest } from "../../../lib/shared-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gpt-5.6-luna";
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
