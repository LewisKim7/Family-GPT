import { cookies } from "next/headers";
import {
  clearFamilyAccess,
  clearPersonalBackup,
} from "../../../../lib/shared-auth";

export const runtime = "nodejs";

export async function POST() {
  const store = await cookies();
  clearFamilyAccess(store);
  clearPersonalBackup(store);
  for (const name of ["luna_device_id", "luna_user_code", "luna_device_interval"]) {
    store.delete(name);
  }
  return Response.json({ ok: true });
}
