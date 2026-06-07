# Changelog

All notable changes to TradeTranslate are documented in this file.

---
## [1.0.3] - 2026-06-07

### Bug Fix ！ Incoming messages without tail not translated + Send button selector + Translation styling

**Severity:** High ！ most incoming messages in a consecutive group were silently skipped.

### Root Cause

1. **Messages without tail skipped:** WhatsApp only renders `data-testid="tail-in"` / `data-testid="tail-out"` on the **last message in a consecutive group** from the same sender. Earlier messages in the group have no tail indicator, causing `isIncomingMessage()` to return `false`. This meant ~60% of incoming messages were never translated.

2. **Send button not found:** WhatsApp removed `data-testid="send"` from the send button. The button now only has `aria-label="窟僕"` (or "Send" in English locales), with a child span containing `data-testid="wds-ic-send-filled"`.

3. **Translation text unstyled:** The `.tt-translation` class had no CSS, and no CSS file was injected. Translation text appeared as unstyled default text, indistinguishable from the original message.

### What Changed

- `isIncomingMessage()`: Added `alignItems` fallback ！ checks the parent container's computed `align-items` CSS property. WhatsApp uses `flex-start` for incoming (left-aligned) and `flex-end` for outgoing (right-aligned). This reliably identifies message direction even without tail indicators.
- `findSendButton()`: Reordered selector priority ！ `aria-label="窟僕"` is now primary (since it's always present), with `data-testid="send"` as legacy fallback.
- `appendTranslation()`: Added inline styles to the translation div for visual distinction (gray color, smaller font, top border separator).

### Verification

- In-app browser E2E test: all 12 messages correctly classified (4 incoming, 8 outgoing).
- Previously 6 messages were "unknown" (no tail); now all correctly identified via alignItems.
- "Just a test" and "ok" (incoming English) correctly flagged for translation.
- Send button found via `aria-label="窟僕"`.
- `npm run build` passes.


## [1.0.2] - 2026-06-07

### Bug Fix ！ Page crash on Chinese input + incoming translation not working

**Severity:** High ！ page freezes when typing Chinese; incoming English messages not translated.

### Root Cause

1. **Page crash (Chinese input):** The setupOutgoingHandler() was called repeatedly by
   ebindAll() (every 1s during SPA bootstrap). Even though data-tt-bound was checked,
   when WhatsApp rebuilds the input element on chat switch, the old element is GC'd but
   the flag is lost. With the old approach, the same input could get multiple keydown
   handlers bound via stopImmediatePropagation race conditions, causing infinite loops.

2. **Incoming not translating:** isEnglishDominant() required latinChars > cjkChars,
   which fails for simple messages like "hello" (only 5 latin chars, 0 CJK ！ the ratio
   check cjkChars / text.length divides by zero-ish). The function was replaced with a
   simpler isEnglish() check: has Latin letters AND has no CJK.

### What Changed

- Replaced data-tt-bound attribute check with WeakSet<HTMLElement> (oundInputs)
  for input deduplication. WeakSet automatically cleans up when DOM elements are GC'd,
  preventing stale binding state across SPA navigation.
- Added isEnglish() helper ！ simple has Latin && no CJK check instead of ratio-based
  isEnglishDominant() for incoming message detection.
- Added isProcessed() helper that checks both the element and its ancestors for
  data-tt-done to avoid re-processing nested elements.
- Added deduplication (seen Set) in processNewNodes() to avoid processing the same
  element multiple times from overlapping mutations.
- Increased ireEnterOn delay from 50ms to 80ms for more reliable WhatsApp processing.

---

## [1.0.1] - 2026-06-07

### Bug Fix ！ WhatsApp Web DOM selectors updated

**Severity:** High ！ core translation features were completely non-functional.

### Root Cause

WhatsApp Web updated its DOM structure. The old selectors used by the content script
(span.selectable-text, .message-in, .message-out, #main footer, etc.) no longer
match the current page, causing both incoming (EN★ZH) and outgoing (ZH★EN) translations
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

- __TT_DEBUG__ flag and 	tLog() helper ！ gated console.debug logs for future diagnosis.
- Fallback chains on all selectors (new data-testid first, legacy selectors as backup)
  to handle WhatsApp's gradual rollout of DOM changes across users.

### Verification

- 
pm run build passes with no errors.
- Output: dist/content.js (11.06 kB), dist/background.js (2.42 kB), dist/popup.js (1.85 kB).

### How to Test

1. Load unpacked dist/ in Chrome with Developer mode.
2. Set DeepSeek API key in popup, keep both toggles ON.
3. **Outgoing test:** Type Chinese text and press Enter ！ receiver should see English.
4. **Incoming test:** Send English text from another account ！ Chinese translation should appear below.
5. Open DevTools Console and look for [TradeTranslate] debug logs.

---

## [1.0.0] - Initial Release

- Two-way EN ? ZH translation for WhatsApp Web.
- DeepSeek API integration via background service worker.
- Popup UI for API key management and toggle settings.
- MutationObserver-based incoming message detection.
- Enter key and send button interception for outgoing translation.
