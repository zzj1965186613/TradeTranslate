// TradeTranslate popup — API provider, key & settings management

const $ = (id: string) => document.getElementById(id)!;

// ── DOM refs ─────────────────────────────────────────
const apiProvider = $("apiProvider") as HTMLSelectElement;
const apiKeySection = $("apiKeySection") as HTMLDivElement;
const apiKeyInput = $("apiKey") as HTMLInputElement;
const customFields = $("customFields") as HTMLDivElement;
const customBaseUrl = $("customBaseUrl") as HTMLInputElement;
const customModel = $("customModel") as HTMLSelectElement;
const modelSelect = $("modelSelect") as HTMLSelectElement;
const presetModelSection = $("presetModelSection") as HTMLDivElement;
const fetchModelsBtn = $("fetchModelsBtn") as HTMLButtonElement;
const fetchModelsBtnCustom = $("fetchModelsBtnCustom") as HTMLButtonElement;
const saveBtn = $("saveBtn") as HTMLButtonElement;
const clearBtn = $("clearBtn") as HTMLButtonElement;
const statusEl = $("status") as HTMLDivElement;
const toggleIncoming = $("toggleIncoming") as HTMLInputElement;
const toggleOutgoing = $("toggleOutgoing") as HTMLInputElement;
const sourceLangIncoming = $("sourceLangIncoming") as HTMLSelectElement;
const targetLangIncoming = $("targetLangIncoming") as HTMLSelectElement;
const sourceLangOutgoing = $("sourceLangOutgoing") as HTMLSelectElement;
const targetLangOutgoing = $("targetLangOutgoing") as HTMLSelectElement;
const customDictCount = $("customDictCount") as HTMLSpanElement;
const dictFileInput = $("dictFileInput") as HTMLInputElement;
const importDictBtn = $("importDictBtn") as HTMLButtonElement;
const exportDictBtn = $("exportDictBtn") as HTMLButtonElement;
const clearDictBtn = $("clearDictBtn") as HTMLButtonElement;

interface DictionaryEntry {
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
}

// ── Provider metadata ────────────────────────────────
const PROVIDER_PLACEHOLDERS: Record<string, string> = {
  deepseek: "sk-...",
  xiaomi: "sk-... or tp-...",
  offline: "No API key required",
  openai: "sk-...",
  claude: "sk-ant-...",
  gemini: "AIza...",
  custom: "Your API key",
};

const KEYLESS_PROVIDERS = new Set(["offline"]);
const STATIC_MODEL_PROVIDERS = new Set(["claude", "xiaomi", "offline"]);
const CUSTOM_DICTIONARY_KEY = "customDictionary";

function updatePlaceholder(): void {
  apiKeyInput.placeholder = PROVIDER_PLACEHOLDERS[apiProvider.value] || "sk-...";
  const isOffline = apiProvider.value === "offline";

  apiKeySection.style.display = isOffline ? "none" : "";
  apiKeyInput.disabled = isOffline;

  if (apiProvider.value === "custom") {
    customFields.classList.add("visible");
    presetModelSection.style.display = "none";
  } else {
    customFields.classList.remove("visible");
    presetModelSection.style.display = "";
  }
}

