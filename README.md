# TradeTranslate

TradeTranslate is a Manifest V3 browser extension for WhatsApp Web. It translates incoming and outgoing messages with either high-quality API providers or a key-free offline/basic engine.

## What's New in v1.3.0

- Added Custom Dictionary management in the Popup: import, export, clear, and entry count.
- Added JSON, CSV, and TSV dictionary import with `source,target,sourceLang,targetLang` fields.
- Improved Offline Dictionary matching with longest-match tokenization, phrase priority, punctuation preservation, and zh<->en starter entries.
- Custom dictionary entries now take priority over the starter dictionary.
- Browser Native translation remains available as a key-free fallback when the browser supports the Translator API.
- Updated build and release metadata to v1.3.0.

## Translation Engines

### API Provider Translation

API providers use remote LLM or translation-capable model APIs. These usually provide the best quality and broadest language coverage, but require a provider API key.

| Provider | Notes |
| --- | --- |
| DeepSeek | OpenAI-compatible chat completions. |
| Xiaomi MiMo | OpenAI-compatible Xiaomi MiMo models. |
| OpenAI | OpenAI chat completions. |
| Claude (Anthropic) | Anthropic Messages API. |
| Google Gemini | Gemini REST API. |
| Custom (OpenAI-compatible) | For any compatible endpoint where you provide Base URL and model. |

### Offline Dictionary (Basic)

The `Offline Dictionary (Basic)` provider does not require an API key and does not call remote LLM APIs. It uses:

1. User-imported custom dictionary entries.
2. A lightweight built-in starter dictionary.
3. Explicit no-match errors when no dictionary entry matches.

This is not full machine translation. It is deterministic phrase replacement intended for common terms, short phrases, and user-defined vocabulary. Unknown text is not treated as successfully translated.

### Browser Native Translation

The `browser-native` offline model option uses the browser's built-in Translator API when available. This is key-free online/local browser capability depending on the browser implementation, not an unofficial Google or Microsoft crawler interface. If the browser API is unavailable, TradeTranslate falls back to the dictionary path and returns an explicit error on no match.

### Transformers.js Placeholder

`transformers-js` is reserved for a future local WASM/model integration. It does not load large models in v1.3.0 and falls back immediately to the dictionary path.

## Custom Dictionary Import

Open the Popup and use the Custom Dictionary area:

- `Import Dictionary`: accepts `.json`, `.csv`, and `.tsv`.
- `Export Dictionary`: downloads the current custom entries as JSON.
- `Clear Custom Dictionary`: removes all custom entries.
- The Popup shows the current custom entry count.

JSON format:

```json
[
  {
    "source": "你好",
    "target": "hello",
    "sourceLang": "zh",
    "targetLang": "en"
  }
]
```

CSV/TSV format:

```csv
source,target,sourceLang,targetLang
你好,hello,zh,en
测试,test,zh,en
```

When importing a duplicate `sourceLang + targetLang + source`, the imported entry replaces the existing custom entry. Custom entries override the built-in starter dictionary during translation.

## Features

- Incoming message translation appended below original WhatsApp messages.
- Outgoing message translation before send.
- Independent language pairs for incoming and outgoing directions.
- Translation cache and batching for lower latency.
- Provider switching between API providers and key-free offline/basic engines.
- API keys and custom dictionaries stored locally in `chrome.storage.local`.
- Supports English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Russian, Arabic, Vietnamese, Thai, and Indonesian selectors.

## Installation from GitHub Releases

1. Open the [Releases](https://github.com/zzj1965186613/TradeTranslate/releases) page.
2. Download the latest TradeTranslate zip.
3. Extract it to a folder you keep.
4. Open Chrome or a Chromium browser and go to `chrome://extensions/`.
5. Enable Developer mode.
6. Click Load unpacked and select the extracted extension folder.

## Configuration

1. Click the TradeTranslate icon.
2. Choose an API provider or `Offline Dictionary (Basic)`.
3. For API providers, enter the API key and select a model.
4. For offline mode, choose `local-dictionary`, `browser-native`, or `transformers-js`.
5. Configure incoming and outgoing language directions.
6. Click Save.

Your API key is stored locally and is sent only to the selected API provider. Offline Dictionary mode does not require or send an API key.

## Development

```bash
npm install
npm run build
```

The built extension is written to `dist/`.

Useful validation commands:

```bash
node scripts/verify-offline-dictionary.mjs
.\node_modules\.bin\tsc.cmd --noEmit
npm.cmd run build
```

## Notes

- TradeTranslate is designed for WhatsApp Web.
- API translation quality depends on the selected provider/model.
- Offline Dictionary is intentionally lightweight and is not comparable to Google, Microsoft, or LLM translation quality.
- No unofficial Google/Microsoft crawler interfaces are used.

## License

MIT
