// TradeTranslate content script for WhatsApp Web
//   Incoming: auto-translate EN ¡ú ZH, append below original
//   Outgoing: intercept ZH ¡ú EN replacement before send

// ©¤©¤ Types ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤
interface TranslateResponse {
  translated: string;
  error?: string;
}

// ©¤©¤ Configuration ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤
const DEBOUNCE_MS = 1000;
const TRANSLATION_ATTR = "data-tt-done";
const TRANSLATION_CLASS = "tt-translation";
const __TT_DEBUG__ = true;
function ttLog(...args: unknown[]): void {
  if (__TT_DEBUG__) console.debug("[TradeTranslate]", ...args);
}

// ©¤©¤ Mutable state ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤
let translateIncoming = true;
let translateOutgoing = true;
let cachedTranslation: string | null = null;
let cachedSource: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let isProcessingSend = false;

// Track bound input elements to prevent duplicate bindings
const boundInputs = new WeakSet<HTMLElement>();

// ©¤©¤ Helpers ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

function isEnglishDominant(text: string): boolean {
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  // No CJK at all ¡ú English
  if (cjkChars === 0) return latinChars > 0;
  // Has CJK but mostly Latin
  return cjkChars / text.length < 0.2 && latinChars > cjkChars;
}

function isEnglish(text: string): boolean {
  // Simple check: has Latin letters and no CJK
  return /[a-zA-Z]/.test(text) && !hasChinese(text);
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
    try {
      chrome.runtime.sendMessage(
        { text, direction },
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

// ©¤©¤ Incoming: find message text elements ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤

function getMessageTextEls(container: Element): Element[] {
  const els = container.querySelectorAll(
    '[data-testid="selectable-text"], span.selectable-text'
  );
  return Array.from(els).filter((el) => {
    if (el.hasAttribute(TRANSLATION_ATTR)) return false;
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

  return false;
}

function isTranslationElPresent(insertTarget: Element): boolean {
  return insertTarget.querySelector(`.${TRANSLATION_CLASS}`) !== null;
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
  ttLog("Translation appended:", translation.substring(0, 60));
}

// ©¤©¤ Incoming: mutation processing ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤

function isProcessed(el: Element): boolean {
  return (
    el.hasAttribute(TRANSLATION_ATTR) ||
    el.closest(`[${TRANSLATION_ATTR}]`) !== null
  );
}

async function processTextNode(textEl: Element): Promise<void> {
  if (isProcessed(textEl)) return;
  if (!isIncomingMessage(textEl)) {
    ttLog("Skipping outgoing message");
    return;
  }

  const text = textEl.textContent?.trim();
  if (!text || text.length < 2) return;

  // Check if it looks like English (no Chinese chars, has Latin chars)
  if (!isEnglish(text)) {
    ttLog("Skipping non-English message:", text.substring(0, 30));
    return;
  }

  // Check if translation already present at insertion level
  const copyableParent =
    textEl.closest(".copyable-text") || textEl.parentElement;
  const insertTarget = copyableParent?.parentElement;
  if (insertTarget && isTranslationElPresent(insertTarget)) return;

  ttLog("Translating incoming EN¡úZH:", text.substring(0, 40));

  try {
    const response = await sendTranslate(text, "en2zh");
    if (!response.error && response.translated) {
      appendTranslation(textEl, response.translated);
    } else {
      ttLog("Translation API error:", response.error);
    }
  } catch (err) {
    ttLog("Translation exception:", err);
  }
}

async function processNewNodes(nodes: NodeList): Promise<void> {
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
      await processTextNode(textEl);
    }
  }
}

// ©¤©¤ Outgoing: input helpers ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤

function getInputText(input: HTMLElement): string {
  return input.innerText?.trim() || input.textContent?.trim() || "";
}

function setInputText(input: HTMLElement, text: string): boolean {
  input.focus();

  // Select all existing content
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(input);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Method 1: execCommand insertText ¡ª works in most contenteditable editors
  // This is the classic way and triggers input events in many editors.
  document.execCommand("selectAll");
  document.execCommand("insertText", false, text);

  let current = input.innerText?.trim() || input.textContent?.trim() || "";
  if (current === text) {
    ttLog("setText via execCommand succeeded");
    return true;
  }

  // Method 2: ClipboardEvent paste ¡ª Lexical handles paste natively
  ttLog("execCommand failed, trying paste event");
  input.focus();
  const sel2 = window.getSelection();
  if (sel2) {
    const range2 = document.createRange();
    range2.selectNodeContents(input);
    sel2.removeAllRanges();
    sel2.addRange(range2);
  }
  try {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    input.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
        composed: true,
      })
    );
  } catch {
    // DataTransfer may not be available in all contexts
    ttLog("DataTransfer not available, skipping paste method");
  }

  current = input.innerText?.trim() || input.textContent?.trim() || "";
  if (current === text) {
    ttLog("setText via paste succeeded");
    return true;
  }

  // Method 3: beforeinput insertText event
  ttLog("Paste failed, trying beforeinput event");
  input.focus();
  input.dispatchEvent(
    new InputEvent("beforeinput", {
      inputType: "insertText",
      data: text,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );

  current = input.innerText?.trim() || input.textContent?.trim() || "";
  if (current === text) {
    ttLog("setText via beforeinput succeeded");
    return true;
  }

  // Method 4: Direct DOM update ¡ª last resort, may not update Lexical state
  ttLog("All input methods failed, using direct DOM update");
  const p = input.querySelector("p");
  if (p) {
    p.textContent = "";
    const span = document.createElement("span");
    span.setAttribute("data-lexical-text", "true");
    span.textContent = text;
    p.appendChild(span);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return false;
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

// ©¤©¤ Outgoing: translation handler ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤

async function handleOutgoingTranslation(
  input: HTMLElement
): Promise<boolean> {
  const text = getInputText(input);
  if (!text || !hasChinese(text)) return false;

  ttLog("Translating outgoing ZH¡úEN:", text.substring(0, 40));

  try {
    let translated: string;

    // Use cached translation if it matches exactly
    if (cachedTranslation && cachedSource === text) {
      translated = cachedTranslation;
      ttLog("Using cached translation");
    } else {
      // Add a timeout wrapper ¡ª if API takes too long, fall back to sending original
      const TRANSLATE_TIMEOUT_MS = 15000;
      const response = await Promise.race([
        sendTranslate(text, "zh2en"),
        new Promise<TranslateResponse>((_, reject) =>
          setTimeout(() => reject(new Error("Translation timeout")), TRANSLATE_TIMEOUT_MS)
        ),
      ]);
      if (response.error || !response.translated) {
        ttLog("Translation failed:", response.error);
        return false;
      }
      translated = response.translated;
    }

    // Replace the input text with the translation
    const replaced = setInputText(input, translated);

    // Wait for WhatsApp to process the text change
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify the text was actually replaced
    const currentText = input.innerText?.trim() || input.textContent?.trim() || "";
    if (currentText !== translated) {
      ttLog("WARNING: Text replacement may have failed. Expected:", translated.substring(0, 30), "Got:", currentText.substring(0, 30));
    }

    ttLog("Outgoing translation applied:", translated.substring(0, 40), "replaced:", replaced);
    return true;
  } catch (err) {
    ttLog("Outgoing translation error:", err);
    return false;
  } finally {
    // Give enough time for WhatsApp to process, then allow next send
    setTimeout(() => {
      isProcessingSend = false;
    }, 500);
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
        ttLog("Pre-cached translation for:", text.substring(0, 30));
      }
    } catch {
      // non-critical ¡ª will re-fetch on send
    }
  }, DEBOUNCE_MS);
}

// ©¤©¤ Outgoing: event binding ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤

function setupOutgoingHandler(): void {
  const input = findChatInput();
  if (!input) return;
  // Use WeakSet to prevent duplicate bindings on the same DOM element
  if (boundInputs.has(input)) return;
  boundInputs.add(input);

  ttLog("Bound outgoing handler to input");

  // Debounced pre-translation while typing
  input.addEventListener(
    "input",
    () => {
      if (!translateOutgoing) return;
      debouncedPreTranslate(input);
    },
    { passive: true }
  );

  // Intercept Enter key (send) ¡ª using capture phase
  input.addEventListener(
    "keydown",
    async (e) => {
      if (!translateOutgoing || isProcessingSend) return;
      if (e.key !== "Enter" || e.shiftKey) return;

      const text = getInputText(input);
      if (!hasChinese(text)) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      isProcessingSend = true;

      const ok = await handleOutgoingTranslation(input);
      if (ok) {
        setTimeout(() => fireEnterOn(input), 80);
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
      if (!hasChinese(text)) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      isProcessingSend = true;

      ttLog("Intercepting send button, translating...");
      const ok = await handleOutgoingTranslation(input);
      if (ok) {
        setTimeout(() => sendBtn.click(), 150);
      } else {
        ttLog("Translation failed, sending original");
        isProcessingSend = false;
        setTimeout(() => sendBtn.click(), 100);
      }
    },
    { capture: true }
  );
}

// ©¤©¤ Outgoing: find chat input ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤

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

// ©¤©¤ Outgoing: find send button ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤

function findSendButton(): HTMLElement | null {
  return (
    // WhatsApp currently uses a span with data-testid="wds-ic-send-filled"
    // inside the send button, and the button itself has aria-label="·¢ËÍ"/"Send"
    document.querySelector('#main button[aria-label="\u53d1\u9001"]') ??
    document.querySelector('#main button[aria-label="Send"]') ??
    document.querySelector('button[aria-label="\u53d1\u9001"]') ??
    document.querySelector('button[aria-label="Send"]') ??
    // Legacy: data-testid="send"
    document.querySelector('[data-testid="send"]') ??
    null
  ) as HTMLElement | null;
}

// ©¤©¤ Observers ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤

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

// ©¤©¤ Init ©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤©¤

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
    if (retries >= 10) clearInterval(retryInterval);
  }, 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}