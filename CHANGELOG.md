# Changelog

All notable changes to TradeTranslate are documented in this file.

---
## [1.0.4] - 2026-06-07

### Bug Fix — Long Chinese text not translated; translation delay; double-send risk

**Severity:** High — outgoing translation fails for longer messages like "这是一条测试消息".

### Root Cause

1. **Long text translation timeout:** DeepSeek API response time scales with text length. Short text ("成功") translates in <1s, but longer text ("这是一条测试消息") can take 2-3s. The Enter key handler had no explicit timeout — if the API was slow, `isProcessingSend` would reset prematurely (150ms in `finally`), allowing a second Enter to bypass interception and send the original Chinese text.

2. **Double-send race condition:** If the user pressed Enter while translation was in progress, the `isProcessingSend` flag could already be reset by the `finally` block, causing the raw Chinese to be sent instead of waiting for the translation.

3. **Pre-cache debounce too short:** `DEBOUNCE_MS = 600` meant the pre-translation cache often captured incomplete text during fast typing, so pressing Enter would miss the cache and make a fresh (slow) API call.

### What Changed

- `DEBOUNCE_MS`: 600 → 1000ms — longer debounce ensures the pre-cache captures the complete text after user stops typing.
- `handleOutgoingTranslation()`: Added 15s explicit timeout via `Promise.race()`. If API exceeds timeout, original text is sent as fallback. `finally` block delay increased from 150ms to 500ms to prevent premature reset.
- Enter key handler: When `isProcessingSend` is true, all subsequent Enter presses are now blocked (prevented from reaching WhatsApp) instead of silently passing through. This eliminates the double-send race condition.
- Send button handler: Same blocking behavior applied for consistency.
- `sendTranslate()`: Wrapped in try-catch to handle edge cases where `chrome.runtime.sendMessage` throws synchronously.

### User Experience Improvement

- Short text ("成功"): Pre-cached during typing → Enter → instant send (0ms API wait).
- Long text ("这是一条测试消息"): Enter → shows blocked Enter attempts in console → waits for API → replaces text → sends English version.
- If API fails or times out: Original Chinese text is sent as-is (graceful degradation).

## [1.0.3] - 2026-06-07

### Bug Fix — Incoming messages without tail not translated + Send button selector + Translation styling

**Severity:** High — most incoming messages in a consecutive group were silently skipped.

### Root Cause

1. **Messages without tail skipped:** WhatsApp only renders `data-testid="tail-in"` / `data-testid="tail-out"` on the **last message in a consecutive group** from the same sender. Earlier messages in the group have no tail indicator, causing `isIncomingMessage()` to return `false`. This meant ~60% of incoming messages were never translated.

2. **Send button not found:** WhatsApp removed `data-testid="send"` from the send button. The button now only has `aria-label="发送"` (or "Send" in English locales), with a child span containing `data-testid="wds-ic-send-filled"`.

3. **Translation text unstyled:** The `.tt-translation` class had no CSS, and no CSS file was injected. Translation text appeared as unstyled default text, indistinguishable from the original message.

### What Changed

