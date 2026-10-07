import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { OAuth2Client } from "google-auth-library";
import dotenv from "dotenv";
import { createD1Database, createSqliteDatabase } from "./db.js";
import { PLAN_CONFIG } from "./plans.js";
export { PLAN_CONFIG } from "./plans.js";

dotenv.config();

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_ORIGIN = "http://localhost:5173";
const databasePath = resolve(process.env.AUTH_DB_PATH || ".local/adspark-auth.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

const sqliteDatabase = new DatabaseSync(databasePath);
sqliteDatabase.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT,
    name TEXT,
    picture TEXT,
    created_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    session_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS generations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS generations_user_id_idx ON generations(user_id);
  CREATE TABLE IF NOT EXISTS billing_accounts (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'free',
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'active',
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    ads_allowed INTEGER NOT NULL DEFAULT 3,
    ads_used INTEGER NOT NULL DEFAULT 0,
    ads_reserved INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payment_orders (
    order_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL,
    currency TEXT NOT NULL,
    amount INTEGER NOT NULL,
    payment_id TEXT,
    payment_status TEXT NOT NULL DEFAULT 'CREATING',
    subscription_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS payment_orders_user_idx ON payment_orders(user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_single_pending_user_idx
    ON payment_orders(user_id) WHERE payment_status IN ('CREATING', 'PENDING');
`);

// Retire abandoned legacy provider orders when upgrading an existing local database.
const paymentOrderColumns = sqliteDatabase.prepare("PRAGMA table_info(payment_orders)").all().map((column) => column.name);
if (paymentOrderColumns.includes("payment_session_id")) {
  sqliteDatabase.prepare(`UPDATE payment_orders SET payment_status = 'PROVIDER_RETIRED',
    subscription_status = 'provider_retired', updated_at = ? WHERE order_id LIKE 'adspark_%' AND payment_status = 'PENDING'`)
    .run(new Date().toISOString());
  sqliteDatabase.exec("DROP INDEX IF EXISTS payment_orders_single_pending_user_idx");
  sqliteDatabase.exec("ALTER TABLE payment_orders DROP COLUMN payment_session_id");
  sqliteDatabase.exec("CREATE UNIQUE INDEX payment_orders_single_pending_user_idx ON payment_orders(user_id) WHERE payment_status IN ('CREATING', 'PENDING')");
}

let database = createSqliteDatabase(sqliteDatabase);

/** Select the backend for a request host. Local Node keeps SQLite by default. */
export function setAuthDatabase(env) {
  database = env?.DB ? createD1Database(env) : createSqliteDatabase(sqliteDatabase);
}

const googleClient = new OAuth2Client();

function json(res, status, data, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(data));
}

function googleClientId() {
  return process.env.GOOGLE_CLIENT_ID?.trim() || "";
}

function secureCookie() {
  return process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true";
}

function sessionCookieName() {
  return secureCookie() ? "__Host-adspark_session" : "adspark_session";
}

function cookieValue(req, name) {
  const cookieHeader = req.headers.cookie || "";
  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(cookie.slice(separator + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

function cookieHeader(token, maxAge) {
  const secure = secureCookie() ? "; Secure" : "";
  const value = token ? encodeURIComponent(token) : "";
  return `${sessionCookieName()}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function hashSession(token) {
  return createHash("sha256").update(token).digest("hex");
}

function allowedOrigins() {
  return (process.env.APP_ORIGIN || DEFAULT_ORIGIN)
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function hasValidOrigin(req) {
  const origin = req.headers.origin;
  return typeof origin === "string" && allowedOrigins().includes(origin.replace(/\/+$/, ""));
}

function readJsonBody(req, maxBytes = 20_000) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        rejectBody(Object.assign(new Error("Request body is too large."), { status: 413 }));
        req.resume();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!body) return resolveBody({});
      try {
        resolveBody(JSON.parse(body));
      } catch {
        rejectBody(Object.assign(new Error("Invalid JSON body."), { status: 400 }));
      }
    });
    req.on("error", rejectBody);
  });
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email || "",
    name: user.name || user.email || "Google user",
    picture: user.picture || "",
  };
}

export async function issueSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await database.prepare(
    "INSERT INTO sessions (session_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).bind(hashSession(token), userId, now + SESSION_TTL_MS, new Date(now).toISOString()).run();
  return token;
}

