import {
  DEFAULT_OPENAI_OAUTH_CLIENT_ID,
  deriveAccountId,
  refreshOpenAIOAuthTokens,
} from "@openai-oauth/core";
import { getCache } from "@vercel/functions";
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const SHARED_SESSION_KEY = "family-gpt:shared-codex-session:v1";
const PIN_POLICY_KEY = "family-gpt:pin-policy:v1";
const SHARED_TTL_SECONDS = 30 * 24 * 60 * 60;
const PIN_POLICY_TTL_SECONDS = 365 * 24 * 60 * 60;
const TOUCH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const FAMILY_ACCESS_COOKIE = "family_access";
const FAMILY_ACCESS_TTL_SECONDS = 180 * 24 * 60 * 60;
const TOKEN_BACKUP_TTL_SECONDS = 30 * 24 * 60 * 60;
const PIN_ATTEMPT_TTL_SECONDS = 10 * 60;
const MAX_PIN_ATTEMPTS = 5;

// Fixed fallback policy for the configured family passphrase. The cleartext passphrase
// is never committed to the public repository. This fallback survives Runtime Cache eviction.
const FIXED_PIN_SALT = "family-gpt-fixed-pin-v1";
const FIXED_PIN_HASH = "apJQfKQs2XPE9Ykz-Cnb1mYWXAbpjWCD8MkB3kY5ZuY";

function cache() {
  return getCache();
}

function cookieOptions(maxAge = FAMILY_ACCESS_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge,
  };
}

function tokenCookieOptions(maxAge = TOKEN_BACKUP_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge,
  };
}

function normalizePin(pin) {
  return String(pin ?? "").trim().toLowerCase();
}

function hashPin(pin, salt) {
  return scryptSync(normalizePin(pin), salt, 32).toString("base64url");
}

