const DEFAULT_CLOUDFLARE_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

function makeError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function selectedAIProvider(env = process.env) {
  const configured = env.AI_PROVIDER?.trim().toLowerCase();
  if (env.NODE_ENV === "production" && configured && configured !== "cloudflare") {
    throw makeError("Production requires AI_PROVIDER=cloudflare. Ollama is available only for local development.", 503, "AI_PROVIDER_NOT_SUPPORTED");
  }
  if (configured) return configured;
  return env.NODE_ENV === "production" ? "cloudflare" : "ollama";
}

function configuredOllamaUrl(env) {
  return env.OLLAMA_BASE_URL?.trim().replace(/\/+$/, "") || "http://localhost:11434";
}

async function ollamaRequest(path, options, env) {
  try {
    return await fetch(`${configuredOllamaUrl(env)}${path}`, {
      ...options,
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw makeError("Local AI request timed out. Please try again.", 504, "OLLAMA_TIMEOUT");
    }
    throw makeError("Local AI is not running. Please start Ollama and try again.", 503, "OLLAMA_UNAVAILABLE");
  }
}

async function ollamaChat({ messages, schema }, env) {
  const model = env.OLLAMA_MODEL?.trim();
  if (!model) {
    throw makeError("OLLAMA_MODEL is not configured. Set it to a model installed in Ollama.", 503, "OLLAMA_MODEL_NOT_CONFIGURED");
  }
  const tagsResponse = await ollamaRequest("/api/tags", {}, env);
  if (!tagsResponse.ok) throw makeError("Could not check installed Ollama models.", 503, "OLLAMA_UNAVAILABLE");
  let tags;
  try { tags = await tagsResponse.json(); } catch {
    throw makeError("Could not check installed Ollama models.", 503, "OLLAMA_UNAVAILABLE");
  }
  if (!tags.models?.some((entry) => entry.name === model)) {
    throw makeError("Configured Ollama model is not installed.", 503, "OLLAMA_MODEL_NOT_FOUND");
  }

  const response = await ollamaRequest("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: false, format: schema, messages, options: { temperature: 0.3 } }),
  }, env);
  if (response.status === 404) throw makeError("Configured Ollama model is not installed.", 503, "OLLAMA_MODEL_NOT_FOUND");
  if (!response.ok) throw makeError("Ollama could not generate a response. Please try again.", 502, "OLLAMA_REQUEST_FAILED");
  let result;
  try { result = await response.json(); } catch {
    throw makeError("Local AI returned a malformed response. Please try again.", 502, "AI_INVALID_RESPONSE");
  }
  return { message: { content: result.message?.content } };
}

async function cloudflareChat({ messages, schema }, env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    throw makeError(
      "Cloudflare AI is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN on the server.",
      503,
      "CLOUDFLARE_NOT_CONFIGURED",
    );
  }
  const model = env.CLOUDFLARE_AI_MODEL?.trim() || DEFAULT_CLOUDFLARE_MODEL;
  const endpoint = `${CLOUDFLARE_API_BASE}/${encodeURIComponent(accountId)}/ai/v1/chat/completions`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: "json_schema", json_schema: schema },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw makeError("Cloudflare AI request timed out. Please try again.", 504, "AI_TIMEOUT");
    }
    throw makeError("Cloudflare AI is temporarily unavailable. Please try again.", 503, "AI_UNAVAILABLE");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw makeError("Cloudflare AI credentials are invalid or lack Workers AI access.", 503, "CLOUDFLARE_AUTH_FAILED");
    }
    if (response.status === 404 || response.status === 410) {
      throw makeError("The configured Cloudflare AI model is unavailable to this account.", 503, "CLOUDFLARE_MODEL_UNAVAILABLE");
    }
    if (response.status === 429) {
      throw makeError("Cloudflare AI is rate limited or its usage allocation is exhausted. Please try again later.", 429, "AI_RATE_LIMITED");
    }
    if (response.status >= 500) {
      throw makeError("Cloudflare AI is temporarily unavailable. Please try again.", 503, "AI_UNAVAILABLE");
    }
    throw makeError("Cloudflare AI rejected the generation request. Check the server configuration and try again.", 502, "AI_REQUEST_REJECTED");
  }

  let result;
  try { result = await response.json(); } catch {
    throw makeError("Cloudflare AI returned a malformed response. Please try again.", 502, "AI_INVALID_RESPONSE");
  }
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw makeError("Cloudflare AI returned an empty response. Please try again.", 502, "AI_EMPTY_RESPONSE");
  }
  return { message: { content } };
}

export function createAIProvider(env = process.env) {
  const provider = selectedAIProvider(env);
  if (provider === "cloudflare") {
    return { name: provider, chat: (request) => cloudflareChat(request, env) };
  }
  if (provider === "ollama") {
    return { name: provider, chat: (request) => ollamaChat(request, env) };
  }
  throw makeError("AI_PROVIDER must be either cloudflare or ollama.", 503, "AI_PROVIDER_NOT_SUPPORTED");
}