export async function getAuthenticatedUser(req) {
  const token = cookieValue(req, sessionCookieName());
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  const now = Date.now();
  await database.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  const user = await database.prepare(`
    SELECT users.id, users.email, users.name, users.picture
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.session_hash = ? AND sessions.expires_at > ?
  `).bind(hashSession(token), now).first();
  return user ? publicUser(user) : null;
}

export async function recordGeneration(userId) {
  await database.prepare("INSERT INTO generations (user_id, created_at) VALUES (?, ?)")
    .bind(userId, new Date().toISOString()).run();
}

export async function getGenerationCountForUser(userId) {
  return (await database.prepare("SELECT COUNT(*) AS count FROM generations WHERE user_id = ?")
    .bind(userId).first()).count;
}

export function closeAuthDatabase() {
  sqliteDatabase.close();
}

export async function upsertGoogleUser(payload) {
  const now = new Date().toISOString();
  const user = await database.prepare(`
    INSERT INTO users (google_sub, email, name, picture, created_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(google_sub) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      picture = excluded.picture,
      last_login_at = excluded.last_login_at
    RETURNING id, email, name, picture
  `).bind(
    payload.sub,
    payload.email || null,
    payload.name || null,
    typeof payload.picture === "string" && payload.picture.startsWith("https://")
      ? payload.picture
      : null,
    now,
    now,
  ).first();
  const periodEnd = addBillingMonth(now);
  await database.prepare(`
    INSERT OR IGNORE INTO billing_accounts
      (user_id, plan, currency, status, period_start, period_end, ads_allowed, ads_used, ads_reserved, updated_at)
    VALUES (?, 'free', 'INR', 'active', ?, ?, 3, 0, 0, ?)
  `).bind(user.id, now, periodEnd, now).run();
  return user;
}

function addBillingMonth(date) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next.toISOString();
}

async function ensureBillingAccount(userId) {
  const now = new Date().toISOString();
  let row = await database.prepare("SELECT * FROM billing_accounts WHERE user_id = ?").bind(userId).first();
  if (!row) {
    await database.prepare(`INSERT INTO billing_accounts
      (user_id, plan, currency, status, period_start, period_end, ads_allowed, updated_at)
      VALUES (?, 'free', 'INR', 'active', ?, ?, 3, ?)`)
      .bind(userId, now, addBillingMonth(now), now).run();
    row = await database.prepare("SELECT * FROM billing_accounts WHERE user_id = ?").bind(userId).first();
  }
  if (Date.parse(row.period_end) <= Date.now()) {
    const start = now;
    const periodEnd = addBillingMonth(start);
    await database.prepare(`UPDATE billing_accounts SET
      plan = 'free', status = 'active', period_start = ?, period_end = ?, ads_allowed = 3,
      ads_used = 0, ads_reserved = 0, updated_at = ? WHERE user_id = ?`)
      .bind(start, periodEnd, now, userId).run();
    row = await database.prepare("SELECT * FROM billing_accounts WHERE user_id = ?").bind(userId).first();
  }
  return row;
}

export async function getBillingStatus(userId) {
  const row = await ensureBillingAccount(userId);
  return {
    plan: row.plan, currency: row.currency, status: row.status,
    periodStart: row.period_start, periodEnd: row.period_end,
    adsAllowed: row.ads_allowed, adsUsed: row.ads_used,
    adsRemaining: Math.max(0, row.ads_allowed - row.ads_used - row.ads_reserved),
  };
}

export async function reserveAdUsage(userId) {
  const now = new Date().toISOString();
  const end = addBillingMonth(now);
  // D1 batch is atomic. The reservation increment is conditional, so concurrent
  // callers cannot pass the allowance ceiling after reading the same old count.
  const result = await database.batch([
    { sql: `INSERT OR IGNORE INTO billing_accounts
      (user_id, plan, currency, status, period_start, period_end, ads_allowed, updated_at)
      VALUES (?, 'free', 'INR', 'active', ?, ?, 3, ?)`, values: [userId, now, end, now] },
    { sql: `UPDATE billing_accounts SET plan = 'free', status = 'active', period_start = ?, period_end = ?,
      ads_allowed = 3, ads_used = 0, ads_reserved = 0, updated_at = ?
      WHERE user_id = ? AND period_end <= ?`, values: [now, end, now, userId, now] },
    { sql: `UPDATE billing_accounts SET ads_reserved = ads_reserved + 1, updated_at = ?
      WHERE user_id = ? AND ads_used + ads_reserved < ads_allowed`, values: [now, userId] },
  ]);
  return result[2]?.meta?.changes === 1;
}

