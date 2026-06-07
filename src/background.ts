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
  return `You are a professional translator. Translate the following ${source} text into natural, fluent ${target}. Preserve tone (casual, formal, technical). Only respond with the translation — no explanations, no notes.`;
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
    return {
      provider,
      apiKey,
      config: {
        baseUrl: stored.customBaseUrl || "",
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
  const response = await fetch(config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: text },
      ],
      temperature: 0.2,
      max_tokens: 2048,
    }),
  });

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
  const response = await fetch(config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      system: prompt,
      messages: [{ role: "user", content: text }],
      max_tokens: 2048,
    }),
  });

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
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${prompt}\n\n${text}` }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
    }),
  });

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

// ── Message listener ───────────────────────────────

chrome.runtime.onMessage.addListener(
  (request: TranslateRequest, _sender, sendResponse) => {
    if (!request?.text || !request?.sourceLang || !request?.targetLang) {
      sendResponse({ translated: "", error: "Invalid request" });
      return true;
    }

    (async () => {
      try {
        const translated = await callAPI(
          request.text,
          request.sourceLang,
          request.targetLang
        );
        sendResponse({ translated });
      } catch (err: any) {
        sendResponse({
          translated: "",
          error: err.message || "Translation failed",
        });
      }
    })();

    return true;
  }
);
