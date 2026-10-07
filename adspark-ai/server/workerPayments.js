import { PLAN_CONFIG } from "./plans.js";

const API_BASE = "https://api.razorpay.com/v1";

function json(status, data) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function config(env) {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  const environment = env.RAZORPAY_ENVIRONMENT?.trim().toLowerCase() || "test";
  if (!keyId || !keySecret) throw Object.assign(new Error("Razorpay is not configured."), { status: 503 });
  if (!((environment === "test" && keyId.startsWith("rzp_test_")) || (environment === "live" && keyId.startsWith("rzp_live_")))) {
    throw Object.assign(new Error("Razorpay environment does not match its key."), { status: 503 });
  }
  return { keyId, keySecret, environment };
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, value instanceof Uint8Array ? value : new TextEncoder().encode(value)));
}

function equalHex(expected, received) {
  if (typeof received !== "string" || !/^[a-f\d]{64}$/i.test(received)) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++) mismatch |= expected.charCodeAt(index) ^ received.toLowerCase().charCodeAt(index);
  return mismatch === 0;
}

async function readJson(request, limit = 20_000) {
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > limit) throw Object.assign(new Error("Request body is too large."), { status: 413 });
  try { return JSON.parse(new TextDecoder().decode(raw) || "{}"); }
  catch { throw Object.assign(new Error("Invalid JSON body."), { status: 400 }); }
}

async function razorpayRequest(env, path, options = {}) {
  const credentials = config(env);
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { Authorization: `Basic ${btoa(`${credentials.keyId}:${credentials.keySecret}`)}`, Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw Object.assign(new Error("Could not connect to Razorpay. Please try again."), { status: 502, code: "RAZORPAY_UNAVAILABLE" });
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error("Razorpay could not process this request. Please try again."), {
      status: 502, code: "RAZORPAY_REJECTED", gatewayStatus: response.status,
      gatewayDescription: result?.error?.description || result?.error?.reason || "",
    });
  }
  return result;
}

async function verifyWebhook(request, raw, env) {
  const secret = env.RAZORPAY_WEBHOOK_SECRET?.trim();
  const received = request.headers.get("x-razorpay-signature");
  return Boolean(secret && received && equalHex(await hmac(secret, raw), received));
}

async function capturedPayment(env, order, paymentId) {
  const payment = await razorpayRequest(env, `/payments/${encodeURIComponent(paymentId)}`);
  if (payment.order_id !== order.order_id || payment.amount !== order.amount || payment.currency !== order.currency) return { ok: false, state: "payment_details_mismatch" };
  if (payment.status !== "captured" || payment.captured !== true) return { ok: false, state: payment.status === "failed" ? "payment_failed" : "payment_not_captured" };
  const remoteOrder = await razorpayRequest(env, `/orders/${encodeURIComponent(order.order_id)}`);
  if (remoteOrder.id !== order.order_id || remoteOrder.amount !== order.amount || remoteOrder.currency !== order.currency
      || remoteOrder.status !== "paid" || remoteOrder.amount_paid < order.amount) return { ok: false, state: "order_not_paid" };
  return { ok: true };
}

async function activateVerified(env, store, orderId, paymentId) {
  const order = await store.getPaymentOrder(orderId);
  if (!order) return false;
  const result = await capturedPayment(env, order, paymentId);
  if (!result.ok) {
    if (result.state === "payment_failed") await store.markOrderFailed(orderId, paymentId, "FAILED");
    else await store.recordPaymentVerificationAttempt(orderId, paymentId, result.state);
    return false;
  }
  return store.activatePaidOrder(orderId, paymentId);
}

function checkout(orderId, amount, currency, keyId) { return { orderId, amount, currency, keyId }; }

