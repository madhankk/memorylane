const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const portInput = document.getElementById("port");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const openBtn = document.getElementById("openBtn");
const autoStartCheckbox = document.getElementById("autoStart");
const logEl = document.getElementById("log");
const updateBanner = document.getElementById("updateBanner");
const updateBannerText = document.getElementById("updateBannerText");
const updateBannerBtn = document.getElementById("updateBannerBtn");

const LABELS = {
  running: "Running",
  starting: "Starting...",
  stopping: "Stopping...",
  error: "Failed to start",
  stopped: "Stopped",
};

function render(status) {
  statusDot.className = `dot ${status.state}`;
  statusText.textContent = LABELS[status.state] ?? status.state;
  portInput.value = status.port;
  startBtn.disabled = status.state === "running" || status.state === "starting";
  stopBtn.disabled = status.state !== "running" && status.state !== "starting";
  openBtn.disabled = status.state !== "running";
  portInput.disabled = status.state !== "stopped" && status.state !== "error";
}

function renderUpdateStatus(status) {
  updateBanner.classList.toggle("visible", !!status.available);
  if (status.available) {
    updateBannerText.textContent = `A new version (v${status.latestVersion}) is available - you're on v${status.currentVersion}.`;
  }
}

async function init() {
  const status = await window.memorylane.getStatus();
  render(status);
  autoStartCheckbox.checked = status.autoStart;
  for (const line of status.logs) appendLog(line);

  renderUpdateStatus(await window.memorylane.getUpdateStatus());
}

function appendLog(line) {
  logEl.textContent += line.endsWith("\n") ? line : line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

startBtn.addEventListener("click", () => {
  const port = Number(portInput.value) || 4280;
  void window.memorylane.start(port);
});
stopBtn.addEventListener("click", () => void window.memorylane.stop());
openBtn.addEventListener("click", () => void window.memorylane.openInBrowser());
autoStartCheckbox.addEventListener("change", () => void window.memorylane.setAutoStart(autoStartCheckbox.checked));
updateBannerBtn.addEventListener("click", () => void window.memorylane.openUpdateUrl());

window.memorylane.onStatusChange((status) => render(status));
window.memorylane.onLog((line) => appendLog(line));
window.memorylane.onUpdateStatusChange((status) => renderUpdateStatus(status));

void init();
