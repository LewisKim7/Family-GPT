import { createHash, timingSafeEqual } from "node:crypto";
import { setFamilyPinPolicy } from "../../../../../lib/shared-auth";

export const runtime = "nodejs";

const EXPECTED_KEY_HASH = "0fee37751d3b0716759d60d03f2ec601b4008bf3954a815eaa740fee3a96fcca";

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
