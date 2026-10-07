import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { PassThrough } from "node:stream";

const testDir = mkdtempSync(join(tmpdir(), "adspark-razorpay-"));
process.env.AUTH_DB_PATH = join(testDir, "billing.sqlite");
process.env.AI_PROVIDER = "ollama";
process.env.RAZORPAY_KEY_ID = "rzp_test_example";
process.env.RAZORPAY_KEY_SECRET = "razorpay-test-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "razorpay-webhook-test-secret";
process.env.RAZORPAY_ENVIRONMENT = "test";
process.env.APP_ORIGIN = "http://localhost:5173";
process.env.CLOUDFLARE_ACCOUNT_ID = "billing-image-test-account";
process.env.CLOUDFLARE_API_TOKEN = "billing-image-test-secret";
process.env.CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-test-model";

const auth = await import("../server/auth.js");
const { handlePaymentRoutes } = await import("../server/payments.js");
const { handleApiRoutes } = await import("../server/apiRouter.js");

function request(body = "", headers = {}) {
  const chunks = body ? [Buffer.from(body)] : [];
  return Object.assign((async function* () { yield* chunks; })(), { method: "POST", headers });
}

function responseCapture() {
  return {
    status: 0,
    body: "",
    writeHead(status) { this.status = status; },
    end(body = "") { this.body = body; },
    json() { return JSON.parse(this.body || "{}"); },
  };
}

function checkoutSignature(orderId, paymentId) {
  return createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
}

function webhookRequest(event) {
  const body = JSON.stringify(event);
  const signature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");
  return request(body, { "x-razorpay-signature": signature });
}

const user = await auth.upsertGoogleUser({ sub: "billing-test-user", email: "billing@example.test", name: "Billing Test" });

after(() => {
  auth.closeAuthDatabase();
  rmSync(testDir, { recursive: true, force: true });
});

test("Free plan has three ads and concurrent reservations cannot exceed its allowance", async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => auth.reserveAdUsage(user.id)));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal((await auth.getBillingStatus(user.id)).adsAllowed, 3);
  assert.equal((await auth.getBillingStatus(user.id)).adsRemaining, 0);
  for (let i = 0; i < 3; i++) await auth.settleAdUsage(user.id, false);
  assert.equal((await auth.getBillingStatus(user.id)).adsUsed, 0);
  assert.equal((await auth.getBillingStatus(user.id)).adsRemaining, 3);
});

test("Starter, Pro, and Business activation sets exact allowances once", async () => {
  const allowances = { starter: 20, pro: 45, business: 108 };
  for (const [plan, ads] of Object.entries(allowances)) {
    const planUser = await auth.upsertGoogleUser({ sub: `billing-${plan}`, email: `${plan}@example.test` });
    const orderId = `order_test_${plan}`;
    const amount = auth.PLAN_CONFIG[plan].prices.INR * 100;
    await auth.createPaymentOrderRecord({ orderId, userId: planUser.id, plan, currency: "INR", amount });
    assert.equal(await auth.activatePaidOrder(orderId, `pay_test_${plan}`), true);
    assert.equal((await auth.getBillingStatus(planUser.id)).adsAllowed, ads);
    await auth.reserveAdUsage(planUser.id);
    await auth.settleAdUsage(planUser.id, true);
    assert.equal(await auth.activatePaidOrder(orderId, `pay_duplicate_${plan}`), true);
    assert.equal((await auth.getBillingStatus(planUser.id)).adsUsed, 1);
  }
});

test("authenticated order creation uses server USD pricing and returns only safe Checkout data", async () => {
  const checkoutUser = await auth.upsertGoogleUser({ sub: "billing-checkout", email: "checkout@example.test" });
  assert.equal(await auth.hasPendingPaymentOrder(checkoutUser.id), false);
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url: String(url), body: JSON.parse(options.body), headers: options.headers };
    return new Response(JSON.stringify({ id: "order_test_usd", amount: 1200, currency: "USD", status: "created" }), { status: 200 });
  };
  try {
    const res = responseCapture();
    await handlePaymentRoutes(request(JSON.stringify({ plan: "pro", currency: "USD", amount: 1, userId: 99999 })), res, checkoutUser, "/api/payments/create-order");
    assert.equal(res.status, 200, res.body);
    assert.equal(sent.url, "https://api.razorpay.com/v1/orders");
    assert.equal(sent.body.amount, 1200);
    assert.equal(sent.body.currency, "USD");
    assert.equal(res.json().orderId, "order_test_usd");
    assert.equal(res.json().amount, 1200);
    assert.equal(res.json().keyId, "rzp_test_example");
    assert.equal(JSON.stringify(res.json()).includes("razorpay-test-secret"), false);
    assert.equal((await auth.getPaymentOrder("order_test_usd")).user_id, checkoutUser.id);
  } finally { globalThis.fetch = originalFetch; }
});

