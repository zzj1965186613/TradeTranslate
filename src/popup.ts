// TradeTranslate popup — API key & settings management

const $ = (id: string) => document.getElementById(id)!;
const apiKeyInput = $("apiKey") as HTMLInputElement;
const saveBtn = $("saveBtn") as HTMLButtonElement;
const clearBtn = $("clearBtn") as HTMLButtonElement;
const statusEl = $("status") as HTMLDivElement;
const toggleIncoming = $("toggleIncoming") as HTMLInputElement;
const toggleOutgoing = $("toggleOutgoing") as HTMLInputElement;

function setStatus(text: string, type: "saved" | "empty"): void {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

async function loadSettings(): Promise<void> {
  const stored = await chrome.storage.local.get([
    "apiKey",
    "translateIncoming",
    "translateOutgoing",
  ]);
  if (stored.apiKey) apiKeyInput.value = stored.apiKey;
  toggleIncoming.checked = stored.translateIncoming !== false;
  toggleOutgoing.checked = stored.translateOutgoing !== false;
  setStatus(
    stored.apiKey ? "API key configured" : "No API key saved",
    stored.apiKey ? "saved" : "empty"
  );
}

async function saveKey(): Promise<void> {
  const key = apiKeyInput.value.trim();
  if (!key) { setStatus("Please enter an API key", "empty"); return; }
  try {
    await chrome.storage.local.set({ apiKey: key });
    setStatus("API key saved", "saved");
  } catch (err) {
    setStatus("Failed to save", "empty");
    console.error("Save error:", err);
  }
}

async function clearKey(): Promise<void> {
  apiKeyInput.value = "";
  try {
    await chrome.storage.local.remove("apiKey");
    setStatus("API key removed", "empty");
  } catch (err) { console.error("Clear error:", err); }
}

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

loadSettings();