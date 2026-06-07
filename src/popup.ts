// TradeTranslate popup — API provider, key & settings management

const $ = (id: string) => document.getElementById(id)!;

// ── DOM refs ─────────────────────────────────────────
const apiProvider = $("apiProvider") as HTMLSelectElement;
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

  // Restore saved model
  const savedModel = stored.modelSelect || "";
  const savedCustomModel = stored.customModel || "";
  if (savedModel && apiProvider.value !== "custom") modelSelect.dataset.pending = savedModel;
  if (savedCustomModel && apiProvider.value === "custom") customModel.dataset.pending = savedCustomModel;

  // Auto-fetch models if API key exists
  if (stored.apiKey) fetchModelsForCurrentProvider();

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
    toSave.customModel = customModel.value;
  } else {
    toSave.modelSelect = modelSelect.value;
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
  customModel.innerHTML = '<option value="" disabled selected>Enter API Key then click refresh</option>';
  modelSelect.innerHTML = '<option value="" disabled selected>Click refresh to load models</option>';
  try {
    await chrome.storage.local.remove(["apiKey", "customBaseUrl", "customModel", "modelSelect"]);
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


// ── Model fetching ─────────────────────────────────
async function fetchModelsForCurrentProvider(): Promise<void> {
  const provider = apiProvider.value;
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey && provider !== "claude") {
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