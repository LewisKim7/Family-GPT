import {
  DEFAULT_OPENAI_OAUTH_CLIENT_ID,
  deriveAccountId,
  refreshOpenAIOAuthTokens,
} from "@openai-oauth/core";
import { getCache } from "@vercel/functions";
import {
  createHash,
  randomBytes,
  randomInt,
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
const PIN_ATTEMPT_TTL_SECONDS = 10 * 60;
const MAX_PIN_ATTEMPTS = 5;

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

function generatePin() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
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

async function readPinPolicy() {
  const value = await cache().get(PIN_POLICY_KEY);
  return value && typeof value === "object" ? value : null;
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
  if (policy?.pinSalt && policy?.pinHash) {
    return {
      pinSalt: policy.pinSalt,
      pinHash: policy.pinHash,
      pinCode: null,
    };
  }
  return createPinMaterial(generatePin(), true);
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

export function grantFamilyAccess(store, state) {
  store.set(FAMILY_ACCESS_COOKIE, state.accessSecret, cookieOptions());
}

export function clearFamilyAccess(store) {
  store.delete(FAMILY_ACCESS_COOKIE);
}

export function hasFamilyAccess(store, state) {
  const cookie = store.get(FAMILY_ACCESS_COOKIE)?.value;
  return Boolean(cookie && state?.accessSecret && safeEqual(cookie, state.accessSecret));
}

export function clearLegacyPersonalCookies(store) {
  for (const name of ["luna_access", "luna_refresh", "luna_account", "luna_expires"]) {
    store.delete(name);
  }
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
  } catch {
    const latest = await readSharedState();
    if (latest?.accessToken && latest?.accountId && Number(latest.expiresAt ?? 0) > Date.now() + 60_000) {
      return latest;
    }
    await deleteSharedState();
    return null;
  }
}

async function readLegacyPersonalSession(store) {
  const accessToken = store.get("luna_access")?.value;
  const refreshToken = store.get("luna_refresh")?.value;
  const accountId = store.get("luna_account")?.value;
  const expiresAt = Number(store.get("luna_expires")?.value ?? 0);

  if (!refreshToken || !accountId) return null;
  const session = { accessToken, refreshToken, accountId, expiresAt };
  if (accessToken && expiresAt > Date.now() + 60_000) return session;

  try {
    return await refreshTokenSession(session);
  } catch {
    return null;
  }
}

export async function migrateLegacySession(store) {
  const existing = await readSharedState();
  if (existing) return null;

  const personal = await readLegacyPersonalSession(store);
  if (!personal) return null;

  const state = await writeSharedState(await makeSharedState(personal));
  grantFamilyAccess(store, state);
  clearLegacyPersonalCookies(store);
  return { state, generatedPin: state.pinCode };
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
  const state = await writeSharedState(
    await makeSharedState({
      accessToken: tokenResult.accessToken,
      refreshToken: tokenResult.refreshToken,
      accountId,
      expiresAt: Date.now() + accessSeconds * 1000,
    }),
  );
  grantFamilyAccess(store, state);
  clearLegacyPersonalCookies(store);
  return { state, generatedPin: state.pinCode };
}

export async function authorizeFamilyRequest(store) {
  const state = await resolveSharedState();
  if (!state || !hasFamilyAccess(store, state)) return null;
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
  const state = await resolveSharedState();
  if (!state) return { ok: false, status: 503, error: "관리자 Codex 연결이 필요합니다." };

  const attemptKey = clientAttemptKey(request);
  const attempts = Number((await cache().get(attemptKey))?.count ?? 0);
  if (attempts >= MAX_PIN_ATTEMPTS) {
    return { ok: false, status: 429, error: "PIN 입력 횟수를 초과했습니다. 10분 후 다시 시도하세요." };
  }

  const candidate = hashPin(pin, state.pinSalt);
  if (!safeEqual(candidate, state.pinHash)) {
    await cache().set(attemptKey, { count: attempts + 1 }, {
      ttl: PIN_ATTEMPT_TTL_SECONDS,
      name: "Family GPT PIN attempts",
    });
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
