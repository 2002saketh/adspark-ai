import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAIProvider, selectedAIProvider } from "../server/aiProviders.js";
import { generateAdConcepts } from "../server/aiBackend.js";

const priorEnv = { ...process.env };
const exactOffer = "Opening offer: ₹499";
const input = {
  businessName: "Mango House",
  businessType: "Cafe",
  productService: "Fresh mango smoothies",
  priceOffer: exactOffer,
  targetCustomer: "Nearby office workers",
  location: "Pune",
  tone: "Bright",
  campaignBrief: "New seasonal product launch for Instagram.",
  hasUploadedImage: true,
};
const campaign = {
  analysis: {
    businessCore: "Cafe serving mango smoothies",
    targetAudience: "Nearby office workers",
    strongestBenefit: "Fresh mango smoothies",
    sellingAngle: "A refreshing local option",
  },
  concepts: ["luxury", "bold", "minimal"].map((variationId, index) => ({
    variationId,
    conceptName: `${variationId} concept`,
    headline: "Fresh Mango, Made to Brighten Your Day",
    subheadline: "A cool smoothie break near your office",
    benefit: "Fresh mango smoothies",
    offer: exactOffer,
    cta: "Visit Mango House today",
    caption: "A refreshing break is close by. Visit Mango House today. #mango #smoothie #cafe #pune",
    whatsappMessage: "Take a refreshing break with a fresh mango smoothie at Mango House.",
    shortAdCopy: "Fresh mango smoothies at Mango House in Pune.",
    visualPrompt: "A fresh mango smoothie in a cafe, with natural light and no lettering.",
    designDirection: `${variationId} design with clear type and mango colors.`,
    layoutType: ["DARK_PREMIUM", "BOLD_PROMO", "SPLIT_LEFT_TEXT_RIGHT_IMAGE"][index],
    colorDirection: "WARM_FOOD",
    typographyDirection: "Editorial serif headline with readable supporting sans serif.",
    visualHierarchy: "Headline, product, offer, CTA, then business name.",
  })),
};

function configureCloudflare() {
  process.env.AI_PROVIDER = "cloudflare";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-cloudflare-secret";
  process.env.CLOUDFLARE_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
}

function completion(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

test.after(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in priorEnv)) delete process.env[key];
  }
  Object.assign(process.env, priorEnv);
});

test("provider defaults are Cloudflare in production and Ollama in development", () => {
  assert.equal(selectedAIProvider({ NODE_ENV: "production" }), "cloudflare");
  assert.equal(selectedAIProvider({ NODE_ENV: "development" }), "ollama");
  assert.throws(() => selectedAIProvider({ NODE_ENV: "production", AI_PROVIDER: "ollama" }), { code: "AI_PROVIDER_NOT_SUPPORTED" });
});

test("Cloudflare chat uses the server endpoint, bearer credentials, schema, and Ollama-compatible response", async () => {
  configureCloudflare();
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options, body: JSON.parse(options.body) };
    return completion(JSON.stringify(campaign));
  };
  try {
    const result = await generateAdConcepts(input);
    assert.equal(captured.url, "https://api.cloudflare.com/client/v4/accounts/test-account/ai/v1/chat/completions");
    assert.equal(captured.options.headers.Authorization, "Bearer test-cloudflare-secret");
    assert.equal(captured.options.headers["Content-Type"], "application/json");
    assert.equal(captured.body.model, "@cf/meta/llama-3.1-8b-instruct-fp8-fast");
    assert.deepEqual(captured.body.messages.map(({ role }) => role), ["system", "user"]);
    assert.match(captured.body.messages[0].content, /FACTUAL ACCURACY IS MANDATORY/);
    assert.match(captured.body.messages[1].content, /Return analysis plus exactly three concepts/);
    assert.match(captured.body.messages[0].content, /Business-specific direction/);
    assert.match(captured.body.messages[1].content, /Campaign objective, occasion, style or brand colors/);
    assert.match(captured.body.messages[1].content, /New seasonal product launch for Instagram/);
    assert.match(captured.body.messages[1].content, /User uploaded a photo for the poster: yes/);
    assert.ok(captured.body.response_format.json_schema.properties.concepts.items.properties.layoutType);
    assert.ok(captured.body.response_format.json_schema.properties.concepts.items.properties.colorDirection);
    assert.deepEqual(result.concepts.map(({ layoutType }) => layoutType), ["DARK_PREMIUM", "BOLD_PROMO", "SPLIT_LEFT_TEXT_RIGHT_IMAGE"]);
    assert.equal(result.concepts[0].colorDirection, "WARM_FOOD");
    assert.equal(captured.body.temperature, 0.3);
    assert.equal(captured.body.max_tokens, 4096);
    assert.deepEqual(captured.body.response_format.json_schema.required, ["analysis", "concepts"]);
    assert.equal(result.concepts.length, 3);
    assert.equal(result.concepts[0].headline, campaign.concepts[0].headline);
    assert.equal(result.concepts[0].offer, exactOffer);
    assert.equal(result.concepts[0].visualPrompt, campaign.concepts[0].visualPrompt);
  } finally { globalThis.fetch = originalFetch; }
});

