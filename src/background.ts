import {
  OFFLINE_MODELS as STABLE_OFFLINE_MODELS,
  normalizeDictionaryEntries,
  offlineTranslate as stableOfflineTranslate,
  offlineTranslateBatch as stableOfflineTranslateBatch,
  type OfflineDictionaryEntry,
} from "./offline";

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

interface TranslateBatchItem {
  id: string;
  text: string;
}

interface ResolvedSettings {
  provider: string;
  apiKey: string;
  config: ProviderConfig;
}

interface CacheEntry {
  value: string;
  expiresAt: number;
  usedAt: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

// ── Provider configuration ─────────────────────────

interface ProviderConfig {
  baseUrl: string;
  model: string;
  authHeader?: "bearer" | "api-key";
  requiresApiKey?: boolean;
}

const PROVIDER_DEFAULTS: Record<string, ProviderConfig> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
  },
  xiaomi: {
    baseUrl: "https://api.xiaomimimo.com/v1/chat/completions",
    model: "mimo-v2.5-pro",
    authHeader: "api-key",
  },
  offline: {
    baseUrl: "",
    model: "local-dictionary",
    requiresApiKey: false,
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

const XIAOMI_MODELS = [
  { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
  { id: "mimo-v2.5", name: "MiMo V2.5" },
  { id: "mimo-v2.5-pro-ultraspeed", name: "MiMo V2.5 Pro UltraSpeed" },
  { id: "mimo-v2-pro", name: "MiMo V2 Pro" },
  { id: "mimo-v2-omni", name: "MiMo V2 Omni" },
  { id: "mimo-v2-flash", name: "MiMo V2 Flash" },
];

const OFFLINE_MODELS = [
  {
    id: "local-dictionary",
    name: "local-dictionary (true offline MVP)",
  },
  {
    id: "browser-native",
    name: "browser-native (key-free, if available)",
  },
  {
    id: "transformers-js",
    name: "transformers-js (reserved for local WASM models)",
  },
];

const REQUEST_TIMEOUT_MS = 18000;
const TRANSLATION_CACHE_KEY = "ttTranslationCacheV1";
const CUSTOM_DICTIONARY_KEY = "customDictionary";
const CACHE_MAX_ENTRIES = 500;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_MAX_ITEMS = 8;
const BATCH_MAX_CHARS = 6000;

const translationCache = new Map<string, CacheEntry>();
const inFlightTranslations = new Map<string, Promise<string>>();
let cacheLoadPromise: Promise<void> | null = null;
let cacheSaveTimer: ReturnType<typeof setTimeout> | null = null;

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

function buildBatchPrompt(sourceLang: string, targetLang: string): string {
  const source = langNames[sourceLang] || sourceLang;
  const target = langNames[targetLang] || targetLang;
  return [
    `Translate each ${source} text item to ${target}.`,
    'Return only valid JSON in this exact shape: {"items":[{"id":"same id","translation":"translated text"}]}.',
    "Keep every id unchanged. Do not add markdown, explanations, or extra fields.",
  ].join(" ");
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function normalizeText(text: string): string {
  return text.trim();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function getCustomDictionary(): Promise<OfflineDictionaryEntry[]> {
  const stored = await chrome.storage.local.get([CUSTOM_DICTIONARY_KEY]);
  return normalizeDictionaryEntries(stored[CUSTOM_DICTIONARY_KEY]);
}

function customDictionaryCacheVariant(
  customDictionary: OfflineDictionaryEntry[]
): string {
  if (!customDictionary.length) return "custom-dict:empty";
  const normalized = customDictionary
    .map((entry) => ({
      source: entry.source,
      target: entry.target,
      sourceLang: entry.sourceLang,
      targetLang: entry.targetLang,
    }))
    .sort((a, b) =>
      `${a.sourceLang}\u0000${a.targetLang}\u0000${a.source}`.localeCompare(
        `${b.sourceLang}\u0000${b.targetLang}\u0000${b.source}`
      )
    );
  return `custom-dict:${stableHash(JSON.stringify(normalized))}`;
}

function makeCacheKey(
  settings: ResolvedSettings,
  sourceLang: string,
  targetLang: string,
  text: string,
  variant = ""
): string {
  const parts = [
    settings.provider,
    settings.config.model,
    sourceLang,
    targetLang,
    stableHash(normalizeText(text)),
  ];
  if (variant) parts.push(variant);
  return parts.join("|");
}

async function loadCacheOnce(): Promise<void> {
  if (cacheLoadPromise) return cacheLoadPromise;

  cacheLoadPromise = chrome.storage.local
    .get([TRANSLATION_CACHE_KEY])
    .then((stored) => {
      const raw = stored[TRANSLATION_CACHE_KEY];
      if (!raw || typeof raw !== "object") return;

      for (const [key, value] of Object.entries(raw as Record<string, CacheEntry>)) {
        if (
          value &&
          typeof value.value === "string" &&
          typeof value.expiresAt === "number" &&
          value.expiresAt > Date.now()
        ) {
          translationCache.set(key, value);
        }
      }
      pruneCache();
    })
    .catch(() => {
      // Cache is an optimization only. Translation should keep working if storage fails.
    });

  return cacheLoadPromise;
}

function pruneCache(): void {
  const now = Date.now();
  for (const [key, entry] of translationCache) {
    if (entry.expiresAt <= now) translationCache.delete(key);
  }

  if (translationCache.size <= CACHE_MAX_ENTRIES) return;
  const ordered = Array.from(translationCache.entries()).sort(
    (a, b) => a[1].usedAt - b[1].usedAt
  );
  for (const [key] of ordered.slice(0, translationCache.size - CACHE_MAX_ENTRIES)) {
    translationCache.delete(key);
  }
}

function saveCacheSoon(): void {
  if (cacheSaveTimer) return;
  cacheSaveTimer = setTimeout(() => {
    cacheSaveTimer = null;
    pruneCache();
    const payload: Record<string, CacheEntry> = {};
    for (const [key, entry] of translationCache) payload[key] = entry;
    chrome.storage.local.set({ [TRANSLATION_CACHE_KEY]: payload }).catch(() => {
      // Ignore cache persistence failures.
    });
  }, 1000);
}

function getCachedTranslation(key: string): string | null {
  const entry = translationCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    translationCache.delete(key);
    saveCacheSoon();
    return null;
  }
  entry.usedAt = Date.now();
  return entry.value;
}

function setCachedTranslation(key: string, value: string): void {
  translationCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
    usedAt: Date.now(),
  });
  pruneCache();
  saveCacheSoon();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[CUSTOM_DICTIONARY_KEY]) return;
  translationCache.clear();
  inFlightTranslations.clear();
  saveCacheSoon();
});

