// TradeTranslate content script for WhatsApp Web
//   Incoming: auto-translate incoming messages, append below original
//   Outgoing: intercept outgoing messages, translate before send

// ── Types ────────────────────────────────────────────
interface TranslateResponse {
  translated: string;
  error?: string;
}

interface TranslateBatchItem {
  id: string;
  text: string;
}

interface TranslateBatchResponse {
  results?: Record<string, TranslateResponse>;
  error?: string;
}

interface IncomingQueueItem {
  id: string;
  el: Element;
  text: string;
  sourceLang: string;
  targetLang: string;
}

// ── Configuration ────────────────────────────────────
const DEBOUNCE_MS = 600;
const INCOMING_BATCH_DELAY_MS = 120;
const INCOMING_BATCH_MAX_ITEMS = 8;
const TRANSLATION_ATTR = "data-tt-done";
const PENDING_ATTR = "data-tt-pending";
const TRANSLATION_CLASS = "tt-translation";
const MEMORY_CACHE_MAX = 250;
const __TT_DEBUG__ = true;
function ttLog(...args: unknown[]): void {
  if (__TT_DEBUG__) console.log("[TradeTranslate]", ...args);
}

// ── Mutable state ────────────────────────────────────
let translateIncoming = true;
let translateOutgoing = true;
let sourceLangIncoming = "en";
let targetLangIncoming = "zh";
let sourceLangOutgoing = "zh";
let targetLangOutgoing = "en";
let cachedTranslation: string | null = null;
let cachedSource: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let isProcessingSend = false;
let isComposing = false;
let preTranslatePromise: Promise<TranslateResponse> | null = null;
let preTranslateSource: string | null = null;
let lastPreTranslateText: string | null = null;
let incomingBatchTimer: ReturnType<typeof setTimeout> | null = null;
let incomingIdCounter = 0;

// Track bound input elements to prevent duplicate bindings
const boundInputs = new WeakSet<HTMLElement>();
const queuedIncomingEls = new Set<Element>();
const incomingQueue: IncomingQueueItem[] = [];
const memoryTranslationCache = new Map<string, string>();

// ── Helpers ──────────────────────────────────────────

// Script detection functions
function hasCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(text);
}

function hasLatin(text: string): boolean {
  return /[a-zA-Z]/.test(text);
}

function hasCyrillic(text: string): boolean {
  return /[\u0400-\u04ff]/.test(text);
}

function hasArabic(text: string): boolean {
  return /[\u0600-\u06ff]/.test(text);
}

function hasHiraganaKatakana(text: string): boolean {
  return /[\u3040-\u309f\u30a0-\u30ff]/.test(text);
}

function hasHangul(text: string): boolean {
  return /[\uac00-\ud7af]/.test(text);
}

function hasThai(text: string): boolean {
  return /[\u0e00-\u0e7f]/.test(text);
}

// Detect text script (used to determine if translation is needed)
// Returns "cjk" | "latin" | "cyrillic" | "arabic" | "japanese" | "korean" | "thai" | "unknown"
function detectScript(text: string): string {
  if (hasCJK(text) && !hasHiraganaKatakana(text)) return "cjk";
  if (hasHiraganaKatakana(text)) return "japanese";
  if (hasHangul(text)) return "korean";
  if (hasLatin(text)) return "latin";
  if (hasCyrillic(text)) return "cyrillic";
  if (hasArabic(text)) return "arabic";
  if (hasThai(text)) return "thai";
  return "unknown";
}

// Map language code to expected script
function getExpectedScript(langCode: string): string {
  const scriptMap: Record<string, string> = {
    en: "latin",
    zh: "cjk",
    zh_tw: "cjk",
    ja: "japanese",
    ko: "korean",
    es: "latin",
    fr: "latin",
    de: "latin",
    pt: "latin",
    ru: "cyrillic",
    ar: "arabic",
    vi: "latin",
    th: "thai",
    id: "latin",
  };
  return scriptMap[langCode] || "unknown";
}

// Check if text matches the expected language script
function matchesLanguage(text: string, langCode: string): boolean {
  const script = detectScript(text);
  const expected = getExpectedScript(langCode);
  
  // Special case for CJK: Chinese vs Japanese
  if (expected === "cjk") {
    return hasCJK(text) && !hasHiraganaKatakana(text);
  }

  return script === expected;
}

function translationCacheKey(
  text: string,
  sourceLang: string,
  targetLang: string
): string {
  return `${sourceLang}\u0000${targetLang}\u0000${text}`;
}

