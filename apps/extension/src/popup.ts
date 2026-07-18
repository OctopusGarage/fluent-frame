function setStatus(message: string): void {
  const status = document.getElementById("status");
  if (status) {
    status.textContent = message;
  }
}

document.getElementById("generate")?.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus("No active tab.");
      return;
    }
    await chrome.tabs.sendMessage(tab.id, { type: "popupGenerate" });
    setStatus("Request sent to YouTube page.");
  } catch {
    setStatus("Could not reach the YouTube page.");
  }
});
