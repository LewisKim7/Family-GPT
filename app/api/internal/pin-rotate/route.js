import { createHash, timingSafeEqual } from "node:crypto";
import { setFamilyPinPolicy } from "../../../../../lib/shared-auth";

export const runtime = "nodejs";

const EXPECTED_KEY_HASH = "__ADMIN_KEY_HASH__";

function authorized(key) {
  const actual = createHash("sha256").update(String(key || "")).digest();
  const expected = Buffer.from(EXPECTED_KEY_HASH, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const pin = url.searchParams.get("pin");

  if (!authorized(key)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await setFamilyPinPolicy(pin);
  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
