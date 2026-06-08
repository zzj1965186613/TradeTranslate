// TradeTranslate background service worker
// Bridges content script → multiple AI translation APIs

interface TranslateRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
}

interface TranslateResponse {
  translated: string;
  error?: string;
}

// ── Provider configuration ─────────────────────────

interface ProviderConfig {
  baseUrl: string;
  model: string;
}

const PROVIDER_DEFAULTS: Record<string, ProviderConfig> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
  claude: {
    baseUrl: "https://api.anthropic.com/v1/messages",
    model: "claude-3-5-haiku-20241022",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    model: "gemini-2.0-flash",
  },
  custom: {
    baseUrl: "",
    model: "",
  },
};

// ── Language names for prompt generation ────────────

const langNames: Record<string, string> = {
  en: "English",
  zh: "Simplified Chinese",
  zh_tw: "Traditional Chinese",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ru: "Russian",
  ar: "Arabic",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
};

function buildPrompt(sourceLang: string, targetLang: string): string {
  const source = langNames[sourceLang] || sourceLang;
  const target = langNames[targetLang] || targetLang;
  return `Translate the following ${source} text to ${target}. Output the translation only, nothing else.`;
}

// ── Settings helpers ───────────────────────────────

async function getSettings(): Promise<{
  provider: string;
  apiKey: string;
  config: ProviderConfig;
}> {
  const stored = await chrome.storage.local.get([
    "apiProvider",
    "apiKey",
    "customBaseUrl",
    "customModel",
  ]);
  const provider: string = stored.apiProvider || "deepseek";
  const apiKey: string = stored.apiKey || "";

  if (provider === "custom") {
    let customUrl = stored.customBaseUrl || "";
    if (customUrl && !/\/chat\/completions\/?$/i.test(customUrl) && !/\/messages\/?$/i.test(customUrl)) {
      customUrl = customUrl.replace(/\/+?$/, "") + "/chat/completions";
    }
    return {
      provider,
      apiKey,
      config: {
        baseUrl: customUrl,
        model: stored.customModel || "",
      },
    };
  }

  return {
    provider,
    apiKey,
    config: PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.deepseek,
  };
}

// ── OpenAI-compatible provider (DeepSeek, OpenAI, Custom) ──

async function callOpenAICompatible(
  text: string,
  prompt: string,
  config: ProviderConfig,
  apiKey: string
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "user", content: `${prompt}\n\n${text}` },
        ],
        temperature: 0,
        max_tokens: 512,
      }),
    });
  } catch (fetchErr: any) {
    throw new Error(`Network error: ${fetchErr.message}. Check your API endpoint URL (${config.baseUrl}) and network connection.`);
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${await safeErrBody(response)}`);
  }

  const data = await response.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from API");
  return content.trim();
}

// ── Claude (Anthropic) — different API format ──────

async function callClaude(
  text: string,
  prompt: string,
  config: ProviderConfig,
  apiKey: string
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        system: prompt,
        messages: [{ role: "user", content: `Translate:\n${text}` }],
        max_tokens: 512,
      }),
    });
  } catch (fetchErr: any) {
    throw new Error(`Network error: ${fetchErr.message}. Check your API endpoint URL (${config.baseUrl}) and network connection.`);
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${await safeErrBody(response)}`);
  }

  const data = await response.json();
  const content: string | undefined = data?.content?.[0]?.text;
  if (!content) throw new Error("Empty response from Claude");
  return content.trim();
}

// ── Google Gemini — also different format ──────────

