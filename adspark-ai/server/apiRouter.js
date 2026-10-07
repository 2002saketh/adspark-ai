import { generateAdConcepts, generateVisualImage, regenerateSingleConcept } from "./aiBackend.js";
import { getAuthenticatedUser, handleAuthRoutes, hasValidOrigin, PLAN_CONFIG, getBillingStatus, reserveAdUsage, settleAdUsage } from "./auth.js";
import { handlePaymentRoutes } from "./payments.js";
import { generateCampaignImages, generateConceptImageOrFallback } from "./aiImageGeneration.js";

function respond(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

export async function handleApiRoutes(req, res, next) {
  const url = req.url.split("?")[0];

  if (await handleAuthRoutes(req, res)) return;

  if (req.method === "GET" && url === "/api/billing/plans") {
    respond(res, 200, { plans: PLAN_CONFIG });
    return;
  }
  if (req.method === "GET" && url === "/api/billing/status") {
    const user = await getAuthenticatedUser(req);
    if (!user) return respond(res, 401, { error: "Authentication required." });
    respond(res, 200, await getBillingStatus(user.id));
    return;
  }
  if (url.startsWith("/api/payments/")) {
    const isWebhook = url === "/api/payments/webhook";
    const supported = ["/api/payments/webhook", "/api/payments/create-order", "/api/payments/verify", "/api/payments/failure"]
      .includes(url) && req.method === "POST";
    if (!supported) return respond(res, 404, { error: "Payment endpoint not found." });
    if (!isWebhook && req.method === "POST" && !hasValidOrigin(req)) {
      return respond(res, 403, { error: "Request origin is not allowed.", code: "INVALID_ORIGIN" });
    }
    const user = isWebhook ? null : await getAuthenticatedUser(req);
    const result = await handlePaymentRoutes(req, res, user, url);
    if (result !== false) return;
  }

  if (req.method !== "POST" || !url.startsWith("/api/")) {
    return next ? next() : null;
  }

  const protectedGenerationRoutes = new Set([
    "/api/generate-ad",
    "/api/generate-visual",
    "/api/regenerate-concept",
  ]);
  const authenticatedUser = protectedGenerationRoutes.has(url)
    ? await getAuthenticatedUser(req)
    : null;
  if (protectedGenerationRoutes.has(url) && !hasValidOrigin(req)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Request origin is not allowed.", code: "INVALID_ORIGIN" }));
    return;
  }
  if (protectedGenerationRoutes.has(url) && !authenticatedUser) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: "Please sign in with Google to generate your campaign.",
      code: "AUTH_REQUIRED",
    }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", async () => {
    try {
      let parsed = {};
      if (body) {
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
      }

      if (url === "/api/generate-ad") {
        if (!parsed.businessName || !parsed.productService || !parsed.priceOffer) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required fields: businessName, productService, priceOffer" }));
          return;
        }
        if (!await reserveAdUsage(authenticatedUser.id)) {
          respond(res, 429, { error: "You have used all of your AI ads for this billing period. Upgrade your plan to continue.", code: "USAGE_LIMIT_REACHED" });
          return;
        }
        try {
          const data = await generateAdConcepts(parsed);
          await generateCampaignImages(data, parsed.hasUploadedImage === true);
          await settleAdUsage(authenticatedUser.id, true);
          respond(res, 200, data);
        } catch (error) {
          await settleAdUsage(authenticatedUser.id, false);
          throw error;
        }
        return;
      }

      if (url === "/api/generate-visual") {
        if (!parsed.visualPrompt) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing visualPrompt parameter." }));
          return;
        }
        if (!await reserveAdUsage(authenticatedUser.id)) {
          respond(res, 429, { error: "You have used all of your AI ads for this billing period. Upgrade your plan to continue.", code: "USAGE_LIMIT_REACHED" });
          return;
        }
        try {
          const data = await generateVisualImage(parsed.visualPrompt, parsed.variationId, parsed.designDirection);
          await settleAdUsage(authenticatedUser.id, true);
          respond(res, 200, { ...data, visualSource: "CUSTOM_AI_VISUAL" });
        } catch (error) {
          await settleAdUsage(authenticatedUser.id, false);
          throw error;
        }
        return;
      }

      if (url === "/api/regenerate-concept") {
        if (!parsed.businessName || !parsed.variationId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required fields for regeneration." }));
          return;
        }
        if (!await reserveAdUsage(authenticatedUser.id)) {
          respond(res, 429, { error: "You have used all of your AI ads for this billing period. Upgrade your plan to continue.", code: "USAGE_LIMIT_REACHED" });
          return;
        }
        try {
          const data = await regenerateSingleConcept(parsed, parsed.variationId);
          Object.assign(data, await generateConceptImageOrFallback(data, parsed.hasUploadedImage === true));
          await settleAdUsage(authenticatedUser.id, true);
          respond(res, 200, data);
        } catch (error) {
          await settleAdUsage(authenticatedUser.id, false);
          throw error;
        }
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Not found: ${url}` }));
    } catch (err) {
      const statusCode = err.status || 500;
      const errorMessage = err.message || "An error occurred during AI processing.";
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: errorMessage,
          code: err.code || "AI_ERROR",
        }),
      );
    }
  });
}
