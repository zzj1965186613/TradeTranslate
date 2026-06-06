const $ = (id) => document.getElementById(id);
const apiKeyInput = $("apiKey");
const saveBtn = $("saveBtn");
const clearBtn = $("clearBtn");
const statusEl = $("status");
const toggleIncoming = $("toggleIncoming");
const toggleOutgoing = $("toggleOutgoing");
function setStatus(text, type) {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}
async function loadSettings() {
  const stored = await chrome.storage.local.get([
    "apiKey",
    "translateIncoming",
    "translateOutgoing"
  ]);
  if (stored.apiKey) apiKeyInput.value = stored.apiKey;
  toggleIncoming.checked = stored.translateIncoming !== false;
  toggleOutgoing.checked = stored.translateOutgoing !== false;
  setStatus(
    stored.apiKey ? "API key configured" : "No API key saved",
    stored.apiKey ? "saved" : "empty"
  );
}
async function saveKey() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    setStatus("Please enter an API key", "empty");
    return;
  }
  try {
    await chrome.storage.local.set({ apiKey: key });
    setStatus("API key saved", "saved");
  } catch (err) {
    setStatus("Failed to save", "empty");
    console.error("Save error:", err);
  }
}
async function clearKey() {
  apiKeyInput.value = "";
  try {
    await chrome.storage.local.remove("apiKey");
    setStatus("API key removed", "empty");
  } catch (err) {
    console.error("Clear error:", err);
  }
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