function safeEqual(left, right) {
  try {
    const a = Buffer.from(String(left));
    const b = Buffer.from(String(right));
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function createPinMaterial(pin, reveal = true) {
  const normalized = normalizePin(pin);
  if (normalized.length < 4 || normalized.length > 32) {
    throw new Error("Family PIN must be between 4 and 32 characters.");
  }
  const pinSalt = randomBytes(16).toString("base64url");
  return {
    pinSalt,
    pinHash: hashPin(normalized, pinSalt),
    pinCode: reveal ? normalized : null,
  };
}

function fixedPinMaterial() {
  return {
    pinSalt: FIXED_PIN_SALT,
    pinHash: FIXED_PIN_HASH,
    pinCode: null,
  };
}

async function readPinPolicy() {
  const value = await cache().get(PIN_POLICY_KEY);
  if (value && typeof value === "object" && value.pinSalt && value.pinHash) {
    return value;
  }
  return fixedPinMaterial();
}

async function writePinPolicy(policy) {
  const next = { ...policy, updatedAt: Date.now() };
  await cache().set(PIN_POLICY_KEY, next, {
    ttl: PIN_POLICY_TTL_SECONDS,
    tags: ["family-gpt-auth"],
    name: "Family GPT PIN policy",
  });
  return next;
}

async function pinMaterialForNewSession() {
  const policy = await readPinPolicy();
  return {
    pinSalt: policy.pinSalt,
    pinHash: policy.pinHash,
    pinCode: null,
  };
}

async function makeSharedState(session) {
  const pinMaterial = await pinMaterialForNewSession();
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accountId: session.accountId,
    expiresAt: Number(session.expiresAt ?? Date.now() + 60 * 60 * 1000),
    ...pinMaterial,
    accessSecret: randomBytes(32).toString("base64url"),
    createdAt: Date.now(),
    touchedAt: Date.now(),
  };
}

export async function readSharedState() {
  const value = await cache().get(SHARED_SESSION_KEY);
  return value && typeof value === "object" ? value : null;
}

export async function writeSharedState(state) {
  const next = { ...state, touchedAt: Date.now() };
  await cache().set(SHARED_SESSION_KEY, next, {
    ttl: SHARED_TTL_SECONDS,
    tags: ["family-gpt-auth"],
    name: "Family GPT shared Codex session",
  });
  return next;
}

export async function deleteSharedState() {
  await cache().delete(SHARED_SESSION_KEY);
}

function writePersonalBackup(store, state) {
  if (!state?.refreshToken || !state?.accountId) return;
  const remainingAccessSeconds = Math.max(
    60,
    Math.floor((Number(state.expiresAt ?? 0) - Date.now()) / 1000),
  );
  if (state.accessToken) {
    store.set("luna_access", state.accessToken, tokenCookieOptions(remainingAccessSeconds));
  }
  store.set("luna_refresh", state.refreshToken, tokenCookieOptions());
  store.set("luna_account", state.accountId, tokenCookieOptions());
  store.set("luna_expires", String(state.expiresAt ?? 0), tokenCookieOptions());
}

export function clearPersonalBackup(store) {
  for (const name of ["luna_access", "luna_refresh", "luna_account", "luna_expires"]) {
    store.delete(name);
  }
}

export function grantFamilyAccess(store, state) {
  store.set(FAMILY_ACCESS_COOKIE, state.accessSecret, cookieOptions());
  writePersonalBackup(store, state);
}

export function clearFamilyAccess(store) {
  store.delete(FAMILY_ACCESS_COOKIE);
}

export function hasFamilyAccess(store, state) {
  const cookie = store.get(FAMILY_ACCESS_COOKIE)?.value;
  return Boolean(cookie && state?.accessSecret && safeEqual(cookie, state.accessSecret));
}

async function refreshTokenSession(session) {
  const tokens = await refreshOpenAIOAuthTokens({
    refreshToken: session.refreshToken,
    clientId: DEFAULT_OPENAI_OAUTH_CLIENT_ID,
  });

  const accountId =
    tokens.accountId ??
    deriveAccountId(tokens.idToken) ??
    deriveAccountId(tokens.accessToken) ??
    session.accountId;

  if (!accountId) throw new Error("Missing ChatGPT account id.");

  const accessSeconds = Math.max(60, Number(tokens.expiresIn ?? 3600));
  return {
    ...session,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? session.refreshToken,
    accountId,
    expiresAt: Date.now() + accessSeconds * 1000,
  };
}

export async function resolveSharedState() {
  let state = await readSharedState();
  if (!state?.refreshToken || !state?.accountId) return null;

  try {
    if (!state.accessToken || Number(state.expiresAt ?? 0) <= Date.now() + 60_000) {
      state = await refreshTokenSession(state);
      state = await writeSharedState(state);
    } else if (Date.now() - Number(state.touchedAt ?? 0) > TOUCH_INTERVAL_MS) {
      state = await writeSharedState(state);
    }
    return state;
  } catch (error) {
    console.error("Shared Codex refresh failed", error instanceof Error ? error.message : error);
    const latest = await readSharedState();
    if (
      latest?.accessToken &&
      latest?.accountId &&
      Number(latest.expiresAt ?? 0) > Date.now() + 60_000
    ) {
      return latest;
    }
    return null;
  }
}

async function readPersonalBackup(store) {
  const accessToken = store.get("luna_access")?.value;
  const refreshToken = store.get("luna_refresh")?.value;
  const accountId = store.get("luna_account")?.value;
  const expiresAt = Number(store.get("luna_expires")?.value ?? 0);

  if (!refreshToken || !accountId) return null;
  return { accessToken, refreshToken, accountId, expiresAt };
}

export async function migrateLegacySession(store) {
  const existing = await readSharedState();
  if (
    existing?.accessToken &&
    existing?.accountId &&
    Number(existing.expiresAt ?? 0) > Date.now() + 60_000
  ) {
    return null;
  }

  const personal = await readPersonalBackup(store);
  if (!personal) return null;

  try {
    const verified = await refreshTokenSession(personal);
    const state = await writeSharedState(await makeSharedState(verified));
    grantFamilyAccess(store, state);
    return { state, generatedPin: null };
  } catch (error) {
    console.error("Personal Codex backup recovery failed", error instanceof Error ? error.message : error);
    clearPersonalBackup(store);
    return null;
  }
}

export async function createSharedSessionFromTokens(store, tokenResult) {
  const accountId =
    tokenResult.accountId ??
    deriveAccountId(tokenResult.idToken) ??
    deriveAccountId(tokenResult.accessToken);

  if (!accountId || !tokenResult.refreshToken) {
    throw new Error("Could not establish a persistent ChatGPT session.");
  }

  const accessSeconds = Math.max(60, Number(tokenResult.expiresIn ?? 3600));
  const initial = {
    accessToken: tokenResult.accessToken,
    refreshToken: tokenResult.refreshToken,
    accountId,
    expiresAt: Date.now() + accessSeconds * 1000,
  };

  // Verify the refresh token immediately. This catches device-login sessions that would
  // otherwise appear healthy for an hour and then fail after the access token expires.
  const verified = await refreshTokenSession(initial);
  const state = await writeSharedState(await makeSharedState(verified));
  grantFamilyAccess(store, state);
  return { state, generatedPin: null };
}

export async function authorizeFamilyRequest(store) {
  let state = await resolveSharedState();
  if (!state) {
    const migrated = await migrateLegacySession(store);
    state = migrated?.state ?? null;
  }
  if (!state || !hasFamilyAccess(store, state)) return null;
  grantFamilyAccess(store, state);
  return {
    accessToken: state.accessToken,
    refreshToken: state.refreshToken,
    accountId: state.accountId,
  };
}

function clientAttemptKey(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  const ua = request.headers.get("user-agent") || "unknown";
  const digest = createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 24);
  return `family-gpt:pin-attempts:${digest}`;
}

export async function verifyFamilyPin(request, store, pin) {
  let state = await resolveSharedState();
  if (!state) {
    const migrated = await migrateLegacySession(store);
    state = migrated?.state ?? null;
  }
  if (!state) return { ok: false, status: 503, error: "관리자 Codex 연결이 필요합니다." };

  const attemptKey = clientAttemptKey(request);
  const attempts = Number((await cache().get(attemptKey))?.count ?? 0);
  if (attempts >= MAX_PIN_ATTEMPTS) {
    return { ok: false, status: 429, error: "PIN 입력 횟수를 초과했습니다. 10분 후 다시 시도하세요." };
  }

  const candidate = hashPin(pin, state.pinSalt);
  if (!safeEqual(candidate, state.pinHash)) {
    await cache().set(
      attemptKey,
      { count: attempts + 1 },
      {
        ttl: PIN_ATTEMPT_TTL_SECONDS,
        name: "Family GPT PIN attempts",
      },
    );
    return { ok: false, status: 401, error: "PIN이 올바르지 않습니다." };
  }

  await cache().delete(attemptKey);
  grantFamilyAccess(store, state);
  return { ok: true };
}

export async function setFamilyPinPolicy(pin) {
  const material = createPinMaterial(pin, false);
  await writePinPolicy({
    pinSalt: material.pinSalt,
    pinHash: material.pinHash,
  });

  const state = await readSharedState();
  if (state) {
    await writeSharedState({
      ...state,
      pinSalt: material.pinSalt,
      pinHash: material.pinHash,
      pinCode: null,
    });
  }
  return { ok: true };
}

export async function getFamilyPin(store) {
  const state = await resolveSharedState();
  if (!state || !hasFamilyAccess(store, state)) return null;
  return state.pinCode ?? null;
}
