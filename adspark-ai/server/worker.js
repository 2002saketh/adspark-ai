import { generateAdConcepts, generateVisualImage, regenerateSingleConcept } from "./adGenerator.js";
import { generateCampaignImages, generateConceptImageOrFallback } from "./aiImageGeneration.js";
import { PLAN_CONFIG } from "./plans.js";
import { cookieName, handleWorkerAuth, isValidOrigin, readCookie } from "./workerAuth.js";
import { handleWorkerPayment } from "./workerPayments.js";
import { createWorkerStore } from "./workerStore.js";
import { createWorkersAIImageProvider, createWorkersAITextProvider } from "./workerAi.js";

function json(status, payload, headers = {}) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function readJson(request, limit = 20_000) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > limit) throw Object.assign(new Error("Request body is too large."), { status: 413 });
  if (!bytes.length) return {};
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error("Invalid JSON body."), { status: 400 }); }
}

export async function handleWorkerApi(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json(200, { status: "ok", service: "adspark" });
  }
  if (!url.pathname.startsWith("/api/")) return null;

  const store = createWorkerStore(env);
  const authResponse = await handleWorkerAuth(request, env, store);
  if (authResponse) return authResponse;

  if (request.method === "GET" && url.pathname === "/api/billing/plans") {
    return json(200, { plans: PLAN_CONFIG });
  }
  if (request.method === "GET" && url.pathname === "/api/billing/status") {
    const user = await store.getAuthenticatedUser(readCookie(request, cookieName(request)));
    if (!user) return json(401, { error: "Authentication required." });
    return json(200, await store.getBillingStatus(user.id));
  }

  if (url.pathname.startsWith("/api/payments/")) {
    const isWebhook = url.pathname === "/api/payments/webhook";
    const supported = ["/api/payments/webhook", "/api/payments/create-order", "/api/payments/verify", "/api/payments/failure"]
      .includes(url.pathname) && request.method === "POST";
    if (!supported) return json(404, { error: "Payment endpoint not found." });
    if (!isWebhook && !isValidOrigin(request, env)) return json(403, { error: "Request origin is not allowed.", code: "INVALID_ORIGIN" });
    const user = isWebhook ? null : await store.getAuthenticatedUser(readCookie(request, cookieName(request)));
    return handleWorkerPayment(request, env, store, user, url.pathname);
  }

  const protectedRoutes = new Set(["/api/generate-ad", "/api/generate-visual", "/api/regenerate-concept"]);
  if (!protectedRoutes.has(url.pathname) || request.method !== "POST") {
    return json(404, { error: `Not found: ${url.pathname}` });
  }
  if (!isValidOrigin(request, env)) return json(403, { error: "Request origin is not allowed.", code: "INVALID_ORIGIN" });
  const user = await store.getAuthenticatedUser(readCookie(request, cookieName(request)));
  if (!user) return json(401, {
    error: "Please sign in with Google to generate your campaign.",
    code: "AUTH_REQUIRED",
  });

  let input;
  try { input = await readJson(request); }
  catch (error) { return json(error.status || 400, { error: error.message, code: "INVALID_REQUEST" }); }

  try {
    const textProvider = createWorkersAITextProvider(env);
    const imageProvider = createWorkersAIImageProvider(env);
    if (url.pathname === "/api/generate-ad") {
      if (!input.businessName || !input.productService || !input.priceOffer) {
        return json(400, { error: "Missing required fields: businessName, productService, priceOffer" });
      }
      if (!await store.reserveAdUsage(user.id)) {
        return json(429, { error: "You have used all of your AI ads for this billing period. Upgrade your plan to continue.", code: "USAGE_LIMIT_REACHED" });
      }
      try {
        const data = await generateAdConcepts(input, { provider: textProvider });
        await generateCampaignImages(data, input.hasUploadedImage === true, { provider: imageProvider, imageModel: imageProvider.model });
        await store.settleAdUsage(user.id, true);
        return json(200, data);
      } catch (error) {
        await store.settleAdUsage(user.id, false);
        throw error;
      }
    }
    if (url.pathname === "/api/generate-visual") {
      if (!input.visualPrompt) return json(400, { error: "Missing visualPrompt parameter." });
      if (!await store.reserveAdUsage(user.id)) {
        return json(429, { error: "You have used all of your AI ads for this billing period. Upgrade your plan to continue.", code: "USAGE_LIMIT_REACHED" });
      }
      try {
        const data = await generateVisualImage(input.visualPrompt, input.variationId, input.designDirection, { provider: imageProvider });
        await store.settleAdUsage(user.id, true);
        return json(200, { ...data, visualSource: "CUSTOM_AI_VISUAL" });
      } catch (error) {
        await store.settleAdUsage(user.id, false);
        throw error;
      }
    }
    if (!input.businessName || !input.variationId) return json(400, { error: "Missing required fields for regeneration." });
    if (!await store.reserveAdUsage(user.id)) {
      return json(429, { error: "You have used all of your AI ads for this billing period. Upgrade your plan to continue.", code: "USAGE_LIMIT_REACHED" });
    }
    try {
      const data = await regenerateSingleConcept(input, input.variationId, { provider: textProvider });
      Object.assign(data, await generateConceptImageOrFallback(data, input.hasUploadedImage === true,
        { provider: imageProvider, imageModel: imageProvider.model }));
      await store.settleAdUsage(user.id, true);
      return json(200, data);
    } catch (error) {
      await store.settleAdUsage(user.id, false);
      throw error;
    }
  } catch (error) {
    return json(error.status || 500, { error: error.message || "An error occurred during AI processing.", code: error.code || "AI_ERROR" });
  }
}

export default {
  async fetch(request, env, ctx) {
    const response = await handleWorkerApi(request, env, ctx);
    if (response) return response;
    return env.ASSETS.fetch(request);
  },
};
