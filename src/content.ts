// TradeTranslate content script for WhatsApp Web
//   Incoming: auto-translate EN → ZH, append below original
//   Outgoing: intercept ZH → EN replacement before send

// ── Types ──────────────────────────────────────────
interface TranslateResponse {
  translated: string;
  error?: string;
}

// ── Configuration ──────────────────────────────────
const DEBOUNCE_MS = 600;
const TRANSLATION_ATTR = "data-tt-done";
const TRANSLATION_CLASS = "tt-translation";

// ── Mutable state ──────────────────────────────────
let translateIncoming = true;
let translateOutgoing = true;
let cachedTranslation: string | null = null;
let cachedSource: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let isProcessingSend = false;

// ── Helpers ────────────────────────────────────────

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

function isEnglishDominant(text: string): boolean {
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  if (cjkChars === 0) return latinChars > 0;
  // Allow small CJK fragments in otherwise-English messages
  return cjkChars / text.length < 0.2 && latinChars > cjkChars;
}

async function loadSettings(): Promise<void> {
  const stored = await chrome.storage.local.get([
    "translateIncoming",
    "translateOutgoing",
  ]);
  translateIncoming = stored.translateIncoming !== false;
  translateOutgoing = stored.translateOutgoing !== false;
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.translateIncoming !== undefined)
    translateIncoming = changes.translateIncoming.newValue;
  if (changes.translateOutgoing !== undefined)
    translateOutgoing = changes.translateOutgoing.newValue;
});

function sendTranslate(
  text: string,
  direction: "en2zh" | "zh2en"
): Promise<TranslateResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { text, direction },
      (response: TranslateResponse) => {
        if (chrome.runtime.lastError) {
          resolve({ translated: "", error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { translated: "", error: "No response" });
        }
      }
    );
  });
}

// ── Incoming: find message text elements ──────────

function getMessageTextEls(container: Element): Element[] {
  const els = container.querySelectorAll("span.selectable-text");
  return Array.from(els).filter((el) => {
    if (el.hasAttribute(TRANSLATION_ATTR)) return false;
    const text = el.textContent?.trim();
    return text && text.length >= 2;
  });
}

function isIncomingMessage(el: Element): boolean {
  // Strategy 1: incoming messages carry data-pre-plain-text (sender + timestamp)
  if (el.closest("[data-pre-plain-text]")) return true;

  // Strategy 2: outgoing messages have .message-out ancestor
  const row = el.closest('[role="row"]');
  if (row) {
    if (row.querySelector(".message-out")) return false;
    // If there's a message-in class, definitely incoming
    if (row.querySelector(".message-in")) return true;
  }

  // Strategy 3: check for message-out class anywhere in the ancestor chain
  const bubble = el.closest('[class*="message"]');
  if (bubble) return !bubble.className.includes("message-out");

  return false;
}

function isTranslationElPresent(copyableParent: Element): boolean {
  return (
    copyableParent.parentElement?.querySelector(`.${TRANSLATION_CLASS}`) !==
    null
  );
}

function appendTranslation(originalEl: Element, translation: string): void {
  const copyableParent =
    originalEl.closest(".copyable-text") || originalEl.parentElement;
  if (!copyableParent) return;

  // Remove any stale translation
  const existing =
    copyableParent.parentElement?.querySelector(`.${TRANSLATION_CLASS}`);
  if (existing) existing.remove();

  const div = document.createElement("div");
  div.className = TRANSLATION_CLASS;
  div.textContent = translation;
  div.setAttribute("dir", "auto");
  div.style.cssText =
    "font-size:0.82em;color:#8696a0;font-style:italic;margin-top:3px;" +
    "padding:2px 0;line-height:1.4;user-select:text;";

  copyableParent.insertAdjacentElement("afterend", div);
}

async function translateMessage(el: Element): Promise<void> {
  const text = el.textContent?.trim();
  if (!text || text.length < 2) return;
  if (!isEnglishDominant(text)) return;

  el.setAttribute(TRANSLATION_ATTR, "true");

  try {
    const response = await sendTranslate(text, "en2zh");
    if (response.error || !response.translated) return;
    appendTranslation(el, response.translated);
  } catch {
    el.removeAttribute(TRANSLATION_ATTR);
  }
}

function processNewNodes(nodes: NodeList): void {
  for (const node of nodes) {
    if (!(node instanceof Element)) continue;
    const textEls = getMessageTextEls(node);
    for (const el of textEls) {
      if (isIncomingMessage(el)) translateMessage(el);
    }
  }
}

// ── Outgoing: input helpers ────────────────────────

function findChatInput(): HTMLElement | null {
  return (
    (document.querySelector(
      '#main div[contenteditable="true"][role="textbox"]'
    ) as HTMLElement | null) ??
    (document.querySelector(
      'footer div[contenteditable="true"]'
    ) as HTMLElement | null) ??
    (document.querySelector(
      "#main div[contenteditable]"
    ) as HTMLElement | null)
  );
}

