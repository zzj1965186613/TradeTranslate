# TradeTranslate

Seamless multilingual translation for **WhatsApp Web** — translate incoming and outgoing messages between any language pair using your preferred AI provider.

- **Incoming messages:** auto-translate and display below the original message.
- **Outgoing messages:** translate before sending — the recipient sees the translated text.
- Supports **14 languages** and **5 AI providers** (DeepSeek, OpenAI, Claude, Gemini, Custom).

---

## Features

- **Multilingual support:** English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português, Русский, العربية, Tiếng Việt, ภาษาไทย, Bahasa Indonesia.
- **Multiple AI providers:** DeepSeek, OpenAI, Claude (Anthropic), Google Gemini, or any OpenAI-compatible API.
- **Flexible language pairs:** configure any source→target combination for incoming and outgoing directions independently.
- **Script-based detection:** automatically identifies text script (Latin, CJK, Cyrillic, Arabic, Japanese, Korean, Thai) to decide when to translate.
- Toggle translation on/off for incoming and outgoing messages.
- Lightweight Chrome Extension (Manifest V3).
- API keys stored locally in the browser.

---

## Installation (from GitHub Releases)

1. Go to the [Releases](https://github.com/zzj1965186613/TradeTranslate/releases) page.
2. Download the latest `TradeTranslate.zip`.
3. Extract the zip to a folder you'll keep (e.g., `C:\Extensions\TradeTranslate`).
4. Open Chrome and go to `chrome://extensions/`.
5. Enable **Developer mode** (top-right).
6. Click **Load unpacked** and select the extracted folder.
7. The TradeTranslate icon should appear in your toolbar.

---

## Configuration

### 1. Choose an API Provider

Click the TradeTranslate icon and select your preferred provider:

| Provider | Notes |
|----------|-------|
| **DeepSeek** | Default. Requires a DeepSeek API key (`sk-...`). |
| **OpenAI** | Requires an OpenAI API key (`sk-...`). Uses `gpt-4o-mini`. |
| **Claude (Anthropic)** | Requires an Anthropic API key (`sk-ant-...`). Uses `claude-3-5-haiku`. |
| **Google Gemini** | Requires a Google API key (`AIza...`). Uses `gemini-2.0-flash`. |
| **Custom (OpenAI-compatible)** | For Ollama, vLLM, Azure OpenAI, etc. Provide your own Base URL and model name. |

### 2. Enter Your API Key

Paste your API key and click **Save**.

### 3. Set Language Pairs

Configure translation directions:

- **Incoming (Direction A):** e.g., From `English` → To `简体中文`
- **Outgoing (Direction B):** e.g., From `简体中文` → To `English`

Any language pair is supported, not just EN↔ZH.

> Your API key is stored locally in Chrome storage and is only sent to the chosen provider during translation requests.

---

## Usage

- **Incoming:** When a message matching your source language script is received, the extension appends a translated version below it.
- **Outgoing:** When you type a message matching your outgoing source language and press Enter (or click Send), it is automatically translated before being sent.
- Disable either direction in the popup settings.

---

## Development

### Prerequisites

- Node.js (v18+ recommended)
- npm

### Setup

```bash
git clone https://github.com/zzj1965186613/TradeTranslate.git
cd TradeTranslate
npm install
```

### Build

```bash
npm run build
```

The built extension will be in the `dist/` folder.

### Load for Development

1. Run `npm run build`.
2. Go to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `dist/` folder.
5. After making changes, run `npm run build` again and click the refresh icon on the extension card.

---

## How It Works

1. `content.ts` runs on WhatsApp Web, observes new messages, and detects their script (Latin, CJK, Cyrillic, etc.).
2. If the message matches the configured source language, it sends a translation request to the background service worker.
3. `background.ts` routes the request to the selected AI provider (DeepSeek / OpenAI / Claude / Gemini / Custom) using the correct API format.
4. The translated text is displayed below the original message (incoming) or replaces the input text before sending (outgoing).

---

## Supported Providers

| Provider | API Format | Key Auth Method |
|----------|-----------|----------------|
| DeepSeek | OpenAI-compatible | `Authorization: Bearer` |
| OpenAI | OpenAI-compatible | `Authorization: Bearer` |
| Claude (Anthropic) | Anthropic Messages | `x-api-key` header |
| Google Gemini | Gemini REST | URL query parameter `?key=` |
| Custom | OpenAI-compatible | `Authorization: Bearer` |

---

## Notes

- This extension is designed for **WhatsApp Web** only.
- Translation quality depends on the selected AI model.
- Script-based detection is heuristic — it distinguishes writing systems (Latin vs CJK vs Cyrillic, etc.) rather than exact languages within the same script (e.g., English vs French, both Latin).
- If you encounter issues, verify your API key is valid and you have remaining quota.

---

## License

MIT