function validateSettings(settings: ResolvedSettings): void {
  const requiresApiKey = settings.config.requiresApiKey !== false;
  if (requiresApiKey && !settings.apiKey) {
    throw new Error("API key not configured");
  }
  if (settings.provider === "custom" && !settings.config.baseUrl) {
    throw new Error("Custom base URL not configured");
  }
  if (!settings.config.model) throw new Error("Model not configured");
}

function authHeaders(
  apiKey: string,
  authHeader: ProviderConfig["authHeader"] = "bearer"
): Record<string, string> {
  if (authHeader === "api-key") return { "api-key": apiKey };
  return { Authorization: `Bearer ${apiKey}` };
}

const EXACT_OFFLINE_TRANSLATIONS: Record<string, Record<string, string>> = {
  "en>zh": {
    hello: "你好",
    hi: "你好",
    "good morning": "早上好",
    "good afternoon": "下午好",
    "good evening": "晚上好",
    "thank you": "谢谢",
    thanks: "谢谢",
    "you are welcome": "不客气",
    "how are you": "你好吗",
    "i am fine": "我很好",
    yes: "是",
    no: "不是",
    ok: "好的",
    okay: "好的",
    "see you later": "回头见",
    goodbye: "再见",
    "how much": "多少钱",
    "please wait": "请稍等",
    "no problem": "没问题",
    "basic translation unavailable": "基础翻译不可用",
  },
  "zh>en": {
    "你好": "hello",
    "您好": "hello",
    "早上好": "good morning",
    "下午好": "good afternoon",
    "晚上好": "good evening",
    "谢谢": "thank you",
    "多谢": "thank you",
    "不客气": "you are welcome",
    "你好吗": "how are you",
    "我很好": "i am fine",
    "是": "yes",
    "不是": "no",
    "好的": "ok",
    "可以": "ok",
    "再见": "goodbye",
    "多少钱": "how much",
    "请稍等": "please wait",
    "没问题": "no problem",
  },
  "en>zh_tw": {
    hello: "你好",
    hi: "你好",
    "thank you": "謝謝",
    thanks: "謝謝",
    goodbye: "再見",
    ok: "好的",
  },
  "zh_tw>en": {
    "你好": "hello",
    "謝謝": "thank you",
    "再見": "goodbye",
    "好的": "ok",
  },
  "en>es": {
    hello: "hola",
    hi: "hola",
    thanks: "gracias",
    "thank you": "gracias",
    goodbye: "adios",
    yes: "si",
    no: "no",
    ok: "vale",
  },
  "es>en": {
    hola: "hello",
    gracias: "thank you",
    adios: "goodbye",
    si: "yes",
    no: "no",
    vale: "ok",
  },
  "en>fr": {
    hello: "bonjour",
    hi: "bonjour",
    thanks: "merci",
    "thank you": "merci",
    goodbye: "au revoir",
    yes: "oui",
    no: "non",
  },
  "fr>en": {
    bonjour: "hello",
    merci: "thank you",
    "au revoir": "goodbye",
    oui: "yes",
    non: "no",
  },
};