export async function settleAdUsage(userId, succeeded) {
  const now = new Date().toISOString();
  const operations = [{ sql: `UPDATE billing_accounts SET
    ads_reserved = MAX(0, ads_reserved - 1),
    ads_used = ads_used + ?, updated_at = ? WHERE user_id = ?`, values: [succeeded ? 1 : 0, now, userId] }];
  if (succeeded) operations.push({ sql: "INSERT INTO generations (user_id, created_at) VALUES (?, ?)", values: [userId, now] });
  await database.batch(operations);
}

export async function createPaymentOrderRecord({ orderId, userId, plan, currency, amount }) {
  const now = new Date().toISOString();
  const result = await database.prepare(`INSERT OR IGNORE INTO payment_orders
    (order_id, user_id, plan, currency, amount, payment_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'CREATING', ?, ?)`)
    .bind(orderId, userId, plan, currency, amount, now, now).run();
  return result.meta?.changes === 1;
}

export async function attachRazorpayOrder(localOrderId, razorpayOrderId) {
  const now = new Date().toISOString();
  await database.prepare(`UPDATE payment_orders SET order_id = ?, payment_status = 'PENDING', updated_at = ?
    WHERE order_id = ? AND payment_status = 'CREATING'`).bind(razorpayOrderId, now, localOrderId).run();
}

export async function getPaymentOrder(orderId) {
  return database.prepare("SELECT * FROM payment_orders WHERE order_id = ?").bind(orderId).first();
}

export async function activatePaidOrder(orderId, paymentId) {
  const order = await getPaymentOrder(orderId);
  if (!order) return false;
  if (order.payment_status === "SUCCESS" && order.subscription_status === "active") {
    if (paymentId) await database.prepare("UPDATE payment_orders SET payment_id = COALESCE(payment_id, ?) WHERE order_id = ?")
      .bind(paymentId, orderId).run();
    return true;
  }
  if (order.payment_status === "SUCCESS") return false;
  const ads = PLAN_CONFIG[order.plan]?.ads;
  if (!ads || order.amount !== PLAN_CONFIG[order.plan].prices[order.currency] * 100) return false;
  const now = new Date().toISOString();
  const end = addBillingMonth(now);
  // The batch is one D1 transaction. Conditional updates make a concurrent
  // duplicate activation observe the first committed state and never activate twice.
  const results = await database.batch([
    { sql: `INSERT OR IGNORE INTO billing_accounts
      (user_id, plan, currency, status, period_start, period_end, ads_allowed, updated_at)
      SELECT user_id, 'free', 'INR', 'active', ?, ?, 3, ? FROM payment_orders WHERE order_id = ?`,
      values: [now, end, now, orderId] },
    { sql: `UPDATE billing_accounts SET plan = ?, currency = ?, status = 'active', period_start = ?,
      period_end = ?, ads_allowed = ?, ads_used = 0, ads_reserved = 0, updated_at = ?
      WHERE user_id = ? AND (plan = 'free' OR period_end <= ?)
      AND EXISTS (SELECT 1 FROM payment_orders WHERE order_id = ? AND payment_status <> 'SUCCESS'
        AND plan = ? AND currency = ? AND amount = ?)`,
      values: [order.plan, order.currency, now, end, ads, now, order.user_id, now, orderId, order.plan, order.currency, order.amount] },
    { sql: `UPDATE payment_orders SET payment_status = 'SUCCESS', payment_id = ?, subscription_status = 'active', updated_at = ?
      WHERE order_id = ? AND payment_status <> 'SUCCESS'
      AND EXISTS (SELECT 1 FROM billing_accounts WHERE user_id = ? AND plan = ? AND period_start = ?)` ,
      values: [paymentId || null, now, orderId, order.user_id, order.plan, now] },
    { sql: `UPDATE payment_orders SET payment_status = 'SUCCESS', payment_id = ?,
      subscription_status = 'blocked_active_plan', updated_at = ? WHERE order_id = ? AND payment_status <> 'SUCCESS'
      AND EXISTS (SELECT 1 FROM billing_accounts WHERE user_id = ? AND plan <> 'free' AND period_end > ?)`,
      values: [paymentId || null, now, orderId, order.user_id, now] },
  ]);
  return results[2]?.meta?.changes === 1;
}