export async function handleWorkerPayment(request, env, store, user, route) {
  if (route === "/api/payments/webhook" && request.method === "POST") {
    try {
      const raw = new Uint8Array(await request.arrayBuffer());
      if (raw.length > 100_000) return json(413, { error: "Request body is too large." });
      if (!await verifyWebhook(request, raw, env)) return json(401, { error: "Invalid Razorpay webhook signature." });
      let event;
      try { event = JSON.parse(new TextDecoder().decode(raw)); } catch { return json(400, { error: "Invalid webhook JSON." }); }
      if (event?.event === "payment.captured") {
        const payment = event?.payload?.payment?.entity;
        if (payment?.id && payment?.order_id) await activateVerified(env, store, payment.order_id, payment.id);
      } else if (event?.event === "order.paid") {
        const orderId = event?.payload?.order?.entity?.id;
        const localOrder = orderId ? await store.getPaymentOrder(orderId) : null;
        if (localOrder) {
          const payments = await razorpayRequest(env, `/orders/${encodeURIComponent(orderId)}/payments`);
          const captured = payments?.items?.find((payment) => payment.status === "captured" && payment.captured === true);
          if (captured?.id) await activateVerified(env, store, orderId, captured.id);
        }
      } else if (event?.event === "payment.failed") {
        const payment = event?.payload?.payment?.entity;
        const order = payment?.order_id ? await store.getPaymentOrder(payment.order_id) : null;
        if (order && payment?.id) {
          const verified = await razorpayRequest(env, `/payments/${encodeURIComponent(payment.id)}`);
          if (verified.order_id === order.order_id && verified.amount === order.amount && verified.currency === order.currency && verified.status === "failed") {
            await store.markOrderFailed(order.order_id, verified.id, "FAILED");
          }
        }
      }
      return json(200, { received: true });
    } catch (error) { return json(error.status || 500, { error: error.message || "Webhook processing failed." }); }
  }

  if (route === "/api/payments/create-order" && request.method === "POST") {
    if (!user) return json(401, { error: "Please sign in with Google before choosing a paid plan.", code: "AUTH_REQUIRED" });
    let body;
    try { body = await readJson(request); } catch (error) { return json(error.status || 400, { error: error.message }); }
    try {
      const plan = typeof body.plan === "string" ? body.plan.toLowerCase() : "";
      const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "";
      if (!Object.hasOwn(PLAN_CONFIG, plan) || plan === "free") return json(400, { error: "Choose a valid paid plan." });
      if (!Object.hasOwn(PLAN_CONFIG[plan].prices, currency) || !["INR", "USD"].includes(currency)) return json(400, { error: "Choose INR or USD." });
      const credentials = config(env);
      const current = await store.getBillingStatus(user.id);
      if (current.plan !== "free" && current.status === "active") return json(409, { error: "You already have an active paid plan. Purchase another plan after this billing period ends." });
      const pending = await store.getPendingPaymentOrder(user.id);
      if (pending) {
        if (pending.payment_status === "CREATING") return json(409, { error: "Your Razorpay order is still being prepared. Try again shortly." });
        const remoteOrder = await razorpayRequest(env, `/orders/${encodeURIComponent(pending.order_id)}`);
        if (remoteOrder.amount !== pending.amount || remoteOrder.currency !== pending.currency) {
          await store.recordPaymentVerificationAttempt(pending.order_id, null, "order_details_mismatch");
          return json(409, { error: "The existing payment order could not be verified. Contact support before retrying." });
        }
        if (remoteOrder.status === "paid") {
          const payments = await razorpayRequest(env, `/orders/${encodeURIComponent(pending.order_id)}/payments`);
          const captured = payments?.items?.find((payment) => payment.status === "captured" && payment.captured === true);
          if (captured?.id) await activateVerified(env, store, pending.order_id, captured.id);
          return json(409, { error: "That payment has already completed. Refresh your plan status." });
        }
        if (pending.plan !== plan || pending.currency !== currency) return json(409, { error: "You have a payment in progress for another plan. Complete or dismiss it before choosing a different plan." });
        return json(200, checkout(pending.order_id, pending.amount, pending.currency, credentials.keyId));
      }
      const amount = PLAN_CONFIG[plan].prices[currency] * 100;
      const localId = `creating_${crypto.randomUUID().replaceAll("-", "")}`;
      if (!await store.createPaymentOrderRecord({ orderId: localId, userId: user.id, plan, currency, amount })) {
        return json(409, { error: "A payment is already in progress. Complete or retry that checkout first." });
      }
      let remoteOrder;
      try {
        remoteOrder = await razorpayRequest(env, "/orders", { method: "POST", body: JSON.stringify({ amount, currency,
          receipt: `adspark_${crypto.randomUUID().replaceAll("-", "")}`, notes: { adspark_user_id: String(user.id), plan, currency } }) });
      } catch (error) {
        if (error.code === "RAZORPAY_REJECTED") {
          await store.markOrderFailed(localId, null, "CREATE_FAILED");
          if (currency === "USD" && error.gatewayStatus >= 400 && /international|currency|enabled|support|available/i.test(error.gatewayDescription || "")) {
            return json(400, { error: "USD payments are not currently enabled for this Razorpay account.", code: "USD_NOT_ENABLED" });
          }
        }
        throw error;
      }
      if (!remoteOrder.id || remoteOrder.amount !== amount || remoteOrder.currency !== currency) {
        await store.markOrderFailed(localId, null, "CREATE_FAILED");
        return json(502, { error: "Razorpay returned an invalid order response." });
      }
      await store.attachRazorpayOrder(localId, remoteOrder.id);
      return json(200, checkout(remoteOrder.id, amount, currency, credentials.keyId));
    } catch (error) { return json(error.status || 400, { error: error.message || "Could not create a Razorpay order." }); }
  }

  if (route === "/api/payments/verify" && request.method === "POST") {
    if (!user) return json(401, { error: "Please sign in again." });
    let body;
    try { body = await readJson(request); } catch (error) { return json(error.status || 400, { error: error.message }); }
    try {
      const orderId = typeof body.orderId === "string" ? body.orderId : "";
      const order = await store.getPendingOrderForUser(orderId, user.id);
      if (!order) return json(404, { error: "Payment order not found." });
      if (order.payment_status === "SUCCESS") return json(200, { status: "success", billing: await store.getBillingStatus(user.id) });
      const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
      const callbackOrderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
      const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
      const secret = env.RAZORPAY_KEY_SECRET?.trim();
      if (!secret || !paymentId || callbackOrderId !== order.order_id || !equalHex(await hmac(secret, `${order.order_id}|${paymentId}`), signature)) {
        await store.recordPaymentVerificationAttempt(order.order_id, paymentId, "verification_failed");
        return json(401, { error: "Razorpay payment signature could not be verified. Your plan has not changed." });
      }
      const activated = await activateVerified(env, store, order.order_id, paymentId);
      if (!activated) {
        const latest = await store.getPaymentOrder(order.order_id);
        if (latest?.payment_status === "FAILED") return json(402, { error: "Payment was not completed. Your plan has not changed.", status: "failed" });
        return json(409, { error: "Razorpay has not confirmed a captured payment yet. Your plan has not changed.", status: "pending" });
      }
      return json(200, { status: "success", billing: await store.getBillingStatus(user.id) });
    } catch (error) { return json(error.status || 400, { error: error.message || "Could not verify a Razorpay payment." }); }
  }

  if (route === "/api/payments/failure" && request.method === "POST") {
    if (!user) return json(401, { error: "Please sign in again." });
    let body;
    try { body = await readJson(request); } catch (error) { return json(error.status || 400, { error: error.message }); }
    try {
      const orderId = typeof body.orderId === "string" ? body.orderId : "";
      const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
      const order = await store.getPendingOrderForUser(orderId, user.id);
      if (!order || !paymentId) return json(404, { error: "Payment attempt not found." });
      const payment = await razorpayRequest(env, `/payments/${encodeURIComponent(paymentId)}`);
      if (payment.order_id !== order.order_id || payment.amount !== order.amount || payment.currency !== order.currency) {
        await store.recordPaymentVerificationAttempt(orderId, paymentId, "failure_details_mismatch");
        return json(400, { error: "Payment attempt did not match this order." });
      }
      if (payment.status === "failed") await store.markOrderFailed(orderId, paymentId, "FAILED");
      else if (payment.status === "captured" && payment.captured === true) {
        const activated = await activateVerified(env, store, orderId, paymentId);
        return json(200, { status: activated ? "success" : "pending", billing: await store.getBillingStatus(user.id) });
      }
      return json(200, { status: "failed", error: "Payment was not completed. Your plan has not changed." });
    } catch (error) { return json(error.status || 502, { error: error.message || "Could not verify payment failure." }); }
  }
  return null;
}

export { hmac };
