import { cookies } from "next/headers";
import { getFamilyPin, verifyFamilyPin } from "../../../../lib/shared-auth";

export const runtime = "nodejs";

export async function POST(request) {
  const store = await cookies();
  const body = await request.json().catch(() => ({}));
  const result = await verifyFamilyPin(request, store, body?.pin);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ connected: true });
}

export async function GET() {
  const store = await cookies();
  const pin = await getFamilyPin(store);
  if (!pin) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ pin });
}