// ── Status helper ────────────────────────────────────
function setStatus(text: string, type: "saved" | "empty"): void {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

function normalizeLangForStorage(lang: string): string {
  const normalized = lang.trim().toLowerCase().replace("-", "_");
  if (["zh_cn", "zh_hans", "cn"].includes(normalized)) return "zh";
  if (["zh_tw", "zh_hant"].includes(normalized)) return "zh_tw";
  return normalized;
}

function normalizeDictionaryEntry(entry: Partial<DictionaryEntry>): DictionaryEntry | null {
  const source = String(entry.source || "").trim();
  const target = String(entry.target || "").trim();
  const sourceLang = normalizeLangForStorage(String(entry.sourceLang || ""));
  const targetLang = normalizeLangForStorage(String(entry.targetLang || ""));

  if (!source || !target || !sourceLang || !targetLang) return null;
  return { source, target, sourceLang, targetLang };
}

function dictionaryEntryKey(entry: DictionaryEntry): string {
  return `${entry.sourceLang}\u0000${entry.targetLang}\u0000${entry.source}`;
}

function normalizeDictionaryEntries(entries: unknown[]): DictionaryEntry[] {
  return entries
    .map((entry) => normalizeDictionaryEntry(entry as Partial<DictionaryEntry>))
    .filter((entry): entry is DictionaryEntry => Boolean(entry));
}

async function readCustomDictionary(): Promise<DictionaryEntry[]> {
  const stored = await chrome.storage.local.get([CUSTOM_DICTIONARY_KEY]);
  const entries = stored[CUSTOM_DICTIONARY_KEY];
  return Array.isArray(entries) ? normalizeDictionaryEntries(entries) : [];
}

async function writeCustomDictionary(entries: DictionaryEntry[]): Promise<void> {
  await chrome.storage.local.set({ [CUSTOM_DICTIONARY_KEY]: entries });
  updateDictionaryCount(entries.length);
}

function updateDictionaryCount(count: number): void {
  customDictCount.textContent = `${count} ${count === 1 ? "entry" : "entries"}`;
}

async function refreshDictionaryCount(): Promise<void> {
  const entries = await readCustomDictionary();
  updateDictionaryCount(entries.length);
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        current += '"';
        index++;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseDelimitedDictionary(text: string, delimiter: string): DictionaryEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const first = parseDelimitedLine(lines[0], delimiter).map((field) =>
    field.trim().toLowerCase()
  );
  const hasHeader =
    first.includes("source") &&
    first.includes("target") &&
    first.includes("sourcelang") &&
    first.includes("targetlang");

  const sourceIndex = hasHeader ? first.indexOf("source") : 0;
  const targetIndex = hasHeader ? first.indexOf("target") : 1;
  const sourceLangIndex = hasHeader ? first.indexOf("sourcelang") : 2;
  const targetLangIndex = hasHeader ? first.indexOf("targetlang") : 3;
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return normalizeDictionaryEntries(
    dataLines.map((line) => {
      const fields = parseDelimitedLine(line, delimiter);
      return {
        source: fields[sourceIndex],
        target: fields[targetIndex],
        sourceLang: fields[sourceLangIndex],
        targetLang: fields[targetLangIndex],
      };
    })
  );
}

function parseDictionaryText(fileName: string, text: string): DictionaryEntry[] {
  const trimmed = text.trim();
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".json") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("JSON dictionary must be an array");
    }
    return normalizeDictionaryEntries(parsed);
  }

  const delimiter =
    lowerName.endsWith(".tsv") || (trimmed.includes("\t") && !lowerName.endsWith(".csv"))
      ? "\t"
      : ",";
  return parseDelimitedDictionary(trimmed, delimiter);
}

function mergeDictionaries(
  current: DictionaryEntry[],
  imported: DictionaryEntry[]
): DictionaryEntry[] {
  const byKey = new Map<string, DictionaryEntry>();
  for (const entry of current) byKey.set(dictionaryEntryKey(entry), entry);
  for (const entry of imported) byKey.set(dictionaryEntryKey(entry), entry);
  return Array.from(byKey.values()).sort((a, b) =>
    dictionaryEntryKey(a).localeCompare(dictionaryEntryKey(b))
  );
}

async function importCustomDictionary(): Promise<void> {
  const file = dictFileInput.files?.[0];
  if (!file) return;

  try {
    const imported = parseDictionaryText(file.name, await file.text());
    if (!imported.length) {
      setStatus("No valid dictionary entries found", "empty");
      return;
    }

    const current = await readCustomDictionary();
    const merged = mergeDictionaries(current, imported);
    await writeCustomDictionary(merged);
    setStatus(`Imported ${imported.length} dictionary entries`, "saved");
  } catch (err: any) {
    setStatus(`Import failed: ${err.message || "Invalid dictionary"}`, "empty");
  } finally {
    dictFileInput.value = "";
  }
}

