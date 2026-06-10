export interface OfflineModelOption {
  id: string;
  name: string;
}

export interface OfflineDictionaryEntry {
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
}

interface TranslateBatchItem {
  id: string;
  text: string;
}

interface DictionaryResult {
  translated: string;
  hit: boolean;
  matchedTerms: string[];
  customHit: boolean;
}

interface PhrasePair {
  source: string;
  target: string;
  dictionarySource: "custom" | "starter";
  priority: number;
}

type StarterPhrasePair = [source: string, target: string];

export const OFFLINE_DICTIONARY_NO_MATCH = "Offline dictionary has no match";
const OFFLINE_TRANSLATION_TIMEOUT_MS = 1500;

export const OFFLINE_MODELS: OfflineModelOption[] = [
  {
    id: "local-dictionary",
    name: "local-dictionary (basic offline dictionary)",
  },
  {
    id: "browser-native",
    name: "browser-native (key-free if browser supports it)",
  },
  {
    id: "transformers-js",
    name: "transformers-js (placeholder, falls back to dictionary)",
  },
];

const STARTER_DICTIONARY: Record<string, StarterPhrasePair[]> = {
  "zh>en": [
    ["\u6211\u77e5\u9053\u4e86", "I understand"],
    ["\u4e0d\u53ef\u4ee5", "no / cannot"],
    ["\u4e0d\u884c", "no / cannot"],
    ["\u53ef\u4ee5", "yes / can"],
    ["\u8bf7\u95ee", "may I ask"],
    ["\u7a0d\u7b49", "please wait"],
    ["\u7b49\u4e00\u4e0b", "please wait"],
    ["\u5e74\u540e", "after the New Year"],
    ["\u4f60\u597d", "hello"],
    ["\u60a8\u597d", "hello"],
    ["\u6d4b\u8bd5", "test"],
    ["\u8c22\u8c22", "thank you"],
    ["\u591a\u8c22", "thank you"],
    ["\u597d\u7684", "ok"],
    ["\u518d\u89c1", "goodbye"],
    ["\u6ca1\u95ee\u9898", "no problem"],
    ["\u591a\u5c11\u94b1", "how much"],
    ["\u4ef7\u683c", "price"],
    ["\u4ea7\u54c1", "product"],
    ["\u8ba2\u5355", "order"],
    ["\u4ed8\u6b3e", "payment"],
    ["\u53d1\u8d27", "ship goods"],
    ["\u7269\u6d41", "logistics"],
    ["\u5ba2\u6237", "customer"],
    ["\u4f9b\u5e94\u5546", "supplier"],
    ["\u62a5\u4ef7", "quotation"],
    ["\u5408\u540c", "contract"],
    ["\u53d1\u7968", "invoice"],
    ["\u6837\u54c1", "sample"],
    ["\u8d28\u91cf", "quality"],
    ["\u4eca\u5929", "today"],
    ["\u660e\u5929", "tomorrow"],
    ["\u6628\u5929", "yesterday"],
    ["\u73b0\u5728", "now"],
    ["\u7a0d\u540e", "later"],
    ["\u5e2e\u52a9", "help"],
    ["\u6d88\u606f", "message"],
    ["\u5730\u5740", "address"],
    ["\u540d\u5b57", "name"],
    ["\u7535\u8bdd", "phone"],
    ["\u90ae\u7bb1", "email"],
    ["\u6211", "I"],
    ["\u4f60", "you"],
    ["\u60a8", "you"],
    ["\u662f", "is"],
    ["\u6709", "have"],
    ["\u9700\u8981", "need"],
    ["\u60f3\u8981", "want"],
    ["\u4e70", "buy"],
    ["\u5356", "sell"],
    ["\u597d", "good"],
  ],
  "en>zh": [
    ["after the new year", "\u5e74\u540e"],
    ["i understand", "\u6211\u77e5\u9053\u4e86"],
    ["no / cannot", "\u4e0d\u53ef\u4ee5"],
    ["please wait", "\u7a0d\u7b49"],
    ["may i ask", "\u8bf7\u95ee"],
    ["thank you", "\u8c22\u8c22"],
    ["no problem", "\u6ca1\u95ee\u9898"],
    ["how much", "\u591a\u5c11\u94b1"],
    ["good morning", "\u65e9\u4e0a\u597d"],
    ["good afternoon", "\u4e0b\u5348\u597d"],
    ["good evening", "\u665a\u4e0a\u597d"],
    ["ship goods", "\u53d1\u8d27"],
    ["logistics", "\u7269\u6d41"],
    ["customer", "\u5ba2\u6237"],
    ["supplier", "\u4f9b\u5e94\u5546"],
    ["quotation", "\u62a5\u4ef7"],
    ["contract", "\u5408\u540c"],
    ["invoice", "\u53d1\u7968"],
    ["sample", "\u6837\u54c1"],
    ["quality", "\u8d28\u91cf"],
    ["hello", "\u4f60\u597d"],
    ["hi", "\u4f60\u597d"],
    ["test", "\u6d4b\u8bd5"],
    ["thanks", "\u8c22\u8c22"],
    ["ok", "\u597d\u7684"],
    ["okay", "\u597d\u7684"],
    ["yes", "\u662f"],
    ["can", "\u53ef\u4ee5"],
    ["no", "\u4e0d\u53ef\u4ee5"],
    ["cannot", "\u4e0d\u53ef\u4ee5"],
    ["goodbye", "\u518d\u89c1"],
    ["price", "\u4ef7\u683c"],
    ["product", "\u4ea7\u54c1"],
    ["order", "\u8ba2\u5355"],
    ["payment", "\u4ed8\u6b3e"],
    ["today", "\u4eca\u5929"],
    ["tomorrow", "\u660e\u5929"],
    ["yesterday", "\u6628\u5929"],
    ["now", "\u73b0\u5728"],
    ["later", "\u7a0d\u540e"],
    ["help", "\u5e2e\u52a9"],
    ["message", "\u6d88\u606f"],
    ["address", "\u5730\u5740"],
    ["name", "\u540d\u5b57"],
    ["phone", "\u7535\u8bdd"],
    ["email", "\u90ae\u7bb1"],
    ["i", "\u6211"],
    ["you", "\u4f60"],
    ["we", "\u6211\u4eec"],
    ["they", "\u4ed6\u4eec"],
    ["need", "\u9700\u8981"],
    ["want", "\u60f3\u8981"],
    ["buy", "\u4e70"],
    ["sell", "\u5356"],
    ["good", "\u597d"],
  ],
};

