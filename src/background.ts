// TradeTranslate background service worker
// Bridges content script → DeepSeek API, avoiding CORS

interface TranslateRequest {
  text: string;
  direction: "en2zh" | "zh2en";
}

interface TranslateResponse {
  translated: string;
  error?: string;
}

// ── API Configuration ──────────────────────────
const BASE_URL = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";

const PROMPTS: Record<string, string> = {
  en2zh:
    "You are a professional translator. Translate the following English text into natural, fluent Simplified Chinese. Preserve tone (casual, formal, technical). Only respond with the translation — no explanations, no notes.",
  zh2en:
    "You are a professional translator. Translate the following Chinese text into natural, fluent English. Preserve tone (casual, formal, technical). Only respond with the translation — no explanations, no notes.",
};

async function getApiKey(): Promise<string> {
  const stored = await chrome.storage.local.get("apiKey");
  return stored.apiKey || "";
}

async function callAPI(text: string, direction: "en2zh" | "zh2en"): Promise<string> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("Deepseek API key not configured");

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: PROMPTS[direction] },
        { role: "user", content: text },
      ],
      temperature: 0.2,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    let msg: string;
    switch (response.status) {
      case 401: msg = "Invalid API key"; break;
      case 429: msg = "Rate limited — retry shortly"; break;
      case 403: msg = "Permission denied or quota exceeded"; break;
      default: msg = `API error ${response.status}`;
    }
    const errBody = await response.text().catch(() => "");
    throw new Error(errBody ? `${msg}: ${errBody.slice(0, 200)}` : msg);
  }

  const data = await response.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from API");
  return content.trim();
}

chrome.runtime.onMessage.addListener(
  (request: TranslateRequest, _sender, sendResponse) => {
    if (!request?.text || !request?.direction) {
      sendResponse({ translated: "", error: "Invalid request" });
      return true;
    }

    (async () => {
      try {
        const translated = await callAPI(request.text, request.direction);
        sendResponse({ translated });
      } catch (err: any) {
        sendResponse({ translated: "", error: err.message || "Translation failed" });
      }
    })();

    return true;
  }
);
