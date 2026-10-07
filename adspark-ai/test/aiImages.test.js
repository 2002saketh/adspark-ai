import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createCloudflareImageProvider, DEFAULT_CLOUDFLARE_IMAGE_MODEL } from "../server/aiImageProvider.js";
import { buildImagePrompt, generateCampaignImages } from "../server/aiImageGeneration.js";

const priorEnv = { ...process.env };
const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

function configureImageEnv() {
  process.env.CLOUDFLARE_ACCOUNT_ID = "image-test-account";
  process.env.CLOUDFLARE_API_TOKEN = "image-test-secret";
  process.env.CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-test-model";
}

function testCampaign() {
  return {
    concepts: ["luxury", "bold", "minimal"].map((variationId) => ({
      variationId,
      visualPrompt: `A distinct ${variationId} cafe product photograph of cold coffee, no lettering.`,
      designDirection: `${variationId} art direction with crop-safe room for copy.`,
    })),
  };
}

after(() => {
  for (const key of Object.keys(process.env)) if (!(key in priorEnv)) delete process.env[key];
  Object.assign(process.env, priorEnv);
});

test("Cloudflare image provider uses the configured REST model and returns a browser data URL", async () => {
  configureImageEnv();
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ success: true, result: { image: jpegBase64 } }), { status: 200 });
  };
  try {
    const provider = createCloudflareImageProvider();
    const result = await provider.generate("A product photo with no text.");
    assert.equal(request.url, "https://api.cloudflare.com/client/v4/accounts/image-test-account/ai/run/@cf/black-forest-labs/flux-test-model");
    assert.equal(request.options.headers.Authorization, "Bearer image-test-secret");
    assert.equal(request.options.headers["Content-Type"], "application/json");
    assert.equal(request.body.prompt, "A product photo with no text.");
    assert.equal(result.imageUrl, `data:image/jpeg;base64,${jpegBase64}`);
    assert.equal(result.imageModel, "@cf/black-forest-labs/flux-test-model");
    assert.ok(result.generationMs >= 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("image model defaults to the catalog-verified Cloudflare model and credentials are required", async () => {
  const provider = createCloudflareImageProvider({
    env: { CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_API_TOKEN: "token" },
    fetchImpl: async () => new Response(JSON.stringify({ result: { image: jpegBase64 } }), { status: 200 }),
  });
  assert.equal(provider.model, DEFAULT_CLOUDFLARE_IMAGE_MODEL);
  assert.throws(() => createCloudflareImageProvider({ env: {} }), { status: 503, code: "CLOUDFLARE_IMAGE_NOT_CONFIGURED" });
});

test("Cloudflare image errors, timeout, malformed images, and prompt limits fail safely", async () => {
  configureImageEnv();
  const provider = createCloudflareImageProvider({ fetchImpl: async () => new Response("secret provider detail", { status: 429 }) });
  await assert.rejects(provider.generate("photo"), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.code, "AI_IMAGE_RATE_LIMITED");
    assert.equal(error.message.includes("image-test-secret"), false);
    assert.equal(error.message.includes("secret provider detail"), false);
    return true;
  });
  const timeoutProvider = createCloudflareImageProvider({ fetchImpl: async () => { const error = new Error("timed out"); error.name = "TimeoutError"; throw error; } });
  await assert.rejects(timeoutProvider.generate("photo"), { status: 504, code: "AI_IMAGE_TIMEOUT" });
  const malformedProvider = createCloudflareImageProvider({ fetchImpl: async () => new Response(JSON.stringify({ result: { image: "bm90LWltYWdl" } }), { status: 200 }) });
  await assert.rejects(malformedProvider.generate("photo"), { status: 502, code: "AI_IMAGE_INVALID_RESPONSE" });
  await assert.rejects(provider.generate(""), { status: 400, code: "AI_IMAGE_INVALID_PROMPT" });
  await assert.rejects(provider.generate("x".repeat(2049)), { status: 400, code: "AI_IMAGE_INVALID_PROMPT" });
});

test("image-only prompts are distinct per concept and prohibit business text in the generated image", () => {
  const campaign = testCampaign();
  const prompts = campaign.concepts.map(buildImagePrompt);
  assert.equal(new Set(prompts).size, 3);
  assert.ok(prompts.every((prompt) => prompt.length <= 2048));
  assert.ok(prompts.every((prompt) => /No text, letters, words, numbers, logos/.test(prompt)));
});

test("campaign image failures fall back without breaking concepts and uploaded photos skip Cloudflare", async () => {
  configureImageEnv();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ result: { image: jpegBase64 } }), { status: 200 });
  };
  try {
    const generated = await generateCampaignImages(testCampaign(), false);
    assert.equal(calls, 3);
    assert.ok(generated.concepts.every((concept) => concept.visualSource === "CUSTOM_AI_VISUAL" && concept.aiImageUrl.startsWith("data:image/jpeg;base64,")));
    assert.equal(generated.visualSource, "CUSTOM_AI_VISUAL");

    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("unavailable", { status: 429 }); };
    const fallback = await generateCampaignImages(testCampaign(), false);
    assert.equal(calls, 1);
    assert.ok(fallback.concepts.every((concept) => concept.visualSource === "TEMPLATE_FALLBACK" && concept.aiImageUrl === null));
    assert.equal(fallback.visualSource, "TEMPLATE_FALLBACK");

    calls = 0;
    const uploaded = await generateCampaignImages(testCampaign(), true);
    assert.equal(calls, 0);
    assert.ok(uploaded.concepts.every((concept) => concept.visualSource === "UPLOADED_IMAGE"));
  } finally { globalThis.fetch = originalFetch; }
});
