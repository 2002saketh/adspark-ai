import { createAIProvider } from "./aiProviders.js";
import { createCloudflareImageProvider } from "./aiImageProvider.js";
import { generateAdConcepts as generateCampaign, regenerateSingleConcept as regenerate, generateVisualImage as generateImage } from "./adGenerator.js";

export async function generateAdConcepts(input, options = {}) {
  return generateCampaign(input, { ...options, provider: options.provider || createAIProvider() });
}

export async function regenerateSingleConcept(input, variationId, options = {}) {
  return regenerate(input, variationId, { ...options, provider: options.provider || createAIProvider() });
}

export async function generateVisualImage(visualPrompt, variationId = "minimal", designDirection = "", options = {}) {
  return generateImage(visualPrompt, variationId, designDirection, {
    ...options,
    provider: options.provider || createCloudflareImageProvider(),
  });
}