const WORD_OFFLINE_TRANSLATIONS: Record<string, Record<string, string>> = {
  "en>zh": {
    i: "我",
    you: "你",
    we: "我们",
    they: "他们",
    he: "他",
    she: "她",
    it: "它",
    am: "是",
    are: "是",
    is: "是",
    have: "有",
    has: "有",
    need: "需要",
    want: "想要",
    buy: "买",
    sell: "卖",
    send: "发送",
    receive: "收到",
    price: "价格",
    product: "产品",
    order: "订单",
    payment: "付款",
    today: "今天",
    tomorrow: "明天",
    yesterday: "昨天",
    now: "现在",
    later: "稍后",
    please: "请",
    help: "帮助",
    wait: "等待",
    message: "消息",
    address: "地址",
    name: "名字",
    phone: "电话",
    email: "邮箱",
    good: "好",
    bad: "不好",
    new: "新的",
    old: "旧的",
    fast: "快",
    slow: "慢",
  },
  "zh>en": {
    "我": "I",
    "你": "you",
    "您": "you",
    "我们": "we",
    "他们": "they",
    "他": "he",
    "她": "she",
    "它": "it",
    "是": "is",
    "有": "have",
    "需要": "need",
    "想要": "want",
    "买": "buy",
    "卖": "sell",
    "发送": "send",
    "收到": "receive",
    "价格": "price",
    "产品": "product",
    "订单": "order",
    "付款": "payment",
    "今天": "today",
    "明天": "tomorrow",
    "昨天": "yesterday",
    "现在": "now",
    "稍后": "later",
    "请": "please",
    "帮助": "help",
    "等待": "wait",
    "消息": "message",
    "地址": "address",
    "名字": "name",
    "电话": "phone",
    "邮箱": "email",
    "好": "good",
    "不好": "bad",
    "新的": "new",
    "旧的": "old",
    "快": "fast",
    "慢": "slow",
  },
};

function offlinePair(sourceLang: string, targetLang: string): string {
  return `${sourceLang}>${targetLang}`;
}

function normalizeOfflineExact(text: string, sourceLang: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  return sourceLang === "en" ? normalized.toLowerCase() : normalized;
}

function isCompactTarget(targetLang: string): boolean {
  return ["zh", "zh_tw", "ja", "ko", "th"].includes(targetLang);
}

