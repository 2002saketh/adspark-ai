import type { AdCampaign, AdConcept, AdInput, CreativeVariation } from "../types";

export interface GenerateAdPayload {
  businessName: string;
  businessType: string;
  productService: string;
  priceOffer: string;
  targetCustomer: string;
  tone: string;
  campaignBrief?: string;
  hasUploadedImage?: boolean;
  generateAiVisual?: boolean;
}

export interface VisualResponse {
  imageUrl: string;
  imageModel: string;
  generationMs: number;
  visualSource: "CUSTOM_AI_VISUAL";
}

/**
 * Calls the server-side Real AI endpoint to analyze business details and generate 3 ad concepts.
 */
export async function generateRealAdCampaign(input: AdInput, hasUploadedImage = input.visualMode === "upload"): Promise<AdCampaign> {
  const payload: GenerateAdPayload = {
    businessName: input.businessName.trim(),
    businessType: input.businessType,
    productService: input.product.trim(),
    priceOffer: input.offer.trim(),
    targetCustomer: input.target.trim(),
    tone: input.tone,
    campaignBrief: input.campaignBrief?.trim(),
    hasUploadedImage,
    generateAiVisual: input.visualMode === "ai",
  };

  const response = await fetch("/api/generate-ad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMessage = `Server error (${response.status})`;
    try {
      const errData = await response.json();
      if (errData?.error) errorMessage = errData.error;
    } catch {
      // fallback to status code message
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  if (!data?.concepts || !Array.isArray(data.concepts) || data.concepts.length === 0) {
    throw new Error("Invalid campaign data received from server.");
  }

  return {
    analysis: data.analysis || {
      businessCore: input.product,
      targetAudience: input.target || "Local customers",
      strongestBenefit: "High-quality professional service",
      sellingAngle: "Direct customer value",
    },
    concepts: data.concepts,
    source: "api",
  };
}

/**
 * Requests an AI visual image for a specific creative concept.
 */
export async function generateVisualForConcept(
  visualPrompt: string,
  businessName: string,
  variationId: CreativeVariation,
  designDirection = "",
): Promise<VisualResponse> {
  const response = await fetch("/api/generate-visual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visualPrompt, businessName, variationId, designDirection }),
  });

  if (!response.ok) {
    let errorMessage = "Failed to generate AI visual.";
    try {
      const errData = await response.json();
      if (errData?.error) errorMessage = errData.error;
    } catch {
      // fallback
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Regenerates a single creative concept using Real AI.
 */
export async function regenerateRealConcept(
  input: AdInput,
  variationId: CreativeVariation,
  hasUploadedImage = input.visualMode === "upload",
): Promise<AdConcept> {
  const payload = {
    businessName: input.businessName.trim(),
    businessType: input.businessType,
    productService: input.product.trim(),
    priceOffer: input.offer.trim(),
    targetCustomer: input.target.trim(),
    tone: input.tone,
    campaignBrief: input.campaignBrief?.trim(),
    hasUploadedImage,
    variationId,
  };

  const response = await fetch("/api/regenerate-concept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMessage = "Failed to regenerate concept.";
    try {
      const errData = await response.json();
      if (errData?.error) errorMessage = errData.error;
    } catch {
      // fallback
    }
    throw new Error(errorMessage);
  }

  return response.json();
}
