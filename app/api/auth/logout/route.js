import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST() {
  const store = await cookies();
  for (const name of [
    "luna_access",
    "luna_refresh",
    "luna_account",
    "luna_expires",
    "luna_device_id",
    "luna_user_code",
    "luna_device_interval",
  ]) {
    store.delete(name);
  }
  return Response.json({ ok: true });
}
