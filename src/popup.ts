// TradeTranslate popup — API provider, key & settings management

const $ = (id: string) => document.getElementById(id)!;

// ── DOM refs ─────────────────────────────────────────
const apiProvider = $("apiProvider") as HTMLSelectElement;
const apiKeyInput = $("apiKey") as HTMLInputElement;
const customFields = $("customFields") as HTMLDivElement;
const customBaseUrl = $("customBaseUrl") as HTMLInputElement;
const customModel = $("customModel") as HTMLInputElement;
const saveBtn = $("saveBtn") as HTMLButtonElement;
const clearBtn = $("clearBtn") as HTMLButtonElement;
const statusEl = $("status") as HTMLDivElement;
const toggleIncoming = $("toggleIncoming") as HTMLInputElement;
const toggleOutgoing = $("toggleOutgoing") as HTMLInputElement;
const sourceLangIncoming = $("sourceLangIncoming") as HTMLSelectElement;
const targetLangIncoming = $("targetLangIncoming") as HTMLSelectElement;
const sourceLangOutgoing = $("sourceLangOutgoing") as HTMLSelectElement;
const targetLangOutgoing = $("targetLangOutgoing") as HTMLSelectElement;

// ── Provider metadata ────────────────────────────────
const PROVIDER_PLACEHOLDERS: Record<string, string> = {
  deepseek: "sk-...",
  openai: "sk-...",
  claude: "sk-ant-...",
  gemini: "AIza...",
  custom: "Your API key",
};

function updatePlaceholder(): void {
  apiKeyInput.placeholder = PROVIDER_PLACEHOLDERS[apiProvider.value] || "sk-...";
  if (apiProvider.value === "custom") {
    customFields.classList.add("visible");
  } else {
    customFields.classList.remove("visible");
  }
}

// ── Status helper ────────────────────────────────────
function setStatus(text: string, type: "saved" | "empty"): void {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

// ── Load settings ────────────────────────────────────
async function loadSettings(): Promise<void> {
  const stored = await chrome.storage.local.get([
    "apiProvider",
    "apiKey",
    "customBaseUrl",
    "customModel",
    "translateIncoming",
    "translateOutgoing",
    "sourceLangIncoming",
    "targetLangIncoming",
    "sourceLangOutgoing",
    "targetLangOutgoing",
  ]);
  apiProvider.value = stored.apiProvider || "deepseek";
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
  setStatus(
    stored.apiKey ? "API key configured" : "No API key saved",
    stored.apiKey ? "saved" : "empty"
  );
}

// ── Save / Clear ─────────────────────────────────────
async function saveKey(): Promise<void> {
  const key = apiKeyInput.value.trim();
  if (!key) { setStatus("Please enter an API key", "empty"); return; }
  const toSave: Record<string, string> = {
    apiProvider: apiProvider.value,
    apiKey: key,
  };
  if (apiProvider.value === "custom") {
    toSave.customBaseUrl = customBaseUrl.value.trim();
    toSave.customModel = customModel.value.trim();
  }
  try {
    await chrome.storage.local.set(toSave);
    setStatus("Settings saved", "saved");
  } catch (err) {
    setStatus("Failed to save", "empty");
    console.error("Save error:", err);
  }
}

async function clearKey(): Promise<void> {
  apiKeyInput.value = "";
  customBaseUrl.value = "";
  customModel.value = "";
  try {
    await chrome.storage.local.remove(["apiKey", "customBaseUrl", "customModel"]);
    setStatus("API key removed", "empty");
  } catch (err) { console.error("Clear error:", err); }
}

// ── Event listeners ──────────────────────────────────
apiProvider.addEventListener("change", updatePlaceholder);

saveBtn.addEventListener("click", saveKey);
clearBtn.addEventListener("click", clearKey);
apiKeyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveKey();
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

loadSettings();