async function exportCustomDictionary(): Promise<void> {
  const entries = await readCustomDictionary();
  const blob = new Blob([JSON.stringify(entries, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "tradetranslate-custom-dictionary.json";
  link.click();
  URL.revokeObjectURL(url);
  setStatus(`Exported ${entries.length} dictionary entries`, "saved");
}

async function clearCustomDictionary(): Promise<void> {
  try {
    await chrome.storage.local.remove([CUSTOM_DICTIONARY_KEY]);
    updateDictionaryCount(0);
    setStatus("Custom dictionary cleared", "saved");
  } catch (err: any) {
    setStatus(`Clear failed: ${err.message || "Storage error"}`, "empty");
  }
}

// ── Load settings ────────────────────────────────────
async function loadSettings(): Promise<void> {
  const stored = await chrome.storage.local.get([
    "apiProvider",
    "apiKey",
    "customBaseUrl",
    "customModel",
    "modelSelect",
    "translateIncoming",
    "translateOutgoing",
    "sourceLangIncoming",
    "targetLangIncoming",
    "sourceLangOutgoing",
    "targetLangOutgoing",
  ]);
  apiProvider.value = stored.apiProvider || "deepseek";
  if (!apiProvider.value) apiProvider.value = "deepseek";
  if (stored.apiKey) apiKeyInput.value = stored.apiKey;
  if (stored.customBaseUrl) customBaseUrl.value = stored.customBaseUrl;
  if (stored.customModel) customModel.value = stored.customModel;
  toggleIncoming.checked = stored.translateIncoming !== false;
  toggleOutgoing.checked = stored.translateOutgoing !== false;
  sourceLangIncoming.value = stored.sourceLangIncoming || "en";
  targetLangIncoming.value = stored.targetLangIncoming || "zh";
  sourceLangOutgoing.value = stored.sourceLangOutgoing || "zh";
  targetLangOutgoing.value = stored.targetLangOutgoing || "en";
  updatePlaceholder();
  refreshDictionaryCount();

  // Restore saved model
  const savedModel = stored.modelSelect || "";
  const savedCustomModel = stored.customModel || "";
  if (savedModel && apiProvider.value !== "custom") modelSelect.dataset.pending = savedModel;
  if (savedCustomModel && apiProvider.value === "custom") customModel.dataset.pending = savedCustomModel;

  // Auto-fetch models if API key exists, or if the provider has built-in defaults.
  if (stored.apiKey || STATIC_MODEL_PROVIDERS.has(apiProvider.value)) {
    fetchModelsForCurrentProvider();
  }

  if (apiProvider.value === "offline") {
    setStatus("Offline translation enabled", "saved");
  } else {
    setStatus(
      stored.apiKey ? "API key configured" : "No API key saved",
      stored.apiKey ? "saved" : "empty"
    );
  }
}

// ── Save / Clear ─────────────────────────────────────
async function saveKey(): Promise<void> {
  const provider = apiProvider.value;
  const key = apiKeyInput.value.trim();
  if (!key && !KEYLESS_PROVIDERS.has(provider)) {
    setStatus("Please enter an API key", "empty");
    return;
  }
  const toSave: Record<string, string> = {
    apiProvider: provider,
  };
  if (key) toSave.apiKey = key;

  if (provider === "custom") {
    toSave.customBaseUrl = customBaseUrl.value.trim();
    toSave.customModel = customModel.value;
  } else {
    toSave.modelSelect = modelSelect.value;
  }
  try {
    await chrome.storage.local.set(toSave);
    setStatus(
      provider === "offline" ? "Offline settings saved" : "Settings saved",
      "saved"
    );
  } catch (err) {
    setStatus("Failed to save", "empty");
    console.error("Save error:", err);
  }
}

async function clearKey(): Promise<void> {
  apiKeyInput.value = "";
  customBaseUrl.value = "";
  customModel.innerHTML = '<option value="" disabled selected>Enter API Key then click refresh</option>';
  modelSelect.innerHTML = '<option value="" disabled selected>Click refresh to load models</option>';
  try {
    await chrome.storage.local.remove(["apiKey", "customBaseUrl", "customModel", "modelSelect"]);
    setStatus("API key removed", "empty");
  } catch (err) { console.error("Clear error:", err); }
}

// ── Event listeners ──────────────────────────────────
apiProvider.addEventListener("change", () => {
  updatePlaceholder();
  const targetSelect = apiProvider.value === "custom" ? customModel : modelSelect;
  delete targetSelect.dataset.pending;
  targetSelect.innerHTML =
    apiProvider.value === "custom"
      ? '<option value="" disabled selected>Enter API Key then click refresh</option>'
      : '<option value="" disabled selected>Click refresh to load models</option>';

  if (
    STATIC_MODEL_PROVIDERS.has(apiProvider.value) ||
    apiKeyInput.value.trim()
  ) {
    fetchModelsForCurrentProvider();
  }
});

saveBtn.addEventListener("click", saveKey);
clearBtn.addEventListener("click", clearKey);
importDictBtn.addEventListener("click", () => dictFileInput.click());
dictFileInput.addEventListener("change", importCustomDictionary);
exportDictBtn.addEventListener("click", exportCustomDictionary);
clearDictBtn.addEventListener("click", clearCustomDictionary);
apiKeyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveKey();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[CUSTOM_DICTIONARY_KEY]) return;
  const nextValue = changes[CUSTOM_DICTIONARY_KEY].newValue;
  updateDictionaryCount(Array.isArray(nextValue) ? nextValue.length : 0);
});