function translateEnglishWords(
  text: string,
  dictionary: Record<string, string>,
  targetLang: string
): string | null {
  const tokens = text.match(/[A-Za-z']+|\d+|[^\sA-Za-z\d]+|\s+/g) || [text];
  let translatedCount = 0;
  const compact = isCompactTarget(targetLang);

  const result = tokens
    .map((token) => {
      if (/^[A-Za-z']+$/.test(token)) {
        const translated = dictionary[token.toLowerCase()];
        if (translated) {
          translatedCount++;
          return translated;
        }
      }
      if (compact && /^\s+$/.test(token)) return "";
      return token;
    })
    .join("")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();

  return translatedCount ? result : null;
}

function translatePhraseSegments(
  text: string,
  dictionary: Record<string, string>,
  targetLang: string
): string | null {
  let result = text;
  let translatedCount = 0;
  const compact = isCompactTarget(targetLang);

  for (const source of Object.keys(dictionary).sort((a, b) => b.length - a.length)) {
    if (!result.includes(source)) continue;
    const replacement = compact ? dictionary[source] : ` ${dictionary[source]} `;
    result = result.split(source).join(replacement);
    translatedCount++;
  }

  if (!translatedCount) return null;
  return result.replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
}

function localDictionaryTranslate(
  text: string,
  sourceLang: string,
  targetLang: string
): string {
  if (sourceLang === targetLang) return text;

  const pair = offlinePair(sourceLang, targetLang);
  const exact = EXACT_OFFLINE_TRANSLATIONS[pair];
  const exactKey = normalizeOfflineExact(text, sourceLang);
  if (exact?.[exactKey]) return exact[exactKey];

  const words = WORD_OFFLINE_TRANSLATIONS[pair];
  if (!words) return text;

  const wordTranslated =
    sourceLang === "en"
      ? translateEnglishWords(text, words, targetLang)
      : translatePhraseSegments(text, words, targetLang);

  return wordTranslated || text;
}

function toBrowserLanguageCode(lang: string): string {
  if (lang === "zh") return "zh-CN";
  if (lang === "zh_tw") return "zh-TW";
  return lang.replace("_", "-");
}

async function browserNativeTranslate(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string | null> {
  const translationApi = (globalThis as any).translation;
  const translatorApi = (globalThis as any).Translator;

  const createTranslator =
    translationApi?.createTranslator?.bind(translationApi) ||
    translatorApi?.create?.bind(translatorApi);
  if (!createTranslator) return null;

  const translator = await createTranslator({
    sourceLanguage: toBrowserLanguageCode(sourceLang),
    targetLanguage: toBrowserLanguageCode(targetLang),
  });

  try {
    const translated = await translator.translate(text);
    return typeof translated === "string" && translated.trim()
      ? translated.trim()
      : null;
  } finally {
    translator.destroy?.();
  }
}

async function offlineTranslate(
  text: string,
  sourceLang: string,
  targetLang: string,
  engine = "local-dictionary"
): Promise<string> {
  try {
    if (engine === "browser-native") {
      const nativeResult = await browserNativeTranslate(text, sourceLang, targetLang);
      if (nativeResult) return nativeResult;
    }

    // transformers-js is reserved for a future bundled local model. Until then,
    // fall back to the deterministic local dictionary instead of network calls.
    return localDictionaryTranslate(text, sourceLang, targetLang);
  } catch {
    return localDictionaryTranslate(text, sourceLang, targetLang);
  }
}

async function offlineTranslateBatch(
  items: TranslateBatchItem[],
  sourceLang: string,
  targetLang: string,
  engine = "local-dictionary"
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  await Promise.all(
    items.map(async (item) => {
      const translated = await offlineTranslate(
        item.text,
        sourceLang,
        targetLang,
        engine
      );
      results.set(item.id, translated);
    })
  );
  return results;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (fetchErr: any) {
    if (fetchErr?.name === "AbortError") {
      throw new Error(`Request timeout after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw fetchErr;
  } finally {
    clearTimeout(timer);
  }
}

function estimateMaxTokens(charCount: number, itemCount = 1): number {
  return Math.min(4096, Math.max(256, Math.ceil(charCount * 1.2) + itemCount * 64));
}

function buildBatchUserMessage(
  items: TranslateBatchItem[],
  sourceLang: string,
  targetLang: string
): string {
  return `${buildBatchPrompt(sourceLang, targetLang)}\n\n${JSON.stringify({
    items,
  })}`;
}

function extractJsonValue(content: string): unknown {
  let cleaned = content.trim();
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [cleaned];
  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(cleaned.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(cleaned.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("Batch response was not valid JSON");
}

function parseBatchTranslations(
  content: string,
  requested: TranslateBatchItem[]
): Map<string, string> {
  const parsed = extractJsonValue(content);
  const results = new Map<string, string>();

  if (Array.isArray(parsed)) {
    parsed.forEach((entry, index) => {
      if (typeof entry === "string" && requested[index]) {
        results.set(requested[index].id, entry.trim());
      } else if (entry && typeof entry === "object") {
        addBatchObjectResult(results, entry as Record<string, unknown>);
      }
    });
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const list =
      (obj.items as unknown[]) ||
      (obj.translations as unknown[]) ||
      (obj.results as unknown[]);

    if (Array.isArray(list)) {
      for (const entry of list) {
        if (entry && typeof entry === "object") {
          addBatchObjectResult(results, entry as Record<string, unknown>);
        }
      }
    }

    for (const item of requested) {
      const directValue = obj[item.id];
      if (typeof directValue === "string") {
        results.set(item.id, directValue.trim());
      }
    }
  }

  for (const item of requested) {
    if (!results.get(item.id)) {
      throw new Error(`Batch response missing translation for ${item.id}`);
    }
  }

  return results;
}

function addBatchObjectResult(
  results: Map<string, string>,
  entry: Record<string, unknown>
): void {
  const id = entry.id ?? entry.key ?? entry.index;
  const translated =
    entry.translation ??
    entry.translated ??
    entry.text ??
    entry.value ??
    entry.output;

  if (id === undefined || typeof translated !== "string") return;
  results.set(String(id), translated.trim());
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
    "modelSelect",
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

  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.deepseek;
  return {
    provider,
    apiKey,
    config: {
      ...defaults,
      model: stored.modelSelect || defaults.model,
    },
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
    response = await fetchWithTimeout(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(apiKey, config.authHeader),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "user", content: `${prompt}\n\n${text}` },
        ],
        temperature: 0,
        max_tokens: estimateMaxTokens(text.length),
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
    response = await fetchWithTimeout(config.baseUrl, {
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
        max_tokens: estimateMaxTokens(text.length),
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
    response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}\n\n${text}` }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: estimateMaxTokens(text.length),
        },
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

async function callOpenAICompatibleBatch(
  items: TranslateBatchItem[],
  sourceLang: string,
  targetLang: string,
  config: ProviderConfig,
  apiKey: string
): Promise<Map<string, string>> {
  const message = buildBatchUserMessage(items, sourceLang, targetLang);
  let response: Response;
  try {
    response = await fetchWithTimeout(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(apiKey, config.authHeader),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: message }],
        temperature: 0,
        max_tokens: estimateMaxTokens(message.length, items.length),
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
  return parseBatchTranslations(content, items);
}

async function callClaudeBatch(
  items: TranslateBatchItem[],
  sourceLang: string,
  targetLang: string,
  config: ProviderConfig,
  apiKey: string
): Promise<Map<string, string>> {
  const message = buildBatchUserMessage(items, sourceLang, targetLang);
  let response: Response;
  try {
    response = await fetchWithTimeout(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: message }],
        max_tokens: estimateMaxTokens(message.length, items.length),
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
  return parseBatchTranslations(content, items);
}

async function callGeminiBatch(
  items: TranslateBatchItem[],
  sourceLang: string,
  targetLang: string,
  config: ProviderConfig,
  apiKey: string
): Promise<Map<string, string>> {
  const url = config.baseUrl.replace("{model}", config.model) + `?key=${apiKey}`;
  const message = buildBatchUserMessage(items, sourceLang, targetLang);
  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: message }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: estimateMaxTokens(message.length, items.length),
        },
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
  return parseBatchTranslations(content, items);
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
  const settings = await getSettings();
  validateSettings(settings);
  const customDictionary =
    settings.provider === "offline" ? await getCustomDictionary() : undefined;
  return callAPIWithSettings(
    text,
    sourceLang,
    targetLang,
    settings,
    customDictionary
  );
}

async function callAPIWithSettings(
  text: string,
  sourceLang: string,
  targetLang: string,
  settings: ResolvedSettings,
  customDictionary: OfflineDictionaryEntry[] = []
): Promise<string> {
  const { provider, apiKey, config } = settings;
  if (provider === "offline") {
    return stableOfflineTranslate(
      text,
      sourceLang,
      targetLang,
      config.model,
      customDictionary
    );
  }

  const prompt = buildPrompt(sourceLang, targetLang);

  try {
    switch (provider) {
      case "claude":
        return await callClaude(text, prompt, config, apiKey);
      case "gemini":
        return await callGemini(text, prompt, config, apiKey);
      case "deepseek":
      case "xiaomi":
      case "openai":
      case "custom":
      default:
        return await callOpenAICompatible(text, prompt, config, apiKey);
    }
  } catch (err: any) {
    const msg: string = err.message || "Translation failed";
    if (/^\d{3}:/.test(msg)) {
      const status = parseInt(msg);
      const body = msg.slice(4);
      throw new Error(humanizeError(status, body));
    }
    throw new Error(msg);
  }
}

async function callBatchAPIWithSettings(
  items: TranslateBatchItem[],
  sourceLang: string,
  targetLang: string,
  settings: ResolvedSettings,
  customDictionary: OfflineDictionaryEntry[] = []
): Promise<Map<string, string>> {
  const { provider, apiKey, config } = settings;
  if (provider === "offline") {
    return stableOfflineTranslateBatch(
      items,
      sourceLang,
      targetLang,
      config.model,
      customDictionary
    );
  }

  try {
    switch (provider) {
      case "claude":
        return await callClaudeBatch(items, sourceLang, targetLang, config, apiKey);
      case "gemini":
        return await callGeminiBatch(items, sourceLang, targetLang, config, apiKey);
      case "deepseek":
      case "xiaomi":
      case "openai":
      case "custom":
      default:
        return await callOpenAICompatibleBatch(
          items,
          sourceLang,
          targetLang,
          config,
          apiKey
        );
    }
  } catch (err: any) {
    const msg: string = err.message || "Translation failed";
    if (/^\d{3}:/.test(msg)) {
      const status = parseInt(msg);
      const body = msg.slice(4);
      throw new Error(humanizeError(status, body));
    }
    throw new Error(msg);
  }
}

async function translateWithCache(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  const settings = await getSettings();
  validateSettings(settings);
  await loadCacheOnce();
  const customDictionary =
    settings.provider === "offline" ? await getCustomDictionary() : [];
  const cacheVariant =
    settings.provider === "offline"
      ? customDictionaryCacheVariant(customDictionary)
      : "";

  const normalizedText = normalizeText(text);
  const key = makeCacheKey(
    settings,
    sourceLang,
    targetLang,
    normalizedText,
    cacheVariant
  );
  const cached = getCachedTranslation(key);
  if (cached) return cached;

  const inFlight = inFlightTranslations.get(key);
  if (inFlight) return inFlight;

  const promise = callAPIWithSettings(
    normalizedText,
    sourceLang,
    targetLang,
    settings,
    customDictionary
  )
    .then((translated) => {
      setCachedTranslation(key, translated);
      return translated;
    })
    .finally(() => {
      inFlightTranslations.delete(key);
    });

  inFlightTranslations.set(key, promise);
  return promise;
}

function chunkTranslationGroups<T extends { text: string }>(groups: T[]): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;

  for (const group of groups) {
    const nextWouldOverflow =
      current.length >= BATCH_MAX_ITEMS ||
      currentChars + group.text.length > BATCH_MAX_CHARS;
    if (current.length && nextWouldOverflow) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(group);
    currentChars += group.text.length;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

async function translateBatch(
  items: TranslateBatchItem[],
  sourceLang: string,
  targetLang: string
): Promise<Record<string, TranslateResponse>> {
  const settings = await getSettings();
  validateSettings(settings);
  await loadCacheOnce();
  const customDictionary =
    settings.provider === "offline" ? await getCustomDictionary() : [];
  const cacheVariant =
    settings.provider === "offline"
      ? customDictionaryCacheVariant(customDictionary)
      : "";

  const responses: Record<string, TranslateResponse> = {};
  const grouped = new Map<
    string,
    { key: string; text: string; ids: string[]; deferred: Deferred<string> }
  >();
  const pendingExisting: Promise<void>[] = [];

  for (const item of items) {
    const normalizedText = normalizeText(item.text);
    if (!item.id || !normalizedText) {
      responses[item.id || ""] = { translated: "", error: "Invalid item" };
      continue;
    }

    const key = makeCacheKey(
      settings,
      sourceLang,
      targetLang,
      normalizedText,
      cacheVariant
    );
    const cached = getCachedTranslation(key);
    if (cached) {
      responses[item.id] = { translated: cached };
      continue;
    }

    const existing = inFlightTranslations.get(key);
    if (existing) {
      pendingExisting.push(
        existing.then(
          (translated) => {
            responses[item.id] = { translated };
          },
          (err: any) => {
            responses[item.id] = {
              translated: "",
              error: err?.message || "Translation failed",
            };
          }
        )
      );
      continue;
    }

    const group = grouped.get(key);
    if (group) {
      group.ids.push(item.id);
    } else {
      const deferred = createDeferred<string>();
      deferred.promise.catch(() => {
        // Prevent unhandled rejection noise when no concurrent caller is waiting.
      });
      grouped.set(key, {
        key,
        text: normalizedText,
        ids: [item.id],
        deferred,
      });
    }
  }

  const groups = Array.from(grouped.values());
  for (const group of groups) {
    inFlightTranslations.set(group.key, group.deferred.promise);
  }

  const chunks = chunkTranslationGroups(groups);
  await Promise.all([
    ...pendingExisting,
    ...chunks.map((chunk) =>
      translateBatchChunk(
        chunk,
        sourceLang,
        targetLang,
        settings,
        responses,
        customDictionary
      )
    ),
  ]);

  return responses;
}

async function translateBatchChunk(
  chunk: {
    key: string;
    text: string;
    ids: string[];
    deferred: Deferred<string>;
  }[],
  sourceLang: string,
  targetLang: string,
  settings: ResolvedSettings,
  responses: Record<string, TranslateResponse>,
  customDictionary: OfflineDictionaryEntry[] = []
): Promise<void> {
  const requestItems = chunk.map((group, index) => ({
    id: `b${index}`,
    text: group.text,
  }));

  try {
    const translatedMap =
      requestItems.length > 1
        ? await callBatchAPIWithSettings(
            requestItems,
            sourceLang,
            targetLang,
            settings,
            customDictionary
          )
        : new Map([
            [
              requestItems[0].id,
              await callAPIWithSettings(
                requestItems[0].text,
                sourceLang,
                targetLang,
                settings,
                customDictionary
              ),
            ],
          ]);

    for (let index = 0; index < chunk.length; index++) {
      const group = chunk[index];
      const translated = translatedMap.get(requestItems[index].id);
      if (!translated) throw new Error("Empty batch translation result");
      setCachedTranslation(group.key, translated);
      group.deferred.resolve(translated);
      for (const id of group.ids) responses[id] = { translated };
    }
  } catch (batchErr: any) {
    await Promise.all(
      chunk.map(async (group) => {
        try {
          const translated = await callAPIWithSettings(
            group.text,
            sourceLang,
            targetLang,
            settings,
            customDictionary
          );
          setCachedTranslation(group.key, translated);
          group.deferred.resolve(translated);
          for (const id of group.ids) responses[id] = { translated };
        } catch (err: any) {
          const message =
            err?.message || batchErr?.message || "Translation failed";
          group.deferred.reject(new Error(message));
          for (const id of group.ids) {
            responses[id] = { translated: "", error: message };
          }
        }
      })
    );
  } finally {
    for (const group of chunk) inFlightTranslations.delete(group.key);
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

async function fetchModelsOpenAI(
  baseUrl: string,
  apiKey: string,
  authHeader: ProviderConfig["authHeader"] = "bearer"
) {
  const modelsUrl = baseUrl.replace(/\/$/, "") + "/models";
  const response = await fetch(modelsUrl, {
    headers: authHeaders(apiKey, authHeader),
  });
  if (!response.ok) throw new Error(`Fetch models failed: ${response.status}`);
  const data = await response.json();
  return (data.data || []).map((m: any) => ({ id: m.id, name: m.id })).sort((a: any, b: any) => a.id.localeCompare(b.id));
}

async function fetchModelsXiaomi(apiKey: string) {
  if (!apiKey) return XIAOMI_MODELS;

  try {
    const models = await fetchModelsOpenAI(
      "https://api.xiaomimimo.com/v1",
      apiKey,
      "api-key"
    );
    return models.length ? models : XIAOMI_MODELS;
  } catch {
    return XIAOMI_MODELS;
  }
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
      case "xiaomi": return { data: await fetchModelsXiaomi(apiKey) };
      case "offline": return { data: STABLE_OFFLINE_MODELS };
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
    if (
      request?.action === "translateBatch" &&
      Array.isArray(request.items) &&
      request?.sourceLang &&
      request?.targetLang
    ) {
      (async () => {
        try {
          const items = request.items
            .filter((item: any) => item?.id && item?.text)
            .map((item: any) => ({
              id: String(item.id),
              text: String(item.text),
            }));
          const results = await translateBatch(
            items,
            request.sourceLang,
            request.targetLang
          );
          sendResponse({ results });
        } catch (err: any) {
          sendResponse({
            results: {},
            error: err.message || "Batch translation failed",
          });
        }
      })();
      return true;
    }
    if (request?.text && request?.sourceLang && request?.targetLang) {
      (async () => {
        try {
          const translated = await translateWithCache(request.text, request.sourceLang, request.targetLang);
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