async function callGemini(
  text: string,
  prompt: string,
  config: ProviderConfig,
  apiKey: string
): Promise<string> {
  const url = config.baseUrl.replace("{model}", config.model) + `?key=${apiKey}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}\n\n${text}` }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 512 },
      }),
    });
  } catch (fetchErr: any) {
    throw new Error(`Network error: ${fetchErr.message}. Check your API endpoint URL (${url}) and network connection.`);
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${await safeErrBody(response)}`);
  }

  const data = await response.json();
  const content: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error("Empty response from Gemini");
  return content.trim();
}

// ── Error body helper ──────────────────────────────

async function safeErrBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 200);
  } catch {
    return "";
  }
}

// ── Unified error messages ─────────────────────────

function humanizeError(status: number, body: string): string {
  let msg: string;
  switch (status) {
    case 401:
      msg = "Invalid API key";
      break;
    case 429:
      msg = "Rate limited — retry shortly";
      break;
    case 403:
      msg = "Permission denied or quota exceeded";
      break;
    default:
      msg = `API error ${status}`;
  }
  return body ? `${msg}: ${body}` : msg;
}

// ── Main dispatcher ────────────────────────────────

async function callAPI(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  const { provider, apiKey, config } = await getSettings();

  if (!apiKey) throw new Error("API key not configured");
  if (provider === "custom" && !config.baseUrl)
    throw new Error("Custom base URL not configured");

  const prompt = buildPrompt(sourceLang, targetLang);

  try {
    switch (provider) {
      case "claude":
        return await callClaude(text, prompt, config, apiKey);
      case "gemini":
        return await callGemini(text, prompt, config, apiKey);
      case "deepseek":
      case "openai":
      case "custom":
      default:
        return await callOpenAICompatible(text, prompt, config, apiKey);
    }
  } catch (err: any) {
    const msg: string = err.message || "Translation failed";
    // Re-throw with human-readable message if it looks like a status code
    if (/^\d{3}:/.test(msg)) {
      const status = parseInt(msg);
      const body = msg.slice(4);
      throw new Error(humanizeError(status, body));
    }
    throw new Error(msg);
  }
}


// ── Model list fetching ────────────────────────────────

const CLAUDE_MODELS = [
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
  { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
  { id: "claude-3-opus-20240229", name: "Claude 3 Opus" },
];

function deriveModelsUrl(chatCompletionsUrl: string): string {
  let url = chatCompletionsUrl.replace(/\/+$/, "");
  url = url.replace(/\/chat\/completions?$/i, "");
  return url;
}

async function fetchModelsOpenAI(baseUrl: string, apiKey: string) {
  const modelsUrl = baseUrl.replace(/\/$/, "") + "/models";
  const response = await fetch(modelsUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Fetch models failed: ${response.status}`);
  const data = await response.json();
  return (data.data || []).map((m: any) => ({ id: m.id, name: m.id })).sort((a: any, b: any) => a.id.localeCompare(b.id));
}

async function fetchModelsGemini(apiKey: string) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!response.ok) throw new Error(`Fetch Gemini models failed: ${response.status}`);
  const data = await response.json();
  return (data.models || [])
    .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m: any) => ({ id: m.name.replace("models/", ""), name: m.displayName || m.name.replace("models/", "") }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
}

async function fetchModels(provider: string, apiKey: string, customBaseUrl?: string) {
  try {
    switch (provider) {
      case "deepseek": return { data: await fetchModelsOpenAI("https://api.deepseek.com/v1", apiKey) };
      case "openai": return { data: await fetchModelsOpenAI("https://api.openai.com/v1", apiKey) };
      case "claude": return { data: CLAUDE_MODELS };
      case "gemini": return { data: await fetchModelsGemini(apiKey) };
      case "custom": {
        if (!customBaseUrl) return { data: [], error: "No base URL configured" };
        return { data: await fetchModelsOpenAI(deriveModelsUrl(customBaseUrl), apiKey) };
      }
      default: return { data: [], error: "Unknown provider" };
    }
  } catch (err: any) {
    return { data: [], error: err.message || "Failed to fetch models" };
  }
}

// ── Message listener ───────────────────────────────

chrome.runtime.onMessage.addListener(
  (request: any, _sender, sendResponse) => {
    if (request?.action === "fetchModels") {
      (async () => {
        const result = await fetchModels(request.provider, request.apiKey, request.customBaseUrl);
        sendResponse(result);
      })();
      return true;
    }
    if (request?.text && request?.sourceLang && request?.targetLang) {
      (async () => {
        try {
          const translated = await callAPI(request.text, request.sourceLang, request.targetLang);
          sendResponse({ translated });
        } catch (err: any) {
          sendResponse({ translated: "", error: err.message || "Translation failed" });
        }
      })();
      return true;
    }
    sendResponse({ translated: "", error: "Invalid request" });
    return true;
  }
);