test("unauthenticated users cannot create Razorpay orders", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("must not call Razorpay"); };
  try {
    const res = responseCapture();
    await handlePaymentRoutes(request(JSON.stringify({ plan: "pro", currency: "INR" })), res, null, "/api/payments/create-order");
    assert.equal(res.status, 401);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("USD unsupported response is explicit and does not create a plan", async () => {
  const usdUser = await auth.upsertGoogleUser({ sub: "billing-usd-disabled", email: "usd@example.test" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "BAD_REQUEST_ERROR", description: "International payments are not enabled for this account" } }), { status: 400 });
  try {
    const res = responseCapture();
    await handlePaymentRoutes(request(JSON.stringify({ plan: "pro", currency: "USD" })), res, usdUser, "/api/payments/create-order");
    assert.equal(res.status, 400);
    assert.equal(res.json().error, "USD payments are not currently enabled for this Razorpay account.");
    assert.equal((await auth.getBillingStatus(usdUser.id)).plan, "free");
  } finally { globalThis.fetch = originalFetch; }
});

test("checkout signature, API payment/order status, amount, and currency are verified before activation", async () => {
  const verificationUser = await auth.upsertGoogleUser({ sub: "billing-verification", email: "verify@example.test" });
  const orderId = "order_test_verify";
  await auth.createPaymentOrderRecord({ orderId, userId: verificationUser.id, plan: "pro", currency: "INR", amount: 69900 });
  const originalFetch = globalThis.fetch;
  let paymentResponse = { id: "pay_test_verify", order_id: orderId, amount: 69900, currency: "INR", status: "captured", captured: true };
  let orderResponse = { id: orderId, amount: 69900, amount_paid: 69900, currency: "INR", status: "paid" };
  globalThis.fetch = async (url) => String(url).includes("/payments/")
    ? new Response(JSON.stringify(paymentResponse), { status: 200 })
    : new Response(JSON.stringify(orderResponse), { status: 200 });
  try {
    const forged = responseCapture();
    await handlePaymentRoutes(request(JSON.stringify({
      orderId, razorpay_order_id: orderId, razorpay_payment_id: paymentResponse.id, razorpay_signature: "0".repeat(64),
    })), forged, verificationUser, "/api/payments/verify");
    assert.equal(forged.status, 401);
    assert.equal((await auth.getBillingStatus(verificationUser.id)).plan, "free");

    const amountMismatch = responseCapture();
    paymentResponse = { ...paymentResponse, amount: 100 };
    await handlePaymentRoutes(request(JSON.stringify({
      orderId, razorpay_order_id: orderId, razorpay_payment_id: "pay_test_verify", razorpay_signature: checkoutSignature(orderId, "pay_test_verify"),
    })), amountMismatch, verificationUser, "/api/payments/verify");
    assert.equal(amountMismatch.status, 409);
    assert.equal((await auth.getBillingStatus(verificationUser.id)).plan, "free");

    paymentResponse = { ...paymentResponse, amount: 69900, currency: "USD" };
    const currencyMismatch = responseCapture();
    await handlePaymentRoutes(request(JSON.stringify({
      orderId, razorpay_order_id: orderId, razorpay_payment_id: "pay_test_verify", razorpay_signature: checkoutSignature(orderId, "pay_test_verify"),
    })), currencyMismatch, verificationUser, "/api/payments/verify");
    assert.equal(currencyMismatch.status, 409);
    assert.equal((await auth.getBillingStatus(verificationUser.id)).plan, "free");

    paymentResponse = { ...paymentResponse, currency: "INR" };
    const valid = responseCapture();
    await handlePaymentRoutes(request(JSON.stringify({
      orderId, razorpay_order_id: orderId, razorpay_payment_id: "pay_test_verify", razorpay_signature: checkoutSignature(orderId, "pay_test_verify"),
    })), valid, verificationUser, "/api/payments/verify");
    assert.equal(valid.status, 200);
    assert.equal(valid.json().billing.adsAllowed, 45);
    await auth.reserveAdUsage(verificationUser.id);
    await auth.settleAdUsage(verificationUser.id, true);
    const duplicate = responseCapture();
    await handlePaymentRoutes(request(JSON.stringify({ orderId })), duplicate, verificationUser, "/api/payments/verify");
    assert.equal(duplicate.status, 200);
    assert.equal((await auth.getBillingStatus(verificationUser.id)).adsUsed, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("Razorpay webhook signature, capture, failure, and duplicate delivery are safe", async () => {
  const webhookUser = await auth.upsertGoogleUser({ sub: "billing-webhook", email: "webhook@example.test" });
  const capturedOrderId = "order_test_webhook";
  const capturedPaymentId = "pay_test_webhook";
  await auth.createPaymentOrderRecord({ orderId: capturedOrderId, userId: webhookUser.id, plan: "pro", currency: "INR", amount: 69900 });
  const failedUser = await auth.upsertGoogleUser({ sub: "billing-webhook-failed", email: "webhook-failed@example.test" });
  const failedOrderId = "order_test_failed";
  await auth.createPaymentOrderRecord({ orderId: failedOrderId, userId: failedUser.id, plan: "starter", currency: "INR", amount: 29900 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/payments/pay_test_webhook")) return new Response(JSON.stringify({ id: capturedPaymentId, order_id: capturedOrderId, amount: 69900, currency: "INR", status: "captured", captured: true }), { status: 200 });
    if (String(url).includes(`/orders/${capturedOrderId}`)) return new Response(JSON.stringify({ id: capturedOrderId, amount: 69900, amount_paid: 69900, currency: "INR", status: "paid" }), { status: 200 });
    if (String(url).includes("/payments/pay_test_failed")) return new Response(JSON.stringify({ id: "pay_test_failed", order_id: failedOrderId, amount: 29900, currency: "INR", status: "failed", captured: false }), { status: 200 });
    throw new Error(`Unexpected Razorpay request ${url}`);
  };
  const capturedEvent = { event: "payment.captured", payload: { payment: { entity: { id: capturedPaymentId, order_id: capturedOrderId } } } };
  try {
    const invalid = responseCapture();
    await handlePaymentRoutes(request(JSON.stringify(capturedEvent)), invalid, null, "/api/payments/webhook");
    assert.equal(invalid.status, 401);
    assert.equal((await auth.getBillingStatus(webhookUser.id)).plan, "free");

    for (let i = 0; i < 2; i++) {
      const verified = responseCapture();
      await handlePaymentRoutes(webhookRequest(capturedEvent), verified, null, "/api/payments/webhook");
      assert.equal(verified.status, 200);
    }
    assert.equal((await auth.getBillingStatus(webhookUser.id)).plan, "pro");
    await auth.reserveAdUsage(webhookUser.id);
    await auth.settleAdUsage(webhookUser.id, true);
    const duplicate = responseCapture();
    await handlePaymentRoutes(webhookRequest(capturedEvent), duplicate, null, "/api/payments/webhook");
    assert.equal(duplicate.status, 200);
    assert.equal((await auth.getBillingStatus(failedUser.id)).adsAllowed, 3);
    assert.equal((await auth.getBillingStatus(webhookUser.id)).adsUsed, 1);

    const failedEvent = { event: "payment.failed", payload: { payment: { entity: { id: "pay_test_failed", order_id: failedOrderId } } } };
    const failed = responseCapture();
    await handlePaymentRoutes(webhookRequest(failedEvent), failed, null, "/api/payments/webhook");
    assert.equal(failed.status, 200);
    assert.equal((await auth.getPaymentOrder(failedOrderId)).payment_status, "FAILED");
    assert.equal((await auth.getBillingStatus(webhookUser.id)).adsAllowed, 45);
  } finally { globalThis.fetch = originalFetch; }
});

test("generation failure does not consume allowance and exhaustion blocks Ollama", async () => {
  const generationUser = await auth.upsertGoogleUser({ sub: "billing-generation", email: "generation@example.test" });
  const token = await auth.issueSession(generationUser.id);
  const originalFetch = globalThis.fetch;
  let chatCalls = 0;
  let imageCalls = 0;
  let failNextChat = true;
  let failNextImage = false;
  const imageBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
  const concept = (variationId) => ({ variationId, conceptName: "Concept", headline: "Headline", subheadline: "Subheadline", benefit: "Benefit", offer: "Offer", cta: "Contact us", caption: "Caption", whatsappMessage: "Message", shortAdCopy: "Ad copy", visualPrompt: "A shop", designDirection: "Minimal" });
  const campaign = JSON.stringify({ analysis: { businessCore: "Shop", targetAudience: "Customers", strongestBenefit: "Quality", sellingAngle: "Value" }, concepts: [concept("luxury"), concept("bold"), concept("minimal")] });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "llama3.2:latest" }] }), { status: 200 });
    if (String(url).includes("/ai/run/")) {
      imageCalls++;
      if (failNextImage) { failNextImage = false; return new Response("image capacity unavailable", { status: 429 }); }
      return new Response(JSON.stringify({ result: { image: imageBase64 } }), { status: 200 });
    }
    if (String(url).endsWith("/api/chat")) {
      chatCalls++;
      if (failNextChat) { failNextChat = false; return new Response("generation failed", { status: 500 }); }
      return new Response(JSON.stringify({ message: { content: campaign } }), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  async function generateOnce() {
    const req = new PassThrough();
    req.method = "POST";
    req.url = "/api/generate-ad";
    req.headers = { origin: "http://localhost:5173", cookie: `adspark_session=${token}` };
    const res = responseCapture();
    const done = new Promise((resolve) => { res.end = (body = "") => { res.body = body; resolve(res); }; });
    const handler = handleApiRoutes(req, res, () => {});
    req.end(JSON.stringify({ businessName: "Test Shop", productService: "Coffee", priceOffer: "₹99" }));
    await handler;
    return done;
  }
  try {
    assert.equal((await generateOnce()).status, 502);
    assert.equal((await auth.getBillingStatus(generationUser.id)).adsUsed, 0);
    failNextImage = true;
    const generations = [];
    for (let i = 0; i < 3; i++) generations.push(await generateOnce());
    assert.ok(generations.every((response) => response.status === 200));
    assert.equal(generations[0].json().visualSource, "TEMPLATE_FALLBACK");
    assert.ok(generations[0].json().concepts.every((entry) => entry.visualSource === "TEMPLATE_FALLBACK"));
    assert.equal(generations[1].json().visualSource, "CUSTOM_AI_VISUAL");
    assert.equal(generations[1].json().concepts.filter((entry) => entry.aiImageUrl).length, 3);
    assert.equal(imageCalls, 7);
    assert.equal((await auth.getBillingStatus(generationUser.id)).adsUsed, 3);
    const before = chatCalls;
    const exhausted = await generateOnce();
    assert.equal(exhausted.status, 429);
    assert.equal(exhausted.json().code, "USAGE_LIMIT_REACHED");
    assert.equal(chatCalls, before);
  } finally { globalThis.fetch = originalFetch; }
});

test("standalone visual regeneration is bounded by the same existing ad allowance", async () => {
  const visualUser = await auth.upsertGoogleUser({ sub: "billing-visual-user", email: "visual@example.test" });
  const token = await auth.issueSession(visualUser.id);
  const originalFetch = globalThis.fetch;
  let imageCalls = 0;
  const imageBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
  globalThis.fetch = async (url) => {
    imageCalls++;
    assert.ok(String(url).includes("/ai/run/"));
    return new Response(JSON.stringify({ result: { image: imageBase64 } }), { status: 200 });
  };
  async function generateVisualOnce() {
    const req = new PassThrough();
    req.method = "POST";
    req.url = "/api/generate-visual";
    req.headers = { origin: "http://localhost:5173", cookie: `adspark_session=${token}` };
    const res = responseCapture();
    const done = new Promise((resolve) => { res.end = (body = "") => { res.body = body; resolve(res); }; });
    const handler = handleApiRoutes(req, res, () => {});
    req.end(JSON.stringify({ visualPrompt: "A cafe product photo, no text.", variationId: "bold" }));
    await handler;
    return done;
  }
  try {
    for (let i = 0; i < 3; i++) assert.equal((await generateVisualOnce()).status, 200);
    const exhausted = await generateVisualOnce();
    assert.equal(exhausted.status, 429);
    assert.equal(exhausted.json().code, "USAGE_LIMIT_REACHED");
    assert.equal(imageCalls, 3);
    assert.equal((await auth.getBillingStatus(visualUser.id)).adsUsed, 3);
  } finally { globalThis.fetch = originalFetch; }
});

test("active source and frontend bundle configuration contain no Cashfree or Razorpay secret", async () => {
  for (const path of ["../src/App.tsx", "../src/globals.d.ts", "../server/payments.js", "../server/apiRouter.js", "../index.html", "../.env.example", "../README.md"]) {
    assert.equal(readFileSync(new URL(path, import.meta.url), "utf8").includes("CASHFREE"), false, `${path} still references Cashfree`);
  }
});