function getMemoryTranslation(
  text: string,
  sourceLang: string,
  targetLang: string
): string | null {
  const key = translationCacheKey(text, sourceLang, targetLang);
  const value = memoryTranslationCache.get(key);
  if (!value) return null;
  memoryTranslationCache.delete(key);
  memoryTranslationCache.set(key, value);
  return value;
}

function setMemoryTranslation(
  text: string,
  sourceLang: string,
  targetLang: string,
  translation: string
): void {
  const key = translationCacheKey(text, sourceLang, targetLang);
  if (memoryTranslationCache.has(key)) memoryTranslationCache.delete(key);
  memoryTranslationCache.set(key, translation);
  while (memoryTranslationCache.size > MEMORY_CACHE_MAX) {
    const oldestKey = memoryTranslationCache.keys().next().value;
    if (!oldestKey) break;
    memoryTranslationCache.delete(oldestKey);
  }
}

function resetOutgoingPreTranslate(): void {
  cachedTranslation = null;
  cachedSource = null;
  preTranslatePromise = null;
  preTranslateSource = null;
  lastPreTranslateText = null;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

async function loadSettings(): Promise<void> {
  const stored = await chrome.storage.local.get([
    "translateIncoming",
    "translateOutgoing",
    "sourceLangIncoming",
    "targetLangIncoming",
    "sourceLangOutgoing",
    "targetLangOutgoing",
  ]);
  translateIncoming = stored.translateIncoming !== false;
  translateOutgoing = stored.translateOutgoing !== false;
  sourceLangIncoming = stored.sourceLangIncoming || "en";
  targetLangIncoming = stored.targetLangIncoming || "zh";
  sourceLangOutgoing = stored.sourceLangOutgoing || "zh";
  targetLangOutgoing = stored.targetLangOutgoing || "en";
}

chrome.storage.onChanged.addListener((changes) => {
  let outgoingLangChanged = false;
  if (changes.translateIncoming !== undefined)
    translateIncoming = changes.translateIncoming.newValue;
  if (changes.translateOutgoing !== undefined)
    translateOutgoing = changes.translateOutgoing.newValue;
  if (changes.sourceLangIncoming !== undefined)
    sourceLangIncoming = changes.sourceLangIncoming.newValue;
  if (changes.targetLangIncoming !== undefined)
    targetLangIncoming = changes.targetLangIncoming.newValue;
  if (changes.sourceLangOutgoing !== undefined) {
    sourceLangOutgoing = changes.sourceLangOutgoing.newValue;
    outgoingLangChanged = true;
  }
  if (changes.targetLangOutgoing !== undefined) {
    targetLangOutgoing = changes.targetLangOutgoing.newValue;
    outgoingLangChanged = true;
  }
  if (
    changes.apiProvider ||
    changes.modelSelect ||
    changes.customModel ||
    changes.customBaseUrl ||
    changes.customDictionary
  ) {
    memoryTranslationCache.clear();
    outgoingLangChanged = true;
  }
  if (outgoingLangChanged) resetOutgoingPreTranslate();
});

function sendTranslate(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<TranslateResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { text, sourceLang, targetLang },
        (response: TranslateResponse) => {
          if (chrome.runtime.lastError) {
            resolve({
              translated: "",
              error: chrome.runtime.lastError.message,
            });
          } else {
            resolve(response || { translated: "", error: "No response" });
          }
        }
      );
    } catch (err: any) {
      resolve({ translated: "", error: err.message || "sendMessage failed" });
    }
  });
}

function sendTranslateBatch(
  items: TranslateBatchItem[],
  sourceLang: string,
  targetLang: string
): Promise<TranslateBatchResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { action: "translateBatch", items, sourceLang, targetLang },
        (response: TranslateBatchResponse) => {
          if (chrome.runtime.lastError) {
            resolve({
              error: chrome.runtime.lastError.message,
              results: {},
            });
          } else {
            resolve(response || { error: "No response", results: {} });
          }
        }
      );
    } catch (err: any) {
      resolve({ error: err.message || "sendMessage failed", results: {} });
    }
  });
}
// ── Incoming: find message text elements ─────────────

function getMessageTextEls(container: Element): Element[] {
  const els = container.querySelectorAll(
    '[data-testid="selectable-text"], span.selectable-text'
  );
  return Array.from(els).filter((el) => {
    if (el.hasAttribute(TRANSLATION_ATTR) || el.hasAttribute(PENDING_ATTR))
      return false;
    const text = el.textContent?.trim();
    return text && text.length >= 2;
  });
}

