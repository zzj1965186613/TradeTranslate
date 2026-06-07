# TradeTranslate

Seamless two-way **EN ↔ ZH** translation for **WhatsApp Web**.

- Incoming messages: auto-translate English to Chinese and show below the original message.
- Outgoing messages: pre-translate Chinese to English before sending.
- Uses **DeepSeek API** for high-quality, natural translations.

---

## Features

- Toggle translation on/off for incoming and outgoing messages.
- Lightweight Chrome Extension (Manifest V3).
- Stores your API key locally in the browser (not shared).
- Simple UI to manage settings.

---

## Installation (from GitHub Releases)

1. Go to the [Releases](https://github.com/zzj1965186613/TradeTranslate/releases) page.
2. Download the latest `TradeTranslate.zip`.
3. Extract the zip to a folder you’ll keep (e.g., `C:\Extensions\TradeTranslate`).
4. Open Chrome and go to `chrome://extensions/`.
5. Enable **Developer mode** (top-right).
6. Click **Load unpacked** and select the extracted folder.
7. The TradeTranslate icon should appear in your toolbar.

---

## Configuration (API Key)

You need a **DeepSeek API key** to use the extension.

1. Click the TradeTranslate icon in your Chrome toolbar.
2. Paste your API key into the input field (starts with `sk-...`).
3. Click **Save**.
4. Toggle **Translate incoming** / **Translate outgoing** as needed.

> Your key is stored locally in Chrome storage and is never uploaded anywhere except to DeepSeek during translation requests.

---

## Usage

- **Incoming (EN → ZH):** When you receive an English message, the extension will append a Chinese translation below it.
- **Outgoing (ZH → EN):** When you type in Chinese and press Enter (or click Send), it will automatically translate to English before sending.
- You can disable either direction in the popup settings.

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

1. `content.js` runs on WhatsApp Web and observes new messages.
2. For incoming English messages, it sends a translation request to the background service worker.
3. `background.js` calls the **DeepSeek API** and returns the translated text.
4. The translated text is displayed below the original message.
5. For outgoing Chinese text, the extension intercepts the send action, translates, and replaces the text before sending.

---

## Notes

- This extension is designed for **WhatsApp Web** only.
- Translation quality depends on the DeepSeek model.
- If you encounter issues, make sure your API key is valid and you have quota remaining.

---

## License

MIT
