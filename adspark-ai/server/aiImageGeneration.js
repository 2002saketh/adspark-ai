import { createCloudflareImageProvider, DEFAULT_CLOUDFLARE_IMAGE_MODEL } from "./aiImageProvider.js";

const IMAGE_ONLY_RULE = "Commercial advertising photography only. No text, letters, words, numbers, logos, labels, watermarks, signs, storefronts, menus, packaging, or promotional lettering. Keep every visible surface blank; avoid anything that could contain writing.";
const VARIATION_DIRECTIONS = {
  luxury: "Refined premium editorial art direction, soft controlled lighting, elegant negative space.",
  bold: "High-impact commercial photography, energetic contrast, decisive focal point.",
  minimal: "Clean modern editorial photography, restrained styling, balanced whitespace.",
};

export function buildImagePrompt(concept) {
  const details = [
    concept.visualPrompt,
    concept.designDirection,
    VARIATION_DIRECTIONS[concept.variationId],
    IMAGE_ONLY_RULE,
  ].filter((value) => typeof value === "string" && value.trim());
  const fixedTail = `${VARIATION_DIRECTIONS[concept.variationId] || "Commercial photography."} ${IMAGE_ONLY_RULE}`;
  const variable = [concept.visualPrompt, concept.designDirection].filter(Boolean).join(" ");
  const room = Math.max(0, 2048 - fixedTail.length - 1);
  const prompt = `${variable.slice(0, room).trim()} ${fixedTail}`.trim();
  return prompt || details.join(" ").slice(0, 2048);
}

export async function generateCampaignImages(campaign, hasUploadedImage = false, { provider: suppliedProvider, imageModel } = {}) {
  if (hasUploadedImage) {
    for (const concept of campaign.concepts) concept.visualSource = "UPLOADED_IMAGE";
    campaign.visualSource = "UPLOADED_IMAGE";
    return campaign;
  }

  let provider = suppliedProvider;
  try {
    provider ||= createCloudflareImageProvider();
  } catch {
    for (const concept of campaign.concepts) {
      concept.visualSource = "TEMPLATE_FALLBACK";
      concept.imageModel = imageModel || process.env.CLOUDFLARE_IMAGE_MODEL?.trim() || DEFAULT_CLOUDFLARE_IMAGE_MODEL;
    }
    campaign.visualSource = "TEMPLATE_FALLBACK";
    return campaign;
  }
  let stoppedOnError = false;
  for (const concept of campaign.concepts) {
    if (stoppedOnError) {
      concept.aiImageUrl = null;
      concept.visualSource = "TEMPLATE_FALLBACK";
      continue;
    }
    try {
      const generated = await provider.generate(buildImagePrompt(concept));
      concept.aiImageUrl = generated.imageUrl;
      concept.imageModel = generated.imageModel;
      concept.imageGenerationMs = generated.generationMs;
      concept.visualSource = "CUSTOM_AI_VISUAL";
    } catch {
      concept.aiImageUrl = null;
      concept.imageModel = provider.model;
      concept.visualSource = "TEMPLATE_FALLBACK";
      stoppedOnError = true;
    }
  }

  const sources = new Set(campaign.concepts.map((concept) => concept.visualSource));
  campaign.visualSource = sources.size === 1 ? campaign.concepts[0].visualSource : "MIXED_VISUALS";
  return campaign;
}

export async function generateConceptImage(concept, { provider: suppliedProvider } = {}) {
  const provider = suppliedProvider || createCloudflareImageProvider();
  const generated = await provider.generate(buildImagePrompt(concept));
  return { ...generated, visualSource: "CUSTOM_AI_VISUAL" };
}

export async function generateConceptImageOrFallback(concept, hasUploadedImage = false, { provider, imageModel } = {}) {
  if (hasUploadedImage) return { aiImageUrl: null, visualSource: "UPLOADED_IMAGE" };
  try {
    const generated = await generateConceptImage(concept, { provider });
    return {
      aiImageUrl: generated.imageUrl,
      imageModel: generated.imageModel,
      imageGenerationMs: generated.generationMs,
      visualSource: generated.visualSource,
    };
  } catch {
    return {
      aiImageUrl: null,
      imageModel: imageModel || process.env.CLOUDFLARE_IMAGE_MODEL?.trim() || DEFAULT_CLOUDFLARE_IMAGE_MODEL,
      visualSource: "TEMPLATE_FALLBACK",
    };
  }
}