function normalizeLang(lang: string): string {
  return lang === "zh_tw" ? "zh" : lang;
}

function pairKey(sourceLang: string, targetLang: string): string {
  return `${normalizeLang(sourceLang)}>${normalizeLang(targetLang)}`;
}

function normalizeSource(source: string, sourceLang: string): string {
  const normalized = source.trim().replace(/\s+/g, " ");
  return normalizeLang(sourceLang) === "en" ? normalized.toLowerCase() : normalized;
}

export function normalizeDictionaryEntries(
  entries: unknown
): OfflineDictionaryEntry[] {
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Partial<OfflineDictionaryEntry>;
      const source = String(raw.source || "").trim();
      const target = String(raw.target || "").trim();
      const sourceLang = String(raw.sourceLang || "").trim();
      const targetLang = String(raw.targetLang || "").trim();
      if (!source || !target || !sourceLang || !targetLang) return null;
      return { source, target, sourceLang, targetLang };
    })
    .filter((entry): entry is OfflineDictionaryEntry => Boolean(entry));
}

function customPhrases(
  sourceLang: string,
  targetLang: string,
  customDictionary: OfflineDictionaryEntry[]
): PhrasePair[] {
  const targetPair = pairKey(sourceLang, targetLang);
  return normalizeDictionaryEntries(customDictionary)
    .filter((entry) => pairKey(entry.sourceLang, entry.targetLang) === targetPair)
    .map((entry) => ({
      source: normalizeSource(entry.source, sourceLang),
      target: entry.target.trim(),
      dictionarySource: "custom" as const,
      priority: 0,
    }));
}

function starterPhrases(sourceLang: string, targetLang: string): PhrasePair[] {
  return (STARTER_DICTIONARY[pairKey(sourceLang, targetLang)] || []).map(
    ([source, target]) => ({
      source: normalizeSource(source, sourceLang),
      target,
      dictionarySource: "starter" as const,
      priority: 1,
    })
  );
}

