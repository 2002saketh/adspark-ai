import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import {
  PLAN_CONFIG, createPaymentOrderRecord, attachRazorpayOrder, getBillingStatus,
  getPaymentOrder, getPendingOrderForUser, activatePaidOrder, markOrderFailed,
  getPendingPaymentOrder, recordPaymentVerificationAttempt,
} from "./auth.js";

const API_BASE = "https://api.razorpay.com/v1";

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function razorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  const environment = process.env.RAZORPAY_ENVIRONMENT?.trim().toLowerCase() || "test";
  if (!keyId || !keySecret) throw Object.assign(new Error("Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env."), { status: 503 });
  if (!["test", "live"].includes(environment)) throw Object.assign(new Error("RAZORPAY_ENVIRONMENT must be test or live."), { status: 503 });
  if (environment === "test" && !keyId.startsWith("rzp_test_")) throw Object.assign(new Error("Test mode requires a Razorpay test key."), { status: 503 });
  if (environment === "live" && !keyId.startsWith("rzp_live_")) throw Object.assign(new Error("Live mode requires a Razorpay live key."), { status: 503 });
  return { keyId, keySecret, environment };
}

async function razorpayRequest(path, options = {}) {
  const config = razorpayConfig();
  const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64");
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw Object.assign(new Error("Could not connect to Razorpay. Please try again."), { status: 502, code: "RAZORPAY_UNAVAILABLE" });
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const description = result?.error?.description || result?.error?.reason || "";
    console.error("Razorpay API error", response.status, result?.error?.code || "unknown");
    throw Object.assign(new Error("Razorpay could not process this request. Please try again."), {
      status: 502, code: "RAZORPAY_REJECTED", gatewayStatus: response.status, gatewayDescription: description,
    });
  }
  return result;
}

