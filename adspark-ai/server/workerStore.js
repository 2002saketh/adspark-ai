import { createD1Database } from "./db.js";
import { PLAN_CONFIG } from "./plans.js";

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function addBillingMonth(date) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next.toISOString();
}

async function hashSession(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function createWorkerStore(env) {
  const database = createD1Database(env);
  async function ensureBillingAccount(userId) {
    const now = new Date().toISOString();
    let row = await database.prepare("SELECT * FROM billing_accounts WHERE user_id = ?").bind(userId).first();
    if (!row) {
      await database.prepare(`INSERT OR IGNORE INTO billing_accounts
        (user_id, plan, currency, status, period_start, period_end, ads_allowed, updated_at)
        VALUES (?, 'free', 'INR', 'active', ?, ?, 3, ?)`)
        .bind(userId, now, addBillingMonth(now), now).run();
      row = await database.prepare("SELECT * FROM billing_accounts WHERE user_id = ?").bind(userId).first();
    }
    if (Date.parse(row.period_end) <= Date.now()) {
      await database.prepare(`UPDATE billing_accounts SET plan = 'free', status = 'active', period_start = ?,
        period_end = ?, ads_allowed = 3, ads_used = 0, ads_reserved = 0, updated_at = ? WHERE user_id = ?`)
        .bind(now, addBillingMonth(now), now, userId).run();
      row = await database.prepare("SELECT * FROM billing_accounts WHERE user_id = ?").bind(userId).first();
    }
    return row;
  }

  return {
    async upsertGoogleUser(payload) {
      const now = new Date().toISOString();
      const user = await database.prepare(`INSERT INTO users
        (google_sub, email, name, picture, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name,
        picture = excluded.picture, last_login_at = excluded.last_login_at
        RETURNING id, email, name, picture`)
        .bind(payload.sub, payload.email || null, payload.name || null,
          typeof payload.picture === "string" && payload.picture.startsWith("https://") ? payload.picture : null,
          now, now).first();
      await database.prepare(`INSERT OR IGNORE INTO billing_accounts
        (user_id, plan, currency, status, period_start, period_end, ads_allowed, ads_used, ads_reserved, updated_at)
        VALUES (?, 'free', 'INR', 'active', ?, ?, 3, 0, 0, ?)`)
        .bind(user.id, now, addBillingMonth(now), now).run();
      return user;
    },
    async issueSession(userId) {
      const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
      const token = btoa(String.fromCharCode(...tokenBytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
      const now = Date.now();
      await database.prepare("INSERT INTO sessions (session_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .bind(await hashSession(token), userId, now + SESSION_TTL_MS, new Date(now).toISOString()).run();
      return token;
    },
    async getAuthenticatedUser(token) {
      if (!/^[A-Za-z0-9_-]{40,50}$/.test(token || "")) return null;
      const now = Date.now();
      await database.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
      const user = await database.prepare(`SELECT users.id, users.email, users.name, users.picture
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.session_hash = ? AND sessions.expires_at > ?`)
        .bind(await hashSession(token), now).first();
      return user ? { id: user.id, email: user.email || "", name: user.name || user.email || "Google user", picture: user.picture || "" } : null;
    },
    async deleteSession(token) {
      if (token) await database.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(await hashSession(token)).run();
    },
    async getBillingStatus(userId) {
      const row = await ensureBillingAccount(userId);
      return { plan: row.plan, currency: row.currency, status: row.status,
        periodStart: row.period_start, periodEnd: row.period_end, adsAllowed: row.ads_allowed,
        adsUsed: row.ads_used, adsRemaining: Math.max(0, row.ads_allowed - row.ads_used - row.ads_reserved) };
    },
    async reserveAdUsage(userId) {
      const now = new Date().toISOString();
      const end = addBillingMonth(now);
      const result = await database.batch([
        { sql: `INSERT OR IGNORE INTO billing_accounts
          (user_id, plan, currency, status, period_start, period_end, ads_allowed, updated_at)
          VALUES (?, 'free', 'INR', 'active', ?, ?, 3, ?)`, values: [userId, now, end, now] },
        { sql: `UPDATE billing_accounts SET plan = 'free', status = 'active', period_start = ?, period_end = ?,
          ads_allowed = 3, ads_used = 0, ads_reserved = 0, updated_at = ? WHERE user_id = ? AND period_end <= ?`,
          values: [now, end, now, userId, now] },
        { sql: `UPDATE billing_accounts SET ads_reserved = ads_reserved + 1, updated_at = ?
          WHERE user_id = ? AND ads_used + ads_reserved < ads_allowed`, values: [now, userId] },
      ]);
      return result[2]?.meta?.changes === 1;
    },
    async settleAdUsage(userId, succeeded) {
      const now = new Date().toISOString();
      const operations = [{ sql: `UPDATE billing_accounts SET ads_reserved = MAX(0, ads_reserved - 1),
        ads_used = ads_used + ?, updated_at = ? WHERE user_id = ?`, values: [succeeded ? 1 : 0, now, userId] }];
      if (succeeded) operations.push({ sql: "INSERT INTO generations (user_id, created_at) VALUES (?, ?)", values: [userId, now] });
      await database.batch(operations);
    },
    async recordGeneration(userId) {
      await database.prepare("INSERT INTO generations (user_id, created_at) VALUES (?, ?)").bind(userId, new Date().toISOString()).run();
    },
    async createPaymentOrderRecord({ orderId, userId, plan, currency, amount }) {
      const now = new Date().toISOString();
      const result = await database.prepare(`INSERT OR IGNORE INTO payment_orders
        (order_id, user_id, plan, currency, amount, payment_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'CREATING', ?, ?)`)
        .bind(orderId, userId, plan, currency, amount, now, now).run();
      return result.meta?.changes === 1;
    },
    async attachRazorpayOrder(localOrderId, razorpayOrderId) {
      await database.prepare(`UPDATE payment_orders SET order_id = ?, payment_status = 'PENDING', updated_at = ?
        WHERE order_id = ? AND payment_status = 'CREATING'`)
        .bind(razorpayOrderId, new Date().toISOString(), localOrderId).run();
    },
    getPaymentOrder(orderId) { return database.prepare("SELECT * FROM payment_orders WHERE order_id = ?").bind(orderId).first(); },
    getPendingOrderForUser(orderId, userId) {
      return database.prepare("SELECT * FROM payment_orders WHERE order_id = ? AND user_id = ?").bind(orderId, userId).first();
    },
    getPendingPaymentOrder(userId) {
      return database.prepare(`SELECT * FROM payment_orders WHERE user_id = ? AND payment_status IN ('CREATING', 'PENDING')
        ORDER BY created_at DESC LIMIT 1`).bind(userId).first();
    },
    async markOrderFailed(orderId, paymentId, paymentStatus) {
      await database.prepare(`UPDATE payment_orders SET payment_status = ?, payment_id = COALESCE(?, payment_id),
        subscription_status = 'not_activated', updated_at = ? WHERE order_id = ? AND payment_status <> 'SUCCESS'`)
        .bind(paymentStatus, paymentId || null, new Date().toISOString(), orderId).run();
    },
    async recordPaymentVerificationAttempt(orderId, paymentId, status) {
      await database.prepare(`UPDATE payment_orders SET payment_id = COALESCE(?, payment_id),
        subscription_status = ?, updated_at = ? WHERE order_id = ? AND payment_status <> 'SUCCESS'`)
        .bind(paymentId || null, status, new Date().toISOString(), orderId).run();
    },
    async activatePaidOrder(orderId, paymentId) {
      const order = await database.prepare("SELECT * FROM payment_orders WHERE order_id = ?").bind(orderId).first();
      if (!order) return false;
      if (order.payment_status === "SUCCESS" && order.subscription_status === "active") {
        if (paymentId) await database.prepare("UPDATE payment_orders SET payment_id = COALESCE(payment_id, ?) WHERE order_id = ?")
          .bind(paymentId, orderId).run();
        return true;
      }
      if (order.payment_status === "SUCCESS") return false;
      const plan = PLAN_CONFIG[order.plan];
      if (!plan || order.amount !== plan.prices[order.currency] * 100) return false;
      const now = new Date().toISOString();
      const end = addBillingMonth(now);
      const results = await database.batch([
        { sql: `INSERT OR IGNORE INTO billing_accounts
          (user_id, plan, currency, status, period_start, period_end, ads_allowed, updated_at)
          SELECT user_id, 'free', 'INR', 'active', ?, ?, 3, ? FROM payment_orders WHERE order_id = ?`,
          values: [now, end, now, orderId] },
        { sql: `UPDATE billing_accounts SET plan = ?, currency = ?, status = 'active', period_start = ?, period_end = ?,
          ads_allowed = ?, ads_used = 0, ads_reserved = 0, updated_at = ? WHERE user_id = ? AND (plan = 'free' OR period_end <= ?)
          AND EXISTS (SELECT 1 FROM payment_orders WHERE order_id = ? AND payment_status <> 'SUCCESS' AND plan = ? AND currency = ? AND amount = ?)`,
          values: [order.plan, order.currency, now, end, plan.ads, now, order.user_id, now, orderId, order.plan, order.currency, order.amount] },
        { sql: `UPDATE payment_orders SET payment_status = 'SUCCESS', payment_id = ?, subscription_status = 'active', updated_at = ?
          WHERE order_id = ? AND payment_status <> 'SUCCESS'
          AND EXISTS (SELECT 1 FROM billing_accounts WHERE user_id = ? AND plan = ? AND period_start = ?)`,
          values: [paymentId || null, now, orderId, order.user_id, order.plan, now] },
        { sql: `UPDATE payment_orders SET payment_status = 'SUCCESS', payment_id = ?, subscription_status = 'blocked_active_plan', updated_at = ?
          WHERE order_id = ? AND payment_status <> 'SUCCESS'
          AND EXISTS (SELECT 1 FROM billing_accounts WHERE user_id = ? AND plan <> 'free' AND period_end > ?)`,
          values: [paymentId || null, now, orderId, order.user_id, now] },
      ]);
      return results[2]?.meta?.changes === 1;
    },
  };
}

export { SESSION_TTL_MS };