function isIncomingMessage(el: Element): boolean {
  // Primary: find the enclosing msg-container and check tail direction
  const container = el.closest('[data-testid="msg-container"]');
  if (container) {
    // tail-out = outgoing, tail-in = incoming
    if (container.querySelector('[data-testid="tail-out"]')) return false;
    if (container.querySelector('[data-testid="tail-in"]')) return true;

    // Fallback: use parent's alignItems to detect direction.
    // WhatsApp renders incoming (left) with flex-start, outgoing (right) with flex-end.
    // This covers messages without tail indicators (non-last in a group).
    const parent = container.parentElement;
    if (parent) {
      const alignItems = window.getComputedStyle(parent).alignItems;
      if (alignItems === "flex-start") return true;
      if (alignItems === "flex-end") return false;
    }
  }

  // Fallback 2: check row-level msg-container
  const row = el.closest('[role="row"]');
  if (row) {
    const rc = row.querySelector('[data-testid="msg-container"]');
    if (rc) {
      if (rc.querySelector('[data-testid="tail-out"]')) return false;
      if (rc.querySelector('[data-testid="tail-in"]')) return true;
    }
  }

  // Fallback 3: legacy .message-out / .message-in classes
  if (el.closest(".message-out")) return false;
  if (el.closest(".message-in")) return true;

  // Fallback 4: check if message is in the right-aligned column (outgoing)
  const msgRow = el.closest('[role="row"]');
  if (msgRow) {
    const style = window.getComputedStyle(msgRow);
    if (style.marginLeft && parseInt(style.marginLeft) > 50) return false;
  }

  // Default to incoming if we can't determine
  return true;
}

// ── Helper utilities ─────────────────────────────────

function isProcessed(el: Element): boolean {
  return el.hasAttribute(TRANSLATION_ATTR);
}

function isPending(el: Element): boolean {
  return el.hasAttribute(PENDING_ATTR);
}

function isTranslationElPresent(parent: Element): boolean {
  return !!parent.querySelector(`.${TRANSLATION_CLASS}`);
}

function appendTranslation(originalEl: Element, translation: string): void {
  // Walk up to find a stable insertion anchor
  const copyableParent =
    originalEl.closest(".copyable-text") || originalEl.parentElement;
  if (!copyableParent) return;

  // Insert at the message-content wrapper level (sibling of text area)
  const insertTarget = copyableParent.parentElement;
  if (!insertTarget) return;

  // Remove any stale translation
  const existing = insertTarget.querySelector(`.${TRANSLATION_CLASS}`);
  if (existing) existing.remove();

  const div = document.createElement("div");
  div.className = TRANSLATION_CLASS;
  div.textContent = translation;
  div.style.cssText =
    "color:#667781;font-size:0.9em;padding:4px 0;margin-top:2px;border-top:1px solid #e0e0e0;";
  insertTarget.appendChild(div);
  originalEl.setAttribute(TRANSLATION_ATTR, "true");
  originalEl.removeAttribute(PENDING_ATTR);
  queuedIncomingEls.delete(originalEl);
  ttLog("Translation appended:", translation.substring(0, 60));
}
// ── Incoming: process messages ───────────────────────

function scheduleIncomingFlush(immediate = false): void {
  if (incomingBatchTimer) clearTimeout(incomingBatchTimer);
  incomingBatchTimer = setTimeout(
    () => {
      incomingBatchTimer = null;
      flushIncomingQueue();
    },
    immediate ? 0 : INCOMING_BATCH_DELAY_MS
  );
}

async function processIncomingGroup(items: IncomingQueueItem[]): Promise<void> {
  const pendingItems: IncomingQueueItem[] = [];

  for (const item of items) {
    const cached = getMemoryTranslation(
      item.text,
      item.sourceLang,
      item.targetLang
    );
    if (cached) {
      appendTranslation(item.el, cached);
    } else {
      pendingItems.push(item);
    }
  }

  if (!pendingItems.length) return;

  ttLog(
    "Translating incoming batch",
    pendingItems.length,
    `${pendingItems[0].sourceLang}->${pendingItems[0].targetLang}`
  );

  const response = await sendTranslateBatch(
    pendingItems.map(({ id, text }) => ({ id, text })),
    pendingItems[0].sourceLang,
    pendingItems[0].targetLang
  );

  if (response.error) {
    ttLog("Batch translation API error:", response.error);
  }

  const results = response.results || {};
  for (const item of pendingItems) {
    queuedIncomingEls.delete(item.el);
    item.el.removeAttribute(PENDING_ATTR);

    const result = results[item.id];
    if (!result || result.error || !result.translated) {
      ttLog("Translation API error:", result?.error || response.error);
      continue;
    }

    setMemoryTranslation(
      item.text,
      item.sourceLang,
      item.targetLang,
      result.translated
    );
    if (item.el.isConnected) appendTranslation(item.el, result.translated);
  }
}

