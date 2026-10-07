const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const DEFAULT_CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const MAX_IMAGE_PROMPT_LENGTH = 2048;
const IMAGE_REQUEST_TIMEOUT_MS = 60_000;

function makeError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function detectImageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  return null;
}

export function createCloudflareImageProvider({ env = process.env, fetchImpl = (...args) => fetch(...args) } = {}) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const model = env.CLOUDFLARE_IMAGE_MODEL?.trim() || DEFAULT_CLOUDFLARE_IMAGE_MODEL;

  if (!accountId || !apiToken) {
    throw makeError(
      "Cloudflare image generation is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN on the server.",
      503,
      "CLOUDFLARE_IMAGE_NOT_CONFIGURED",
    );
  }

  return {
    model,
    async generate(prompt) {
      if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_IMAGE_PROMPT_LENGTH) {
        throw makeError("The visual prompt is invalid or too long.", 400, "AI_IMAGE_INVALID_PROMPT");
      }

      const endpoint = `${CLOUDFLARE_API_BASE}/${encodeURIComponent(accountId)}/ai/run/${model}`;
      let response;
      const started = Date.now();
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prompt: prompt.trim() }),
          signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        if (error.name === "TimeoutError" || error.name === "AbortError") {
          throw makeError("Image generation timed out. The existing poster layout will be used.", 504, "AI_IMAGE_TIMEOUT");
        }
        throw makeError("Cloudflare image generation is temporarily unavailable. The existing poster layout will be used.", 503, "AI_IMAGE_UNAVAILABLE");
      }

      if (!response.ok) {
        if (response.status === 429) {
          throw makeError("Cloudflare image capacity or its free daily allocation is unavailable. The existing poster layout will be used.", 429, "AI_IMAGE_RATE_LIMITED");
        }
        if (response.status === 404 || response.status === 410) {
          throw makeError("The configured Cloudflare image model is unavailable. The existing poster layout will be used.", 503, "AI_IMAGE_MODEL_UNAVAILABLE");
        }
        if (response.status === 401 || response.status === 403) {
          throw makeError("Cloudflare image generation is not enabled for this account. The existing poster layout will be used.", 503, "AI_IMAGE_ACCOUNT_UNAVAILABLE");
        }
        throw makeError("Cloudflare image generation failed. The existing poster layout will be used.", 502, "AI_IMAGE_REQUEST_FAILED");
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw makeError("Cloudflare returned a malformed image response. The existing poster layout will be used.", 502, "AI_IMAGE_INVALID_RESPONSE");
      }
      const encoded = payload?.result?.image;
      if (typeof encoded !== "string" || encoded.length === 0 || encoded.length > 16_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw makeError("Cloudflare returned an invalid image. The existing poster layout will be used.", 502, "AI_IMAGE_INVALID_RESPONSE");
      }

      const bytes = Buffer.from(encoded, "base64");
      const mimeType = detectImageMime(bytes);
      if (!mimeType) {
        throw makeError("Cloudflare returned an unsupported image format. The existing poster layout will be used.", 502, "AI_IMAGE_INVALID_RESPONSE");
      }

      return {
        imageUrl: `data:${mimeType};base64,${encoded}`,
        imageModel: model,
        generationMs: Date.now() - started,
      };
    },
  };
}

export { DEFAULT_CLOUDFLARE_IMAGE_MODEL };
