import { SESSION_TTL_MS } from "./workerStore.js";

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
let cachedGoogleKeys;
let googleKeysExpireAt = 0;

function json(status, body, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function cookieName(request) {
  return new URL(request.url).protocol === "https:" ? "__Host-adspark_session" : "adspark_session";
}

function readCookie(request, name) {
  for (const cookie of (request.headers.get("cookie") || "").split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(cookie.slice(separator + 1).trim()); } catch { return ""; }
  }
  return "";
}

function isValidOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let requestOrigin;
  try { requestOrigin = new URL(request.url).origin; } catch { return false; }
  const allowed = (env.APP_ORIGIN || requestOrigin).split(",").map((value) => value.trim().replace(/\/+$/, "")).filter(Boolean);
  return allowed.includes(origin.replace(/\/+$/, ""));
}

async function readJson(request, maxBytes = 20_000) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw Object.assign(new Error("Request body is too large."), { status: 413 });
  if (!bytes.byteLength) return {};
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error("Invalid JSON body."), { status: 400 }); }
}

function decodeBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function googleSigningKeys() {
  if (cachedGoogleKeys && Date.now() < googleKeysExpireAt) return cachedGoogleKeys;
  const response = await fetch(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Google signing keys are unavailable.");
  const data = await response.json();
  if (!Array.isArray(data.keys)) throw new Error("Google signing keys are invalid.");
  const cacheSeconds = Number(/max-age=(\d+)/i.exec(response.headers.get("cache-control") || "")?.[1] || 300);
  cachedGoogleKeys = data.keys;
  googleKeysExpireAt = Date.now() + Math.max(60, Math.min(cacheSeconds, 3600)) * 1000;
  return cachedGoogleKeys;
}

export async function verifyGoogleIdToken(credential, clientId) {
  if (typeof credential !== "string" || credential.length > 16_000 || !clientId) throw new Error("Invalid Google ID token.");
  const parts = credential.split(".");
  if (parts.length !== 3) throw new Error("Invalid Google ID token.");
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch { throw new Error("Invalid Google ID token."); }
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Invalid Google ID token.");
  const key = (await googleSigningKeys()).find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!key) throw new Error("Invalid Google ID token.");
  const cryptoKey = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", cryptoKey, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  const issuerValid = claims.iss === "accounts.google.com" || claims.iss === "https://accounts.google.com";
  const now = Math.floor(Date.now() / 1000);
  if (!validSignature || !issuerValid || claims.aud !== clientId || !Number.isFinite(claims.exp) || claims.exp <= now
      || !Number.isFinite(claims.iat) || claims.iat > now + 60 || typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("Invalid Google ID token.");
  }
  return claims;
}

export async function handleWorkerAuth(request, env, store) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/auth/")) return null;
  if (request.method === "GET" && path === "/api/auth/config") {
    return json(200, { clientId: env.GOOGLE_CLIENT_ID?.trim() || "" });
  }
  if (request.method === "GET" && path === "/api/auth/me") {
    const user = await store.getAuthenticatedUser(readCookie(request, cookieName(request)));
    return json(200, user ? { authenticated: true, user } : { authenticated: false, user: null });
  }
  if (request.method === "POST" && (path === "/api/auth/google" || path === "/api/auth/logout")) {
    if (!isValidOrigin(request, env)) return json(403, { error: "Request origin is not allowed.", code: "INVALID_ORIGIN" });
    if (path === "/api/auth/logout") {
      await store.deleteSession(readCookie(request, cookieName(request)));
      return json(200, { signedOut: true }, { "Set-Cookie": `${cookieName(request)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${new URL(request.url).protocol === "https:" ? "; Secure" : ""}` });
    }
    const clientId = env.GOOGLE_CLIENT_ID?.trim() || "";
    if (!clientId) return json(503, { error: "Google sign-in is not configured. Set GOOGLE_CLIENT_ID.", code: "GOOGLE_NOT_CONFIGURED" });
    let body;
    try { body = await readJson(request); }
    catch (error) { return json(error.status || 400, { error: error.message, code: "INVALID_REQUEST" }); }
    if (typeof body.credential !== "string" || body.credential.length > 16_000) {
      return json(400, { error: "A Google ID credential is required.", code: "INVALID_CREDENTIAL" });
    }
    try {
      const payload = await verifyGoogleIdToken(body.credential, clientId);
      const user = await store.upsertGoogleUser(payload);
      const token = await store.issueSession(user.id);
      const secure = new URL(request.url).protocol === "https:";
      const name = cookieName(request);
      const cookie = `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? "; Secure" : ""}`;
      return json(200, { user: { id: user.id, email: user.email || "", name: user.name || user.email || "Google user", picture: user.picture || "" } }, { "Set-Cookie": cookie });
    } catch {
      return json(401, { error: "Google sign-in could not be verified. Please try again.", code: "INVALID_CREDENTIAL" });
    }
  }
  return json(404, { error: "Authentication endpoint not found." });
}

export { cookieName, isValidOrigin, readCookie };