async function flushIncomingQueue(): Promise<void> {
  if (!incomingQueue.length) return;
  const items = incomingQueue.splice(0, incomingQueue.length);
  const groups = new Map<string, IncomingQueueItem[]>();

  for (const item of items) {
    const key = `${item.sourceLang}\u0000${item.targetLang}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  await Promise.all(
    Array.from(groups.values()).map((group) => processIncomingGroup(group))
  );
}

function queueIncomingTranslation(textEl: Element, text: string): void {
  const cached = getMemoryTranslation(
    text,
    sourceLangIncoming,
    targetLangIncoming
  );
  if (cached) {
    appendTranslation(textEl, cached);
    return;
  }

  queuedIncomingEls.add(textEl);
  textEl.setAttribute(PENDING_ATTR, "true");
  incomingQueue.push({
    id: `m${++incomingIdCounter}`,
    el: textEl,
    text,
    sourceLang: sourceLangIncoming,
    targetLang: targetLangIncoming,
  });
  scheduleIncomingFlush(incomingQueue.length >= INCOMING_BATCH_MAX_ITEMS);
}

function processTextNode(textEl: Element): void {
  if (isProcessed(textEl) || isPending(textEl) || queuedIncomingEls.has(textEl))
    return;
  if (!isIncomingMessage(textEl)) {
    ttLog("Skipping outgoing message");
    return;
  }

  const text = textEl.textContent?.trim();
  if (!text || text.length < 2) return;

  // Check if text script matches the incoming source language
  if (!matchesLanguage(text, sourceLangIncoming)) {
    ttLog("Skipping message: script doesn't match source language", sourceLangIncoming);
    return;
  }

  // Check if translation already present at insertion level
  const copyableParent =
    textEl.closest(".copyable-text") || textEl.parentElement;
  const insertTarget = copyableParent?.parentElement;
  if (insertTarget && isTranslationElPresent(insertTarget)) return;

  queueIncomingTranslation(textEl, text);
}

function processNewNodes(nodes: NodeList): void {
  for (const node of Array.from(nodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;

    // Find new message text elements in the added subtree
    const textEls = getMessageTextEls(el);

    // Also check if the node itself is a selectable-text
    if (
      (el.matches?.('[data-testid="selectable-text"]') ||
        el.matches?.("span.selectable-text")) &&
      !el.hasAttribute(TRANSLATION_ATTR)
    ) {
      const text = el.textContent?.trim();
      if (text && text.length >= 2) {
        textEls.push(el);
      }
    }

    // Deduplicate
    const seen = new Set<Element>();
    for (const textEl of textEls) {
      if (seen.has(textEl)) continue;
      seen.add(textEl);
      processTextNode(textEl);
    }
  }
}
// ── Outgoing: input helpers ──────────────────────────

function getInputText(input: HTMLElement): string {
  return input.innerText?.trim() || input.textContent?.trim() || "";
}

function setInputText(input: HTMLElement, text: string): boolean {
  input.focus();

  // Use InputEvent "beforeinput" — the only method Lexical reliably responds to.
  // Lexical processes these asynchronously, so we cannot verify via innerText
  // immediately after dispatching. We trust the event pipeline.

  // Step 1: Select all content
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(input);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Step 2: Delete selected content via beforeinput
  input.dispatchEvent(
    new InputEvent("beforeinput", {
      inputType: "deleteContentBackward",
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );

  // Step 3: Insert new text via beforeinput
  input.dispatchEvent(
    new InputEvent("beforeinput", {
      inputType: "insertText",
      data: text,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );

  ttLog("setText via beforeinput dispatched (async)");
  return true;
}

function fireEnterOn(el: HTMLElement): void {
  const enterDown = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  });
  const enterUp = new KeyboardEvent("keyup", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(enterDown);
  el.dispatchEvent(enterUp);
}

// ── Outgoing: translation handler ────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Translation timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function requestOutgoingTranslation(text: string): Promise<TranslateResponse> {
  const cached = getMemoryTranslation(
    text,
    sourceLangOutgoing,
    targetLangOutgoing
  );
  if (cached) {
    cachedSource = text;
    cachedTranslation = cached;
    return Promise.resolve({ translated: cached });
  }

  if (preTranslateSource === text && preTranslatePromise) {
    return preTranslatePromise;
  }

  preTranslateSource = text;
  const promise = sendTranslate(text, sourceLangOutgoing, targetLangOutgoing)
    .then((response) => {
      if (!response.error && response.translated) {
        cachedSource = text;
        cachedTranslation = response.translated;
        setMemoryTranslation(
          text,
          sourceLangOutgoing,
          targetLangOutgoing,
          response.translated
        );
      }
      return response;
    })
    .finally(() => {
      if (preTranslatePromise === promise) preTranslatePromise = null;
    });

  preTranslatePromise = promise;
  return promise;
}

async function handleOutgoingTranslation(input: HTMLElement): Promise<boolean> {
  const text = getInputText(input);
  if (!text) return false;

  // Check if text script matches the outgoing source language
  if (!matchesLanguage(text, sourceLangOutgoing)) return false;

  ttLog("Translating outgoing", sourceLangOutgoing, "→", targetLangOutgoing, ":", text.substring(0, 40));

  try {
    let translated: string;

    // Use cached translation if it matches exactly
    if (cachedTranslation && cachedSource === text) {
      translated = cachedTranslation;
      ttLog("Using cached translation");
    } else {
      const TRANSLATE_TIMEOUT_MS = 10000;
      const response = await withTimeout(
        requestOutgoingTranslation(text),
        TRANSLATE_TIMEOUT_MS
      );
      if (response.error || !response.translated) {
        ttLog("Translation failed:", response.error);
        return false;
      }
      translated = response.translated;
    }

    // Replace the input text with the translation using beforeinput events
    // Lexical processes these asynchronously, so we wait for it to settle
    setInputText(input, translated);

    // Give Lexical time to process the beforeinput events and update DOM
    await new Promise((resolve) => setTimeout(resolve, 100));

    ttLog("Outgoing translation dispatched:", translated.substring(0, 40));
    return true;
  } catch (err) {
    ttLog("Outgoing translation error:", err);
    return false;
  } finally {
    // Clear any pending pre-translation debounce to prevent stale requests
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    // Give enough time for WhatsApp to process, then allow next send
    setTimeout(() => {
      isProcessingSend = false;
    }, 200);
  }
}
// ── Outgoing: find chat input ────────────────────────

function findChatInput(): HTMLElement | null {
  return (
    document.querySelector(
      '[data-testid="conversation-compose-box-input"]'
    ) ??
    document.querySelector(
      '#main div[contenteditable="true"][role="textbox"]'
    ) ??
    document.querySelector('footer div[contenteditable="true"]') ??
    document.querySelector('div[contenteditable="true"]') ??
    null
  ) as HTMLElement | null;
}

// ── Outgoing: find send button ───────────────────────

function findSendButton(): HTMLElement | null {
  return (
    // WhatsApp currently uses a span with data-testid="wds-ic-send-filled"
    // inside the send button, and the button itself has aria-label="发送"/"Send"
    document.querySelector('#main button[aria-label="\u53d1\u9001"]') ??
    document.querySelector('#main button[aria-label="Send"]') ??
    document.querySelector('button[aria-label="\u53d1\u9001"]') ??
    document.querySelector('button[aria-label="Send"]') ??
    // Legacy: data-testid="send"
    document.querySelector('[data-testid="send"]') ??
    null
  ) as HTMLElement | null;
}

// ── Outgoing: pre-translation cache ──────────────────

function debouncedPreTranslate(input: HTMLElement): void {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(async () => {
    if (isComposing) return;
    const text = getInputText(input);
    if (!text || !matchesLanguage(text, sourceLangOutgoing)) {
      resetOutgoingPreTranslate();
      return;
    }
    const cached = getMemoryTranslation(
      text,
      sourceLangOutgoing,
      targetLangOutgoing
    );
    if (cached) {
      cachedSource = text;
      cachedTranslation = cached;
      return;
    }
    if (cachedSource === text || (preTranslateSource === text && preTranslatePromise)) {
      return;
    }

    lastPreTranslateText = text;
    try {
      const response = await requestOutgoingTranslation(text);
      if (!response.error && response.translated) {
        ttLog("Pre-cached for:", text.substring(0, 30));
      }
    } catch {
      preTranslateSource = null;
    }
  }, DEBOUNCE_MS);
}

// ── Outgoing: setup handlers ─────────────────────────

function setupOutgoingHandler(): void {
  const input = findChatInput();
  if (!input) return;
  // Use WeakSet to prevent duplicate bindings on the same DOM element
  if (boundInputs.has(input)) return;
  boundInputs.add(input);

  ttLog("Bound outgoing handler to input");

  input.addEventListener(
    "compositionstart",
    () => {
      isComposing = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
    { passive: true }
  );

  input.addEventListener(
    "compositionend",
    () => {
      isComposing = false;
      if (!translateOutgoing || isProcessingSend) return;
      debouncedPreTranslate(input);
    },
    { passive: true }
  );

  // Debounced pre-translation while typing
  input.addEventListener(
    "input",
    () => {
      if (!translateOutgoing || isProcessingSend || isComposing) return;
      debouncedPreTranslate(input);
    },
    { passive: true }
  );

  // Intercept Enter key (send) — using capture phase
  input.addEventListener(
    "keydown",
    async (e) => {
      if (!translateOutgoing || isProcessingSend) return;
      if (isComposing) return;
      if (e.key !== "Enter" || e.shiftKey) return;

      const text = getInputText(input);
      if (!matchesLanguage(text, sourceLangOutgoing)) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      isProcessingSend = true;

      const ok = await handleOutgoingTranslation(input);
      if (ok) {
        setTimeout(() => fireEnterOn(input), 50);
      } else {
        isProcessingSend = false;
        fireEnterOn(input);
      }
    },
    { capture: true }
  );
}

function setupSendButtonHandler(): void {
  const sendBtn = findSendButton();
  if (!sendBtn) return;
  if (sendBtn.hasAttribute("data-tt-bound")) return;
  sendBtn.setAttribute("data-tt-bound", "true");

  ttLog("Bound send button handler");

  sendBtn.addEventListener(
    "mousedown",
    async (e) => {
      if (!translateOutgoing) return;
      if (isProcessingSend) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      const input = findChatInput();
      if (!input) return;

      const text = getInputText(input);
      if (!matchesLanguage(text, sourceLangOutgoing)) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      isProcessingSend = true;

      ttLog("Intercepting send button, translating...");
      const ok = await handleOutgoingTranslation(input);
      if (ok) {
        setTimeout(() => sendBtn.click(), 500);
      } else {
        ttLog("Translation failed, sending original");
        isProcessingSend = false;
        setTimeout(() => sendBtn.click(), 100);
      }
    },
    { capture: true }
  );
}
// ── Observers ────────────────────────────────────────

function setupMessageObserver(): void {
  const target =
    document.querySelector(
      '[data-testid="conversation-panel-messages"]'
    ) ??
    document.querySelector("#main") ??
    document.body;

  if (target.hasAttribute("data-tt-observed")) return;
  target.setAttribute("data-tt-observed", "true");

  ttLog("Message observer attached to", target.tagName);

  const observer = new MutationObserver((mutations) => {
    if (!translateIncoming) return;
    for (const m of mutations) {
      if (m.addedNodes.length) processNewNodes(m.addedNodes);
    }
  });

  observer.observe(target, { childList: true, subtree: true });
}

function setupNavigationObserver(): void {
  const observer = new MutationObserver(() => {
    const input = findChatInput();
    if (input && !boundInputs.has(input)) {
      setupOutgoingHandler();
      setupSendButtonHandler();
    }
    const target =
      document.querySelector(
        '[data-testid="conversation-panel-messages"]'
      ) ?? document.querySelector("#main");
    if (target && !target.hasAttribute("data-tt-observed")) {
      setupMessageObserver();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function rebindAll(): void {
  setupOutgoingHandler();
  setupSendButtonHandler();
  setupMessageObserver();
}

// ── Init ─────────────────────────────────────────────

async function init(): Promise<void> {
  await loadSettings();
  ttLog("TradeTranslate content script initializing");
  rebindAll();
  setupNavigationObserver();

  // Retry for SPA bootstrapping
  let retries = 0;
  const retryInterval = setInterval(() => {
    retries++;
    rebindAll();
    if (retries >= 20) clearInterval(retryInterval);
  }, 500);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