function findSendButton(): HTMLElement | null {
  return (
    (document.querySelector(
      'button[aria-label="Send"]'
    ) as HTMLElement | null) ??
    ((document.querySelector('span[data-icon="send"]') as HTMLElement | null)
      ?.closest("button") as HTMLElement | null)
  );
}

function getInputText(input: HTMLElement): string {
  return input.innerText?.trim() || "";
}

function setInputText(input: HTMLElement, text: string): void {
  input.textContent = text;

  // Place cursor at end
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Notify WhatsApp that the input changed
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText" })
  );
}

function fireEnterOn(input: HTMLElement): void {
  const opts = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  input.dispatchEvent(new KeyboardEvent("keydown", opts));
  input.dispatchEvent(new KeyboardEvent("keypress", opts));
  input.dispatchEvent(new KeyboardEvent("keyup", opts));
}

// ── Outgoing: translation flow ────────────────────

async function handleOutgoingTranslation(
  input: HTMLElement
): Promise<boolean> {
  const text = getInputText(input);
  if (!text || !hasChinese(text)) return false;

  isProcessingSend = true;

  try {
    let translated: string;
    if (cachedTranslation && cachedSource === text) {
      translated = cachedTranslation;
    } else {
      const response = await sendTranslate(text, "zh2en");
      if (response.error || !response.translated) return false;
      translated = response.translated;
    }

    setInputText(input, translated);
    cachedTranslation = null;
    cachedSource = null;
    return true;
  } catch {
    return false;
  } finally {
    setTimeout(() => {
      isProcessingSend = false;
    }, 150);
  }
}

function debouncedPreTranslate(input: HTMLElement): void {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(async () => {
    const text = getInputText(input);
    if (!text || !hasChinese(text)) {
      cachedTranslation = null;
      cachedSource = null;
      return;
    }
    try {
      const response = await sendTranslate(text, "zh2en");
      if (!response.error && response.translated) {
        cachedTranslation = response.translated;
        cachedSource = text;
      }
    } catch {
      // non-critical — will re-fetch on send
    }
  }, DEBOUNCE_MS);
}

// ── Outgoing: event binding ────────────────────────

function setupOutgoingHandler(): void {
  const input = findChatInput();
  if (!input) return;
  if (input.hasAttribute("data-tt-bound")) return;
  input.setAttribute("data-tt-bound", "true");

  // Debounced pre-translation while typing
  input.addEventListener(
    "input",
    () => {
      if (!translateOutgoing) return;
      debouncedPreTranslate(input);
    },
    { passive: true }
  );

  // Intercept Enter key (send)
  input.addEventListener(
    "keydown",
    async (e) => {
      if (!translateOutgoing || isProcessingSend) return;
      if (e.key !== "Enter" || e.shiftKey) return;

      const text = getInputText(input);
      if (!hasChinese(text)) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      const ok = await handleOutgoingTranslation(input);
      if (ok) {
        setTimeout(() => fireEnterOn(input), 50);
      } else {
        // Translation failed — let the original text through
        isProcessingSend = false;
        fireEnterOn(input);
      }
    },
    { capture: true }
  );
}

function setupSendButtonHandler(): void {
  const sendBtn = findSendButton();
  if (!sendBtn || sendBtn.hasAttribute("data-tt-bound")) return;
  sendBtn.setAttribute("data-tt-bound", "true");

  sendBtn.addEventListener(
    "mousedown",
    async (e) => {
      if (!translateOutgoing || isProcessingSend) return;

      const input = findChatInput();
      if (!input) return;

      const text = getInputText(input);
      if (!hasChinese(text)) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      const ok = await handleOutgoingTranslation(input);
      if (ok) {
        setTimeout(() => sendBtn.click(), 50);
      } else {
        isProcessingSend = false;
        setTimeout(() => sendBtn.click(), 50);
      }
    },
    { capture: true }
  );
}

// ── Observers ──────────────────────────────────────

function setupMessageObserver(): void {
  const target =
    document.querySelector("#main") ??
    document.querySelector('[data-testid="conversation-panel-messages"]') ??
    document.body;

  if (target.hasAttribute("data-tt-observed")) return;
  target.setAttribute("data-tt-observed", "true");

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
    if (input && !input.hasAttribute("data-tt-bound")) {
      setupOutgoingHandler();
      setupSendButtonHandler();
    }
    const target = document.querySelector("#main");
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

// ── Init ───────────────────────────────────────────

async function init(): Promise<void> {
  await loadSettings();
  rebindAll();
  setupNavigationObserver();

  // Retry for SPA bootstrapping
  let retries = 0;
  const retryInterval = setInterval(() => {
    retries++;
    rebindAll();
    if (retries >= 10) clearInterval(retryInterval);
  }, 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