function orderedPhrases(
  sourceLang: string,
  targetLang: string,
  customDictionary: OfflineDictionaryEntry[]
): PhrasePair[] {
  return [...customPhrases(sourceLang, targetLang, customDictionary), ...starterPhrases(sourceLang, targetLang)]
    .filter((phrase) => phrase.source && phrase.target)
    .sort((a, b) => b.source.length - a.source.length || a.priority - b.priority);
}

function convertPunctuation(char: string, targetLang: string): string {
  if (normalizeLang(targetLang) === "en") {
    const toEnglish: Record<string, string> = {
      "\uff0c": ",",
      "\u3002": ".",
      "\uff1f": "?",
      "\uff01": "!",
      "\uff1a": ":",
      "\uff1b": ";",
      "\uff08": "(",
      "\uff09": ")",
    };
    return toEnglish[char] || char;
  }

  if (normalizeLang(targetLang) === "zh") {
    const toChinese: Record<string, string> = {
      ",": "\uff0c",
      ".": "\u3002",
      "?": "\uff1f",
      "!": "\uff01",
      ":": "\uff1a",
      ";": "\uff1b",
      "(": "\uff08",
      ")": "\uff09",
    };
    return toChinese[char] || char;
  }

  return char;
}

function cleanupTranslation(text: string, targetLang: string): string {
  let cleaned = text.replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1");

  if (normalizeLang(targetLang) === "en") {
    cleaned = cleaned.replace(/([,.!?;:])(?=[^\s\d])/g, "$1 ");
  }

  if (normalizeLang(targetLang) === "zh") {
    cleaned = cleaned.replace(
      /\s*([\uff0c\u3002\uff1f\uff01\uff1a\uff1b\uff08\uff09])\s*/g,
      "$1"
    );
  }

  return cleaned.trim();
}

function translateChineseByLongestMatch(
  text: string,
  phrases: PhrasePair[],
  targetLang: string
): DictionaryResult {
  let output = "";
  const matchedTerms: string[] = [];
  let customHit = false;
  let index = 0;

  while (index < text.length) {
    const match = phrases.find((phrase) => text.startsWith(phrase.source, index));
    if (match) {
      output += normalizeLang(targetLang) === "en" ? ` ${match.target} ` : match.target;
      matchedTerms.push(match.source);
      customHit = customHit || match.dictionarySource === "custom";
      index += match.source.length;
      continue;
    }

    output += convertPunctuation(text[index], targetLang);
    index++;
  }

  return {
    translated: cleanupTranslation(output, targetLang),
    hit: matchedTerms.length > 0,
    matchedTerms,
    customHit,
  };
}

function isWordBoundary(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return true;
  return !/[a-zA-Z']/.test(text[index]);
}

function translateEnglishByLongestMatch(
  text: string,
  phrases: PhrasePair[],
  targetLang: string
): DictionaryResult {
  const lower = text.toLowerCase();
  let output = "";
  const matchedTerms: string[] = [];
  let customHit = false;
  let index = 0;

  while (index < text.length) {
    const match = phrases.find((phrase) => {
      if (!lower.startsWith(phrase.source, index)) return false;
      return (
        isWordBoundary(lower, index - 1) &&
        isWordBoundary(lower, index + phrase.source.length)
      );
    });

    if (match) {
      output += match.target;
      matchedTerms.push(match.source);
      customHit = customHit || match.dictionarySource === "custom";
      index += match.source.length;
      continue;
    }

    output += convertPunctuation(text[index], targetLang);
    index++;
  }

  return {
    translated: cleanupTranslation(output, targetLang),
    hit: matchedTerms.length > 0,
    matchedTerms,
    customHit,
  };
}

function localDictionaryTranslate(
  text: string,
  sourceLang: string,
  targetLang: string,
  customDictionary: OfflineDictionaryEntry[]
): DictionaryResult {
  if (sourceLang === targetLang) {
    return { translated: text, hit: true, matchedTerms: [], customHit: false };
  }

  const phrases = orderedPhrases(sourceLang, targetLang, customDictionary);
  if (!phrases.length) {
    return { translated: "", hit: false, matchedTerms: [], customHit: false };
  }

  if (normalizeLang(sourceLang) === "en") {
    return translateEnglishByLongestMatch(text, phrases, targetLang);
  }

  return translateChineseByLongestMatch(text, phrases, targetLang);
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

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Offline translation timeout")), ms);
  });
}