async function readRawBody(req, limit = 100_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function constantTimeHexEqual(expected, received) {
  if (typeof received !== "string" || !/^[a-f\d]{64}$/i.test(received)) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function verifyCheckoutSignature(orderId, paymentId, signature) {
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!secret || typeof paymentId !== "string" || !paymentId || typeof signature !== "string") return false;
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return constantTimeHexEqual(expected, signature);
}

function verifyWebhookSignature(req, rawBody) {
  const signature = req.headers["x-razorpay-signature"];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret || typeof signature !== "string" || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return constantTimeHexEqual(expected, signature);
}

async function getCapturedPaymentForOrder(order, paymentId) {
  const payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
  if (payment.order_id !== order.order_id || payment.amount !== order.amount || payment.currency !== order.currency) {
    return { ok: false, state: "payment_details_mismatch" };
  }
  if (payment.status !== "captured" || payment.captured !== true) {
    return { ok: false, state: payment.status === "failed" ? "payment_failed" : "payment_not_captured", payment };
  }
  const remoteOrder = await razorpayRequest(`/orders/${encodeURIComponent(order.order_id)}`);
  if (remoteOrder.id !== order.order_id || remoteOrder.amount !== order.amount || remoteOrder.currency !== order.currency
      || remoteOrder.status !== "paid" || remoteOrder.amount_paid < order.amount) {
    return { ok: false, state: "order_not_paid", payment };
  }
  return { ok: true, payment };
}

async function activateFromVerifiedPayment(orderId, paymentId) {
  const order = await getPaymentOrder(orderId);
  if (!order) return false;
  const verified = await getCapturedPaymentForOrder(order, paymentId);
  if (!verified.ok) {
    if (verified.state === "payment_failed") await markOrderFailed(orderId, paymentId, "FAILED");
    else await recordPaymentVerificationAttempt(orderId, paymentId, verified.state);
    return false;
  }
  return activatePaidOrder(orderId, paymentId);
}

function checkoutData(orderId, amount, currency, keyId) {
  return { orderId, amount, currency, keyId };
}

export async function handlePaymentRoutes(req, res, user, route) {
  if (route === "/api/payments/webhook" && req.method === "POST") {
    try {
      const rawBody = await readRawBody(req);
      if (!verifyWebhookSignature(req, rawBody)) return send(res, 401, { error: "Invalid Razorpay webhook signature." });
      let event;
      try { event = JSON.parse(rawBody.toString("utf8")); } catch { return send(res, 400, { error: "Invalid webhook JSON." }); }
      const eventName = event?.event;
      if (eventName === "payment.captured") {
        const payment = event?.payload?.payment?.entity;
        if (payment?.id && payment?.order_id) await activateFromVerifiedPayment(payment.order_id, payment.id);
      } else if (eventName === "order.paid") {
        const orderId = event?.payload?.order?.entity?.id;
        const localOrder = orderId ? await getPaymentOrder(orderId) : null;
        if (localOrder) {
          const payments = await razorpayRequest(`/orders/${encodeURIComponent(orderId)}/payments`);
          const captured = payments?.items?.find((payment) => payment.status === "captured" && payment.captured === true);
          if (captured?.id) await activateFromVerifiedPayment(orderId, captured.id);
        }
      } else if (eventName === "payment.failed") {
        const payment = event?.payload?.payment?.entity;
        const order = payment?.order_id ? await getPaymentOrder(payment.order_id) : null;
        if (order && payment?.id) {
          const verified = await razorpayRequest(`/payments/${encodeURIComponent(payment.id)}`);
          if (verified.order_id === order.order_id && verified.amount === order.amount
              && verified.currency === order.currency && verified.status === "failed") {
            await markOrderFailed(order.order_id, verified.id, "FAILED");
          }
        }
      }
      return send(res, 200, { received: true });
    } catch (error) {
      return send(res, error.status || 500, { error: error.message || "Webhook processing failed." });
    }
  }

  if (route === "/api/payments/create-order" && req.method === "POST") {
    if (!user) return send(res, 401, { error: "Please sign in with Google before choosing a paid plan.", code: "AUTH_REQUIRED" });
    try {
      const body = await readRawBody(req, 20_000).then((raw) => JSON.parse(raw.toString("utf8") || "{}"));
      const plan = typeof body.plan === "string" ? body.plan.toLowerCase() : "";
      const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "";
      if (!Object.hasOwn(PLAN_CONFIG, plan) || plan === "free") return send(res, 400, { error: "Choose a valid paid plan." });
      if (!Object.hasOwn(PLAN_CONFIG[plan].prices, currency) || !["INR", "USD"].includes(currency)) return send(res, 400, { error: "Choose INR or USD." });
      const config = razorpayConfig();
      const current = await getBillingStatus(user.id);
      if (current.plan !== "free" && current.status === "active") return send(res, 409, { error: "You already have an active paid plan. Purchase another plan after this billing period ends." });

      const pendingOrder = await getPendingPaymentOrder(user.id);
      if (pendingOrder) {
        if (pendingOrder.payment_status === "CREATING") return send(res, 409, { error: "Your Razorpay order is still being prepared. Try again shortly." });
        const remoteOrder = await razorpayRequest(`/orders/${encodeURIComponent(pendingOrder.order_id)}`);
        if (remoteOrder.amount !== pendingOrder.amount || remoteOrder.currency !== pendingOrder.currency) {
          await recordPaymentVerificationAttempt(pendingOrder.order_id, null, "order_details_mismatch");
          return send(res, 409, { error: "The existing payment order could not be verified. Contact support before retrying." });
        }
        if (remoteOrder.status === "paid") {
          const payments = await razorpayRequest(`/orders/${encodeURIComponent(pendingOrder.order_id)}/payments`);
          const captured = payments?.items?.find((payment) => payment.status === "captured" && payment.captured === true);
          if (captured?.id) await activateFromVerifiedPayment(pendingOrder.order_id, captured.id);
          return send(res, 409, { error: "That payment has already completed. Refresh your plan status." });
        }
        if (pendingOrder.plan !== plan || pendingOrder.currency !== currency) {
          return send(res, 409, { error: "You have a payment in progress for another plan. Complete or dismiss it before choosing a different plan." });
        }
        return send(res, 200, checkoutData(pendingOrder.order_id, pendingOrder.amount, pendingOrder.currency, config.keyId));
      }

      const amount = PLAN_CONFIG[plan].prices[currency] * 100;
      const localOrderId = `creating_${randomUUID().replaceAll("-", "")}`;
      if (!await createPaymentOrderRecord({ orderId: localOrderId, userId: user.id, plan, currency, amount })) {
        return send(res, 409, { error: "A payment is already in progress. Complete or retry that checkout first." });
      }
      let remoteOrder;
      try {
        remoteOrder = await razorpayRequest("/orders", {
          method: "POST",
          body: JSON.stringify({
            amount,
            currency,
            receipt: `adspark_${randomUUID().replaceAll("-", "")}`,
            notes: { adspark_user_id: String(user.id), plan, currency },
          }),
        });
      } catch (error) {
        if (error.code === "RAZORPAY_REJECTED") {
          await markOrderFailed(localOrderId, null, "CREATE_FAILED");
          if (currency === "USD" && error.gatewayStatus >= 400
              && /international|currency|enabled|support|available/i.test(error.gatewayDescription || "")) {
            return send(res, 400, { error: "USD payments are not currently enabled for this Razorpay account.", code: "USD_NOT_ENABLED" });
          }
        }
        throw error;
      }
      if (!remoteOrder.id || remoteOrder.amount !== amount || remoteOrder.currency !== currency) {
        await markOrderFailed(localOrderId, null, "CREATE_FAILED");
        return send(res, 502, { error: "Razorpay returned an invalid order response." });
      }
      await attachRazorpayOrder(localOrderId, remoteOrder.id);
      return send(res, 200, checkoutData(remoteOrder.id, amount, currency, config.keyId));
    } catch (error) {
      return send(res, error.status || 400, { error: error.message || "Could not create a Razorpay order." });
    }
  }

  if (route === "/api/payments/verify" && req.method === "POST") {
    if (!user) return send(res, 401, { error: "Please sign in again." });
    try {
      const body = await readRawBody(req, 20_000).then((raw) => JSON.parse(raw.toString("utf8") || "{}"));
      const orderId = typeof body.orderId === "string" ? body.orderId : "";
      const order = await getPendingOrderForUser(orderId, user.id);
      if (!order) return send(res, 404, { error: "Payment order not found." });
      if (order.payment_status === "SUCCESS") return send(res, 200, { status: "success", billing: await getBillingStatus(user.id) });
      const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
      const callbackOrderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
      const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
      if (!paymentId || callbackOrderId !== order.order_id
          || !verifyCheckoutSignature(order.order_id, paymentId, signature)) {
        await recordPaymentVerificationAttempt(order.order_id, paymentId, "verification_failed");
        return send(res, 401, { error: "Razorpay payment signature could not be verified. Your plan has not changed." });
      }
      const activated = await activateFromVerifiedPayment(order.order_id, paymentId);
      if (!activated) {
        const latest = await getPaymentOrder(order.order_id);
        if (latest?.payment_status === "FAILED") return send(res, 402, { error: "Payment was not completed. Your plan has not changed.", status: "failed" });
        return send(res, 409, { error: "Razorpay has not confirmed a captured payment yet. Your plan has not changed.", status: "pending" });
      }
      return send(res, 200, { status: "success", billing: await getBillingStatus(user.id) });
    } catch (error) {
      return send(res, error.status || 400, { error: error.message || "Could not verify Razorpay payment." });
    }
  }

  if (route === "/api/payments/failure" && req.method === "POST") {
    if (!user) return send(res, 401, { error: "Please sign in again." });
    try {
      const body = await readRawBody(req, 20_000).then((raw) => JSON.parse(raw.toString("utf8") || "{}"));
      const orderId = typeof body.orderId === "string" ? body.orderId : "";
      const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
      const order = await getPendingOrderForUser(orderId, user.id);
      if (!order || !paymentId) return send(res, 404, { error: "Payment attempt not found." });
      const payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
      if (payment.order_id !== order.order_id || payment.amount !== order.amount || payment.currency !== order.currency) {
        await recordPaymentVerificationAttempt(orderId, paymentId, "failure_details_mismatch");
        return send(res, 400, { error: "Payment attempt did not match this order." });
      }
      if (payment.status === "failed") await markOrderFailed(orderId, paymentId, "FAILED");
      else if (payment.status === "captured" && payment.captured === true) {
        const activated = await activateFromVerifiedPayment(orderId, paymentId);
        return send(res, 200, { status: activated ? "success" : "pending", billing: await getBillingStatus(user.id) });
      }
      return send(res, 200, { status: "failed", error: "Payment was not completed. Your plan has not changed." });
    } catch (error) {
      return send(res, error.status || 502, { error: error.message || "Could not verify payment failure." });
    }
  }

  return false;
}
