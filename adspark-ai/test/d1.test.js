import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test, { after, before } from "node:test";
import { getPlatformProxy } from "wrangler";

const sqlitePath = join(tmpdir(), `adspark-d1-test-${randomUUID()}.sqlite`);
process.env.AUTH_DB_PATH = sqlitePath;
const auth = await import("../server/auth.js");
const { createD1Database } = await import("../server/db.js");
let platform;
let db;
const subs = [];

before(async () => {
  const migration = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", [
    "wrangler", "d1", "migrations", "apply", "adspark-production", "--local", "--config", "wrangler.d1test.jsonc",
  ], { encoding: "utf8", shell: process.platform === "win32" });
  if (migration.status !== 0) throw new Error("Could not apply the D1 schema migration to the local Wrangler database.");
  platform = await getPlatformProxy({
    configPath: "./wrangler.d1test.jsonc",
    remoteBindings: false,
  });
  db = createD1Database(platform.env);
  auth.setAuthDatabase(platform.env);
});

after(async () => {
  for (const sub of subs) await db.prepare("DELETE FROM users WHERE google_sub = ?").bind(sub).run();
  auth.setAuthDatabase(null);
  auth.closeAuthDatabase();
  await platform?.dispose();
});

async function createUser(label) {
  const sub = `d1-test-${label}-${randomUUID()}`;
  subs.push(sub);
  return auth.upsertGoogleUser({ sub, email: `${sub}@example.test`, name: label });
}

test("D1 creates users, enforces Google sub uniqueness, and isolates user records", async () => {
  const user = await createUser("user");
  const duplicate = await auth.upsertGoogleUser({ sub: subs.at(-1), email: "updated@example.test" });
  assert.equal(duplicate.id, user.id);
  const other = await createUser("other");
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM users WHERE google_sub = ?").bind(subs.at(-1)).first("count"), 1);

  const orderId = `order_${randomUUID()}`;
  assert.equal(await auth.createPaymentOrderRecord({ orderId, userId: user.id, plan: "starter", currency: "INR", amount: 29900 }), true);
  assert.equal(await auth.getPendingOrderForUser(orderId, other.id), null);
});

test("D1 sessions expire, resolve to their user, and can be revoked", async () => {
  const user = await createUser("session");
  const token = await auth.issueSession(user.id);
  const request = { headers: { cookie: `adspark_session=${token}` } };
  assert.equal((await auth.getAuthenticatedUser(request)).id, user.id);
  const hash = await db.prepare("SELECT session_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").bind(user.id).first("session_hash");
  await db.prepare("UPDATE sessions SET expires_at = 0 WHERE session_hash = ?").bind(hash).run();
  assert.equal(await auth.getAuthenticatedUser(request), null);
  await db.prepare("DELETE FROM sessions WHERE session_hash = ?").bind(hash).run();
  assert.equal(await db.prepare("SELECT 1 FROM sessions WHERE session_hash = ?").bind(hash).first(), null);
});

test("D1 reservations enforce concurrent limits, refunds, and generation ownership", async () => {
  const user = await createUser("billing");
  const reservations = await Promise.all(Array.from({ length: 12 }, () => auth.reserveAdUsage(user.id)));
  assert.equal(reservations.filter(Boolean).length, 3);
  for (let index = 0; index < 3; index++) await auth.settleAdUsage(user.id, false);
  assert.equal((await auth.getBillingStatus(user.id)).adsRemaining, 3);
  assert.equal(await auth.reserveAdUsage(user.id), true);
  await auth.settleAdUsage(user.id, true);
  assert.equal((await auth.getBillingStatus(user.id)).adsUsed, 1);
  assert.equal(await auth.getGenerationCountForUser(user.id), 1);
});

test("D1 pending-order uniqueness and duplicate plan activation are preserved", async () => {
  const user = await createUser("payment");
  const firstId = `order_${randomUUID()}`;
  const secondId = `order_${randomUUID()}`;
  assert.equal(await auth.createPaymentOrderRecord({ orderId: firstId, userId: user.id, plan: "pro", currency: "INR", amount: 69900 }), true);
  assert.equal(await auth.createPaymentOrderRecord({ orderId: secondId, userId: user.id, plan: "pro", currency: "INR", amount: 69900 }), false);
  await auth.markOrderFailed(firstId, null, "FAILED");
  assert.equal(await auth.createPaymentOrderRecord({ orderId: secondId, userId: user.id, plan: "pro", currency: "INR", amount: 69900 }), true);
  assert.equal(await auth.activatePaidOrder(secondId, "pay_d1_test"), true);
  assert.equal(await auth.activatePaidOrder(secondId, "pay_duplicate"), true);
  assert.equal((await auth.getBillingStatus(user.id)).adsAllowed, 45);
  assert.equal((await auth.getPaymentOrder(secondId)).payment_id, "pay_d1_test");
});
