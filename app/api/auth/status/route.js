import { cookies } from "next/headers";
import {
  grantFamilyAccess,
  hasFamilyAccess,
  migrateLegacySession,
  readSharedState,
  resolveSharedState,
} from "../../../../lib/shared-auth";

export const runtime = "nodejs";

export async function GET() {
  const store = await cookies();
  let state = await resolveSharedState();

  if (!state) {
    const migrated = await migrateLegacySession(store);
    if (migrated) {
      return Response.json({
        status: "connected",
        connected: true,
        shared: true,
        accountId: migrated.state.accountId,
        recovered: true,
      });
    }

    state = await readSharedState();
    if (!state) {
      return Response.json({ status: "owner_login_required", connected: false });
    }
  }

  if (hasFamilyAccess(store, state)) {
    grantFamilyAccess(store, state);
    return Response.json({
      status: "connected",
      connected: true,
      shared: true,
      accountId: state.accountId,
    });
  }

  return Response.json({ status: "pin_required", connected: false, shared: true });
}