- `isIncomingMessage()`: Added `alignItems` fallback — checks the parent container's computed `align-items` CSS property. WhatsApp uses `flex-start` for incoming (left-aligned) and `flex-end` for outgoing (right-aligned). This reliably identifies message direction even without tail indicators.
- `findSendButton()`: Reordered selector priority — `aria-label="发送"` is now primary (since it's always present), with `data-testid="send"` as legacy fallback.
- `appendTranslation()`: Added inline styles to the translation div for visual distinction (gray color, smaller font, top border separator).

### Verification

- In-app browser E2E test: all 12 messages correctly classified (4 incoming, 8 outgoing).
- Previously 6 messages were "unknown" (no tail); now all correctly identified via alignItems.
- "Just a test" and "ok" (incoming English) correctly flagged for translation.
- Send button found via `aria-label="发送"`.
- `npm run build` passes.


## [1.0.2] - 2026-06-07

### Bug Fix — Page crash on Chinese input + incoming translation not working

**Severity:** High — page freezes when typing Chinese; incoming English messages not translated.

### Root Cause

1. **Page crash (Chinese input):** The setupOutgoingHandler() was called repeatedly by
   ebindAll() (every 1s during SPA bootstrap). Even though data-tt-bound was checked,
   when WhatsApp rebuilds the input element on chat switch, the old element is GC'd but
   the flag is lost. With the old approach, the same input could get multiple keydown
   handlers bound via stopImmediatePropagation race conditions, causing infinite loops.

2. **Incoming not translating:** isEnglishDominant() required latinChars > cjkChars,
   which fails for simple messages like "hello" (only 5 latin chars, 0 CJK — the ratio
   check cjkChars / text.length divides by zero-ish). The function was replaced with a
   simpler isEnglish() check: has Latin letters AND has no CJK.

### What Changed

- Replaced data-tt-bound attribute check with WeakSet<HTMLElement> (oundInputs)
  for input deduplication. WeakSet automatically cleans up when DOM elements are GC'd,
  preventing stale binding state across SPA navigation.
- Added isEnglish() helper — simple has Latin && no CJK check instead of ratio-based
  isEnglishDominant() for incoming message detection.
- Added isProcessed() helper that checks both the element and its ancestors for
  data-tt-done to avoid re-processing nested elements.
- Added deduplication (seen Set) in processNewNodes() to avoid processing the same
  element multiple times from overlapping mutations.
- Increased ireEnterOn delay from 50ms to 80ms for more reliable WhatsApp processing.

---

## [1.0.1] - 2026-06-07

### Bug Fix — WhatsApp Web DOM selectors updated

**Severity:** High — core translation features were completely non-functional.

### Root Cause

WhatsApp Web updated its DOM structure. The old selectors used by the content script
(span.selectable-text, .message-in, .message-out, #main footer, etc.) no longer
match the current page, causing both incoming (EN→ZH) and outgoing (ZH→EN) translations
to silently fail.

### What Changed

Only src/content.ts was modified. ackground.ts, popup.ts, manifest.json, and
package.json are unchanged.

| Function | Old Selector | New Selector |
|----------|-------------|-------------|
| getMessageTextEls() | span.selectable-text | [data-testid="selectable-text"], span.selectable-text |
| isIncomingMessage() | .message-in / .message-out class check | [data-testid="tail-in"] / [data-testid="tail-out"] inside [data-testid="msg-container"] |
| ppendTranslation() | copyableParent.parentElement | Same parent chain, adjusted for new nesting depth |
| indChatInput() | #main div[contenteditable="true"][role="textbox"] | [data-testid="conversation-compose-box-input"] (primary) |
| indSendButton() | utton[aria-label="Send"] | [data-testid="send"] (primary) |
| setupMessageObserver() | #main | [data-testid="conversation-panel-messages"] (primary) |

### Added

- __TT_DEBUG__ flag and 	tLog() helper — gated console.debug logs for future diagnosis.
- Fallback chains on all selectors (new data-testid first, legacy selectors as backup)
  to handle WhatsApp's gradual rollout of DOM changes across users.

### Verification

- 
pm run build passes with no errors.
- Output: dist/content.js (11.06 kB), dist/background.js (2.42 kB), dist/popup.js (1.85 kB).

### How to Test

1. Load unpacked dist/ in Chrome with Developer mode.
2. Set DeepSeek API key in popup, keep both toggles ON.
3. **Outgoing test:** Type Chinese text and press Enter — receiver should see English.
4. **Incoming test:** Send English text from another account — Chinese translation should appear below.
5. Open DevTools Console and look for [TradeTranslate] debug logs.

---

## [1.0.0] - Initial Release

- Two-way EN ? ZH translation for WhatsApp Web.
- DeepSeek API integration via background service worker.
- Popup UI for API key management and toggle settings.
- MutationObserver-based incoming message detection.
- Enter key and send button interception for outgoing translation.