toggleIncoming.addEventListener("change", () => {
  chrome.storage.local.set({ translateIncoming: toggleIncoming.checked });
});
toggleOutgoing.addEventListener("change", () => {
  chrome.storage.local.set({ translateOutgoing: toggleOutgoing.checked });
});

sourceLangIncoming.addEventListener("change", () => {
  chrome.storage.local.set({ sourceLangIncoming: sourceLangIncoming.value });
});
targetLangIncoming.addEventListener("change", () => {
  chrome.storage.local.set({ targetLangIncoming: targetLangIncoming.value });
});
sourceLangOutgoing.addEventListener("change", () => {
  chrome.storage.local.set({ sourceLangOutgoing: sourceLangOutgoing.value });
});
targetLangOutgoing.addEventListener("change", () => {
  chrome.storage.local.set({ targetLangOutgoing: targetLangOutgoing.value });
});


// ── Model fetching ─────────────────────────────────
async function fetchModelsForCurrentProvider(): Promise<void> {
  const provider = apiProvider.value;
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey && !STATIC_MODEL_PROVIDERS.has(provider)) {
    setStatus("Please enter an API key first", "empty");
    return;
  }

  setStatus("Fetching model list...", "empty");
  const btn = provider === "custom" ? fetchModelsBtnCustom : fetchModelsBtn;
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = "\u23F3";

  try {
    const result = await chrome.runtime.sendMessage({
      action: "fetchModels",
      provider,
      apiKey,
      customBaseUrl: provider === "custom" ? customBaseUrl.value.trim() : undefined,
    });

    if (result.error) {
      setStatus(`Fetch failed: ${result.error}`, "empty");
      return;
    }

    const targetSelect = provider === "custom" ? customModel : modelSelect;
    const previousValue = targetSelect.dataset.pending || targetSelect.value;

    targetSelect.innerHTML = "";

    for (const m of result.data) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name || m.id;
      targetSelect.appendChild(opt);
    }

    // Add manual input option
    const manualOpt = document.createElement("option");
    manualOpt.value = "__manual__";
    manualOpt.textContent = "\u270F\uFE0F Enter manually...";
    targetSelect.appendChild(manualOpt);

    // Restore previous selection
    if (previousValue) {
      const match = result.data.find((m: { id: string }) => m.id === previousValue);
      if (match) {
        targetSelect.value = previousValue;
      } else if (previousValue !== "__manual__") {
        const opt = document.createElement("option");
        opt.value = previousValue;
        opt.textContent = previousValue;
        targetSelect.insertBefore(opt, targetSelect.firstChild);
        targetSelect.value = previousValue;
      }
    }

    delete targetSelect.dataset.pending;
    setStatus(`${result.data.length} models loaded`, "saved");
  } catch (err: any) {
    setStatus(`Fetch failed: ${err.message}`, "empty");
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

function handleManualInput(select: HTMLSelectElement): void {
  if (select.value === "__manual__") {
    const name = prompt("Enter model name:");
    if (name) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.insertBefore(opt, select.lastElementChild);
      select.value = name;
    } else if (select.options.length > 1) {
      select.selectedIndex = 0;
    }
  }
}

fetchModelsBtn.addEventListener("click", fetchModelsForCurrentProvider);
fetchModelsBtnCustom.addEventListener("click", fetchModelsForCurrentProvider);
modelSelect.addEventListener("change", () => handleManualInput(modelSelect));
customModel.addEventListener("change", () => handleManualInput(customModel));


loadSettings();
