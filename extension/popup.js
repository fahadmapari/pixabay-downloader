/* ─────────────────────────────────────────────────────────────────────────────
   popup.js — Pixabay Downloader Chrome Extension
   ───────────────────────────────────────────────────────────────────────────── */

// ── Config ────────────────────────────────────────────────────────────────────

const WORKER_URLS = [
  "https://pixabay-proxy.fahadmapari09.workers.dev",
  "REPLACE_WITH_SECOND_WORKER_URL",
];
let workerIndex = 0;
function getWorkerUrl() {
  const url = WORKER_URLS[workerIndex];
  workerIndex = (workerIndex + 1) % WORKER_URLS.length;
  return url;
}

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const statusDot    = $("statusDot");
const statusIcon   = $("statusIcon");
const statusText   = $("statusText");

const previewEmpty  = $("previewEmpty");
const previewLoaded = $("previewLoaded");
const previewThumb  = $("previewThumb");
const thumbShimmer  = $("thumbShimmer");
const previewTags   = $("previewTags");
const previewId     = $("previewId");

const urlInput      = $("urlInput");
const btnTab        = $("btnTab");

const btnDownload   = $("btnDownload");
const btnSpinner    = $("btnSpinner");
const btnIcon       = $("btnIcon");
const btnLabel      = $("btnLabel");

// ── State ─────────────────────────────────────────────────────────────────────

let currentImageId = null;

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Extract the numeric Pixabay image ID from a page URL.
 * Handles patterns like:
 *   /photos/mountains-lake-5234052/
 *   /images/abstract-art-5234052/
 *   /videos/ocean-5234052/
 */
function extractId(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("pixabay.com")) return null;
    const match = u.pathname.match(/[/-](\d{5,})\/?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── Status helpers ─────────────────────────────────────────────────────────────

function setDot(state) {
  statusDot.className = "status-dot " + state;
}

function setStatus(msg, type = "dim") {
  statusText.textContent = msg;
  statusText.className   = "status-text " + type;

  if (type === "ok")  { statusIcon.textContent = "✓"; statusIcon.style.color = "var(--green)"; }
  else if (type === "err") { statusIcon.textContent = "✕"; statusIcon.style.color = "var(--red)"; }
  else { statusIcon.textContent = "·"; statusIcon.style.color = ""; }
}

// ── Loading state ──────────────────────────────────────────────────────────────

function setDownloadLoading(loading) {
  btnDownload.disabled         = loading;
  btnSpinner.style.display     = loading ? "block" : "none";
  btnIcon.style.display        = loading ? "none"  : "block";
  btnLabel.textContent         = loading ? "Downloading…" : "Download Image";
  setDot(loading ? "busy" : "ready");
}

// ── Preview ────────────────────────────────────────────────────────────────────

function showEmpty() {
  previewEmpty.style.display  = "flex";
  previewLoaded.style.display = "none";
  btnDownload.disabled        = true;
  currentImageId              = null;
  setDot("idle");
}

function showPreview(imageId, thumbUrl, tags) {
  currentImageId = imageId;

  previewEmpty.style.display  = "none";
  previewLoaded.style.display = "block";

  previewId.textContent   = `#${imageId}`;
  previewTags.textContent = tags || "No tags";

  // Lazy-load the thumbnail
  previewThumb.classList.add("loading");
  thumbShimmer.style.display = "block";

  if (thumbUrl) {
    previewThumb.onload = () => {
      previewThumb.classList.remove("loading");
      thumbShimmer.style.display = "none";
    };
    previewThumb.onerror = () => {
      thumbShimmer.style.display = "none";
    };
    previewThumb.src = thumbUrl;
  } else {
    thumbShimmer.style.display = "none";
  }

  btnDownload.disabled = false;
  setDot("ready");
}

// ── Load preview from worker ───────────────────────────────────────────────────

async function loadPreviewForId(imageId) {
  setStatus(`Detected ID ${imageId} — loading preview…`);
  setDot("busy");

  try {
    const res = await fetch(getWorkerUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId, previewOnly: true }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    showPreview(imageId, data.previewUrl, data.tags);
    setStatus(`Ready — ${data.tags || "image ready"}`, "dim");

  } catch (err) {
    // Still show the ID and enable download even if preview fails
    showPreview(imageId, null, "Preview unavailable");
    setStatus(err.message, "err");
    setDot("error");
  }
}

// ── Process a URL string ───────────────────────────────────────────────────────

function processUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) { showEmpty(); setStatus("Waiting for a Pixabay URL"); return; }

  const id = extractId(trimmed);
  if (!id) {
    showEmpty();
    setStatus("Not a valid Pixabay image URL", "err");
    setDot("error");
    return;
  }

  loadPreviewForId(id);
}

// ── Init ───────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  loadFromCurrentTab();
});

// ── Current tab button ─────────────────────────────────────────────────────────

btnTab.addEventListener("click", loadFromCurrentTab);

async function loadFromCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    urlInput.value = tab.url;
    processUrl(tab.url);
  } catch (err) {
    setStatus("Could not read current tab", "err");
  }
}

// ── URL input: process on enter or paste ──────────────────────────────────────

urlInput.addEventListener("input", (e) => {
  processUrl(e.target.value);
});

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") processUrl(urlInput.value);
});

// ── Download ───────────────────────────────────────────────────────────────────

btnDownload.addEventListener("click", async () => {
  if (!currentImageId) {
    setStatus("No image ID detected", "err");
    return;
  }

  setDownloadLoading(true);
  setStatus("Sending to proxy worker…");

  try {
    const res = await fetch(getWorkerUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: currentImageId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    // Derive filename from Content-Disposition header
    const disposition = res.headers.get("Content-Disposition") || "";
    const nameMatch   = disposition.match(/filename="?([^";\r\n]+)"?/);
    const filename    = nameMatch ? nameMatch[1] : `pixabay-${currentImageId}.jpg`;

    setStatus("Downloading image blob…");

    const blob    = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url:      blobUrl,
      filename: filename,
      saveAs:   false,
    });

    setStatus(`Saved: ${filename}`, "ok");
    setDot("ready");

    // Revoke blob URL after Chrome has had time to process it
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);

  } catch (err) {
    setStatus(err.message, "err");
    setDot("error");
  } finally {
    setDownloadLoading(false);
  }
});
