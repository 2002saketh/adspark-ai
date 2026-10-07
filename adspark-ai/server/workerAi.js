const DEFAULT_TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
const DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

function appError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

function imageBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function imageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}

export function createWorkersAITextProvider(env) {
  const model = env.CLOUDFLARE_AI_MODEL?.trim() || DEFAULT_TEXT_MODEL;
  return {
    name: "cloudflare-workers-ai",
    async chat({ messages, schema }) {
      if (!env.AI?.run) throw appError("Workers AI binding is unavailable.", 503, "AI_UNAVAILABLE");
      let result;
      try {
        result = await env.AI.run(model, {
          messages,
          temperature: 0.3,
          max_tokens: 4096,
          response_format: { type: "json_schema", json_schema: schema },
        });
      } catch {
        throw appError("Workers AI could not generate a response. Please try again.", 503, "AI_UNAVAILABLE");
      }
      const candidates = typeof result === "string" ? [result] : [result?.response, result?.choices?.[0]?.message?.content];
      const content = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
      if (typeof content !== "string" || !content.trim()) throw appError("Workers AI returned an empty response. Please try again.", 502, "AI_EMPTY_RESPONSE");
      return { message: { content } };
    },
  };
}

export function createWorkersAIImageProvider(env) {
  const model = env.CLOUDFLARE_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
  return {
    model,
    async generate(prompt) {
      if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 2048) {
        throw appError("The visual prompt is invalid or too long.", 400, "AI_IMAGE_INVALID_PROMPT");
      }
      const started = Date.now();
      let output;
      try { output = await env.AI.run(model, { prompt: prompt.trim() }); }
      catch { throw appError("Workers AI image generation is temporarily unavailable. The existing poster layout will be used.", 503, "AI_IMAGE_UNAVAILABLE"); }
      const image = output?.image ?? output;
      let bytes;
      if (image instanceof ReadableStream || image instanceof Response) bytes = new Uint8Array(await new Response(image).arrayBuffer());
      else if (image instanceof Uint8Array) bytes = image;
      else if (image instanceof ArrayBuffer) bytes = new Uint8Array(image);
      else if (typeof image === "string") {
        try { bytes = Uint8Array.from(atob(image), (char) => char.charCodeAt(0)); }
        catch { throw appError("Workers AI returned an invalid image. The existing poster layout will be used.", 502, "AI_IMAGE_INVALID_RESPONSE"); }
      }
      if (!bytes?.length || bytes.length > 12_000_000) throw appError("Workers AI returned an invalid image. The existing poster layout will be used.", 502, "AI_IMAGE_INVALID_RESPONSE");
      const mime = imageMime(bytes);
      if (!mime) throw appError("Workers AI returned an unsupported image format. The existing poster layout will be used.", 502, "AI_IMAGE_INVALID_RESPONSE");
      return { imageUrl: `data:${mime};base64,${imageBase64(bytes)}`, imageModel: model, generationMs: Date.now() - started };
    },
  };
}

export { DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL };
