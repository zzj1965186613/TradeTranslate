const DEBOUNCE_MS = 600;
const TRANSLATION_ATTR = "data-tt-done";
const TRANSLATION_CLASS = "tt-translation";
let translateIncoming = true;
let translateOutgoing = true;
let cachedTranslation = null;
let cachedSource = null;
let debounceTimer = null;
let isProcessingSend = false;
function hasChinese(text) {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}
function isEnglishDominant(text) {
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  if (cjkChars === 0) return latinChars > 0;
  return cjkChars / text.length < 0.2 && latinChars > cjkChars;
}
async function loadSettings() {
  const stored = await chrome.storage.local.get([
    "translateIncoming",
    "translateOutgoing"
  ]);
  translateIncoming = stored.translateIncoming !== false;
  translateOutgoing = stored.translateOutgoing !== false;
}
chrome.storage.onChanged.addListener((changes) => {
  if (changes.translateIncoming !== void 0)
    translateIncoming = changes.translateIncoming.newValue;
  if (changes.translateOutgoing !== void 0)
    translateOutgoing = changes.translateOutgoing.newValue;
});
function sendTranslate(text, direction) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { text, direction },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ translated: "", error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { translated: "", error: "No response" });
        }
      }
    );
  });
}
function getMessageTextEls(container) {
  const els = container.querySelectorAll("span.selectable-text");
  return Array.from(els).filter((el) => {
    if (el.hasAttribute(TRANSLATION_ATTR)) return false;
    const text = el.textContent?.trim();
    return text && text.length >= 2;
  });
}
function isIncomingMessage(el) {
  if (el.closest("[data-pre-plain-text]")) return true;
  const row = el.closest('[role="row"]');
  if (row) {
    if (row.querySelector(".message-out")) return false;
    if (row.querySelector(".message-in")) return true;
  }
  const bubble = el.closest('[class*="message"]');
  if (bubble) return !bubble.className.includes("message-out");
  return false;
}
function appendTranslation(originalEl, translation) {
  const copyableParent = originalEl.closest(".copyable-text") || originalEl.parentElement;
  if (!copyableParent) return;
  const existing = copyableParent.parentElement?.querySelector(`.${TRANSLATION_CLASS}`);
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.className = TRANSLATION_CLASS;
  div.textContent = translation;
  div.setAttribute("dir", "auto");
  div.style.cssText = "font-size:0.82em;color:#8696a0;font-style:italic;margin-top:3px;padding:2px 0;line-height:1.4;user-select:text;";
  copyableParent.insertAdjacentElement("afterend", div);
}
async function translateMessage(el) {
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
function processNewNodes(nodes) {
  for (const node of nodes) {
    if (!(node instanceof Element)) continue;
    const textEls = getMessageTextEls(node);
    for (const el of textEls) {
      if (isIncomingMessage(el)) translateMessage(el);
    }
  }
}
function findChatInput() {
  return document.querySelector(
    '#main div[contenteditable="true"][role="textbox"]'
  ) ?? document.querySelector(
    'footer div[contenteditable="true"]'
  ) ?? document.querySelector(
    "#main div[contenteditable]"
  );
}
function findSendButton() {
  return document.querySelector(
    'button[aria-label="Send"]'
  ) ?? document.querySelector('span[data-icon="send"]')?.closest("button");
}
function getInputText(input) {
  return input.innerText?.trim() || "";
}
function setInputText(input, text) {
  input.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText" })
  );
}
function fireEnterOn(input) {
  const opts = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true
  };
  input.dispatchEvent(new KeyboardEvent("keydown", opts));
  input.dispatchEvent(new KeyboardEvent("keypress", opts));
  input.dispatchEvent(new KeyboardEvent("keyup", opts));
}
async function handleOutgoingTranslation(input) {
  const text = getInputText(input);
  if (!text || !hasChinese(text)) return false;
  isProcessingSend = true;
  try {
    let translated;
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
function debouncedPreTranslate(input) {
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
    }
  }, DEBOUNCE_MS);
}
function setupOutgoingHandler() {
  const input = findChatInput();
  if (!input) return;
  if (input.hasAttribute("data-tt-bound")) return;
  input.setAttribute("data-tt-bound", "true");
  input.addEventListener(
    "input",
    () => {
      if (!translateOutgoing) return;
      debouncedPreTranslate(input);
    },
    { passive: true }
  );
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
        isProcessingSend = false;
        fireEnterOn(input);
      }
    },
    { capture: true }
  );
}
function setupSendButtonHandler() {
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
function setupMessageObserver() {
  const target = document.querySelector("#main") ?? document.querySelector('[data-testid="conversation-panel-messages"]') ?? document.body;
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
function setupNavigationObserver() {
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
function rebindAll() {
  setupOutgoingHandler();
  setupSendButtonHandler();
  setupMessageObserver();
}
async function init() {
  await loadSettings();
  rebindAll();
  setupNavigationObserver();
  let retries = 0;
  const retryInterval = setInterval(() => {
    retries++;
    rebindAll();
    if (retries >= 10) clearInterval(retryInterval);
  }, 1e3);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