function logOffline(details: {
  engine: string;
  sourceLang: string;
  targetLang: string;
  dictionaryHit: boolean;
  customDictionaryHit: boolean;
  fallbackOccurred: boolean;
  reason: string;
  matchedTerms?: string[];
}): void {
  console.log("[TradeTranslate][offline]", {
    provider: "offline",
    ...details,
  });
}

function logDictionaryResult(
  engine: string,
  sourceLang: string,
  targetLang: string,
  result: DictionaryResult,
  fallbackOccurred: boolean,
  reason: string
): void {
  logOffline({
    engine,
    sourceLang,
    targetLang,
    dictionaryHit: result.hit,
    customDictionaryHit: result.customHit,
    fallbackOccurred,
    reason: result.hit ? reason : OFFLINE_DICTIONARY_NO_MATCH,
    matchedTerms: result.matchedTerms,
  });
}

async function offlineTranslateCore(
  text: string,
  sourceLang: string,
  targetLang: string,
  engine: string,
  customDictionary: OfflineDictionaryEntry[]
): Promise<string> {
  const dictionaryResult = localDictionaryTranslate(
    text,
    sourceLang,
    targetLang,
    customDictionary
  );

  if (dictionaryResult.hit && dictionaryResult.translated) {
    logDictionaryResult(
      engine,
      sourceLang,
      targetLang,
      dictionaryResult,
      false,
      dictionaryResult.customHit ? "custom-dictionary-hit" : "starter-dictionary-hit"
    );
    return dictionaryResult.translated;
  }

  logDictionaryResult(
    engine,
    sourceLang,
    targetLang,
    dictionaryResult,
    engine === "browser-native",
    "dictionary-miss"
  );

  if (engine === "browser-native") {
    const nativeResult = await Promise.race([
      browserNativeTranslate(text, sourceLang, targetLang),
      timeoutAfter(OFFLINE_TRANSLATION_TIMEOUT_MS),
    ]).catch(() => null);

    if (nativeResult && nativeResult !== text) {
      logOffline({
        engine,
        sourceLang,
        targetLang,
        dictionaryHit: false,
        customDictionaryHit: false,
        fallbackOccurred: true,
        reason: "browser-native-fallback-hit",
      });
      return nativeResult;
    }
  }

  if (engine === "transformers-js") {
    logOffline({
      engine,
      sourceLang,
      targetLang,
      dictionaryHit: false,
      customDictionaryHit: false,
      fallbackOccurred: true,
      reason: "transformers-js-placeholder-dictionary-miss",
    });
  }

  throw new Error(OFFLINE_DICTIONARY_NO_MATCH);
}

export async function offlineTranslate(
  text: string,
  sourceLang: string,
  targetLang: string,
  engine = "local-dictionary",
  customDictionary: OfflineDictionaryEntry[] = []
): Promise<string> {
  try {
    return await Promise.race([
      offlineTranslateCore(
        text,
        sourceLang,
        targetLang,
        engine,
        customDictionary
      ),
      timeoutAfter(OFFLINE_TRANSLATION_TIMEOUT_MS),
    ]);
  } catch (err: any) {
    if (err?.message === "Offline translation timeout") {
      logOffline({
        engine,
        sourceLang,
        targetLang,
        dictionaryHit: false,
        customDictionaryHit: false,
        fallbackOccurred: true,
        reason: "offline-timeout",
      });
      throw new Error(OFFLINE_DICTIONARY_NO_MATCH);
    }
    throw err;
  }
}

export async function offlineTranslateBatch(
  items: TranslateBatchItem[],
  sourceLang: string,
  targetLang: string,
  engine = "local-dictionary",
  customDictionary: OfflineDictionaryEntry[] = []
): Promise<Map<string, string>> {
  const pairs = await Promise.all(
    items.map(async (item) => [
      item.id,
      await offlineTranslate(
        item.text,
        sourceLang,
        targetLang,
        engine,
        customDictionary
      ),
    ] as const)
  );
  return new Map(pairs);
}