export async function markOrderFailed(orderId, paymentId, paymentStatus) {
  await database.prepare(`UPDATE payment_orders SET payment_status = ?, payment_id = COALESCE(?, payment_id),
    subscription_status = 'not_activated', updated_at = ? WHERE order_id = ? AND payment_status <> 'SUCCESS'`)
    .bind(paymentStatus, paymentId || null, new Date().toISOString(), orderId).run();
}

export async function recordPaymentVerificationAttempt(orderId, paymentId, status) {
  await database.prepare(`UPDATE payment_orders SET payment_id = COALESCE(?, payment_id),
    subscription_status = ?, updated_at = ? WHERE order_id = ? AND payment_status <> 'SUCCESS'`)
    .bind(paymentId || null, status, new Date().toISOString(), orderId).run();
}

export async function getPendingOrderForUser(orderId, userId) {
  return database.prepare("SELECT * FROM payment_orders WHERE order_id = ? AND user_id = ?")
    .bind(orderId, userId).first();
}

export async function hasPendingPaymentOrder(userId) {
  return Boolean(await database.prepare("SELECT 1 FROM payment_orders WHERE user_id = ? AND payment_status IN ('CREATING', 'PENDING') LIMIT 1")
    .bind(userId).first());
}

export async function getPendingPaymentOrder(userId) {
  return database.prepare("SELECT * FROM payment_orders WHERE user_id = ? AND payment_status IN ('CREATING', 'PENDING') ORDER BY created_at DESC LIMIT 1")
    .bind(userId).first();
}

async function handleGoogleLogin(req, res) {
  if (!hasValidOrigin(req)) {
    json(res, 403, { error: "Request origin is not allowed.", code: "INVALID_ORIGIN" });
    return;
  }
  if (!googleClientId()) {
    json(res, 503, {
      error: "Google sign-in is not configured. Set GOOGLE_CLIENT_ID in .env.",
      code: "GOOGLE_NOT_CONFIGURED",
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    json(res, error.status || 400, { error: error.message, code: "INVALID_REQUEST" });
    return;
  }
  if (typeof body.credential !== "string" || body.credential.length > 16_000) {
    json(res, 400, { error: "A Google ID credential is required.", code: "INVALID_CREDENTIAL" });
    return;
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: body.credential,
      audience: googleClientId(),
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) {
      json(res, 401, { error: "Google did not return a valid account identity.", code: "INVALID_CREDENTIAL" });
      return;
    }

    const user = await upsertGoogleUser(payload);
    const token = await issueSession(user.id);
    json(res, 200, { user: publicUser(user) }, {
      "Set-Cookie": cookieHeader(token, Math.floor(SESSION_TTL_MS / 1000)),
    });
  } catch (error) {
    console.warn("Google ID token verification failed:", error.message);
    json(res, 401, { error: "Google sign-in could not be verified. Please try again.", code: "INVALID_CREDENTIAL" });
  }
}

async function handleSignOut(req, res) {
  if (!hasValidOrigin(req)) {
    json(res, 403, { error: "Request origin is not allowed.", code: "INVALID_ORIGIN" });
    return;
  }
  const token = cookieValue(req, sessionCookieName());
  if (token) await database.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(hashSession(token)).run();
  json(res, 200, { signedOut: true }, { "Set-Cookie": cookieHeader("", 0) });
}

export async function handleAuthRoutes(req, res) {
  const url = new URL(req.url || "/", "http://localhost").pathname;
  if (!url.startsWith("/api/auth/")) return false;

  if (req.method === "GET" && url === "/api/auth/config") {
    json(res, 200, { clientId: googleClientId() });
    return true;
  }
  if (req.method === "GET" && url === "/api/auth/me") {
    const user = await getAuthenticatedUser(req);
    json(res, 200, user ? { authenticated: true, user } : { authenticated: false, user: null });
    return true;
  }
  if (req.method === "POST" && url === "/api/auth/google") {
    await handleGoogleLogin(req, res);
    return true;
  }
  if (req.method === "POST" && url === "/api/auth/logout") {
    await handleSignOut(req, res);
    return true;
  }
  json(res, 404, { error: "Authentication endpoint not found." });
  return true;
}