test("legacy campaign responses retain required fields and receive distinct renderer-safe layout defaults", async () => {
  configureCloudflare();
  const originalFetch = globalThis.fetch;
  const legacyCampaign = structuredClone(campaign);
  for (const concept of legacyCampaign.concepts) {
    delete concept.layoutType;
    delete concept.colorDirection;
    delete concept.typographyDirection;
    delete concept.visualHierarchy;
  }
  globalThis.fetch = async () => completion(JSON.stringify(legacyCampaign));
  try {
    const result = await generateAdConcepts(input);
    assert.deepEqual(result.concepts.map(({ layoutType }) => layoutType), ["DARK_PREMIUM", "BOLD_PROMO", "MINIMAL_EDITORIAL"]);
    assert.ok(result.concepts.every(({ colorDirection }) => colorDirection === "NEUTRAL"));
  } finally { globalThis.fetch = originalFetch; }
});

test("fenced JSON is parsed while the complete existing campaign fields are preserved", async () => {
  configureCloudflare();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => completion(`\`\`\`json\n${JSON.stringify(campaign)}\n\`\`\``);
  try {
    const result = await generateAdConcepts(input);
    const concept = result.concepts[0];
    for (const field of ["headline", "subheadline", "benefit", "offer", "cta", "caption", "whatsappMessage", "shortAdCopy", "visualPrompt", "designDirection"]) {
      assert.equal(typeof concept[field], "string", `${field} should remain present`);
      assert.ok(concept[field].length > 0, `${field} should not be empty`);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("malformed JSON and schema-invalid responses fail safely", async () => {
  configureCloudflare();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => completion("not JSON");
    await assert.rejects(generateAdConcepts(input), { status: 502, code: "AI_INVALID_JSON" });
    const incomplete = structuredClone(campaign);
    delete incomplete.concepts[0].headline;
    globalThis.fetch = async () => completion(JSON.stringify(incomplete));
    await assert.rejects(generateAdConcepts(input), { status: 502, code: "AI_INVALID_RESPONSE" });
    const missingOffer = structuredClone(campaign);
    delete missingOffer.concepts[0].offer;
    globalThis.fetch = async () => completion(JSON.stringify(missingOffer));
    await assert.rejects(generateAdConcepts(input), { status: 502, code: "AI_INVALID_RESPONSE" });
  } finally { globalThis.fetch = originalFetch; }
});

test("Cloudflare HTTP errors and timeouts return safe application errors", async () => {
  configureCloudflare();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "test-cloudflare-secret leaked" }), { status: 429 });
    await assert.rejects(generateAdConcepts(input), (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.code, "AI_RATE_LIMITED");
      assert.equal(error.message.includes(process.env.CLOUDFLARE_API_TOKEN), false);
      assert.equal(error.message.includes("test-cloudflare-secret leaked"), false);
      return true;
    });
    globalThis.fetch = async () => { const error = new Error("timeout"); error.name = "TimeoutError"; throw error; };
    await assert.rejects(generateAdConcepts(input), { status: 504, code: "AI_TIMEOUT" });
    for (const [status, code] of [[401, "CLOUDFLARE_AUTH_FAILED"], [404, "CLOUDFLARE_MODEL_UNAVAILABLE"], [410, "CLOUDFLARE_MODEL_UNAVAILABLE"], [500, "AI_UNAVAILABLE"]]) {
      globalThis.fetch = async () => new Response("provider details should stay private", { status });
      await assert.rejects(generateAdConcepts(input), (error) => {
        assert.equal(error.code, code);
        assert.equal(error.message.includes("provider details"), false);
        return true;
      });
    }
    globalThis.fetch = async () => new Response("<html>invalid JSON</html>", { status: 200 });
    await assert.rejects(generateAdConcepts(input), { status: 502, code: "AI_INVALID_RESPONSE" });
  } finally { globalThis.fetch = originalFetch; }
});

test("missing Cloudflare credentials produce a clear configuration error without a request", async () => {
  process.env.AI_PROVIDER = "cloudflare";
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("fetch must not run"); };
  try {
    await assert.rejects(generateAdConcepts(input), (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, "CLOUDFLARE_NOT_CONFIGURED");
      assert.match(error.message, /CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN/);
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});

test("Cloudflare selection does not contact localhost Ollama", async () => {
  configureCloudflare();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.equal(String(url).includes("localhost:11434"), false);
    return completion(JSON.stringify(campaign));
  };
  try {
    await generateAdConcepts(input);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("local Ollama remains selectable and returns the same campaign", async () => {
  process.env.AI_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  process.env.OLLAMA_MODEL = "test-model";
  const originalFetch = globalThis.fetch;
  let chatCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "test-model" }] }));
    if (String(url).endsWith("/api/chat")) {
      chatCalls++;
      return new Response(JSON.stringify({ message: { content: JSON.stringify(campaign) } }));
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const result = await createAIProvider().chat({ messages: [], schema: { type: "object" } });
    assert.equal(typeof result.message.content, "string");
    assert.equal(chatCalls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("Cloudflare credentials do not occur in client code or frontend Vite config", () => {
  for (const path of ["../src", "../index.html", "../vite.config.ts"]) {
    const content = path.endsWith("/src")
      ? ["App.tsx", "services/aiService.ts", "types.ts"].map((file) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")).join("\n")
      : readFileSync(new URL(path, import.meta.url), "utf8");
    assert.equal(content.includes("CLOUDFLARE_API_TOKEN"), false, `${path} exposes the Cloudflare token name`);
    assert.equal(content.includes("test-cloudflare-secret"), false, `${path} exposes a credential`);
  }
});
