const API_BASE = location.hostname === "dsamuelhodge.github.io" ? "https://ingest.hodgeluke.com" : "";
const TOKEN_KEY = "media-pipeline-upload-token";
const VIEW_KEY = "media-pipeline-view";
const PAGE = 36;
const CONCURRENCY = 3;
const MAX_BYTES = 95 * 1024 * 1024;
const POLL_MS = 2000;

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "heif", "bmp", "svg"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "mkv"]);
const AUDIO_EXT = new Set(["m4a", "mp3", "wav", "ogg", "opus", "aac", "flac"]);

const $ = (id) => document.getElementById(id);
const fileInput = $("file");
const drop = $("drop");
const gallery = $("gallery");
const empty = $("empty");
const count = $("count");
const queueEl = $("queue");
const tokenInput = $("token");
const detail = $("detail");
const searchInput = $("search");
const moreBtn = $("more");
const uploadBtn = $("upload-btn");
const clearStagedBtn = $("clear-staged");
const titleInput = $("title");
const overall = $("overall");
const overallBar = $("overall-bar");
const overallLabel = $("overall-label");
const overallPct = $("overall-pct");
const overallFiles = $("overall-files");
const batchCount = $("batch-count");
const tokenOk = $("token-ok");

const inflight = new Map();
const stage = [];
let kindFilter = "";
let query = "";
let offset = 0;
let total = 0;
let assets = [];
let counts = { all: 0, image: 0, video: 0, audio: 0, pdf: 0 };
let view = localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
let searchTimer = 0;
let activeId = null;
let uploading = 0;

tokenInput.value = localStorage.getItem(TOKEN_KEY) ?? "";
if (tokenInput.value) tokenOk.classList.remove("hidden");
setView(view, { persist: false });

tokenInput.addEventListener("change", () => {
  localStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
  tokenOk.textContent = tokenInput.value.trim() ? "Token saved on this device." : "";
  tokenOk.classList.toggle("hidden", !tokenInput.value.trim());
  tokenOk.classList.remove("warn");
  syncBatchActions();
});
$("toggle-token").addEventListener("click", () => {
  const shown = tokenInput.type === "text";
  tokenInput.type = shown ? "password" : "text";
  $("toggle-token").textContent = shown ? "show" : "hide";
});

$("browse").addEventListener("click", (event) => {
  event.stopPropagation();
  fileInput.click();
});
drop.addEventListener("click", (event) => {
  if (event.target.closest("button, input, label")) return;
  fileInput.click();
});
drop.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});
$("refresh").addEventListener("click", () => loadGallery({ mode: "reset" }));
$("close").addEventListener("click", () => detail.close());
$("prev").addEventListener("click", () => stepDetail(-1));
$("next").addEventListener("click", () => stepDetail(1));
$("copy-text").addEventListener("click", copyDetailText);
moreBtn.addEventListener("click", () => loadGallery({ mode: "more" }));
uploadBtn.addEventListener("click", startBatch);
clearStagedBtn.addEventListener("click", clearStaged);
$("view-grid").addEventListener("click", () => setView("grid"));
$("view-list").addEventListener("click", () => setView("list"));

detail.addEventListener("click", (event) => {
  if (event.target === detail) detail.close();
});
detail.addEventListener("close", () => {
  activeId = null;
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    query = searchInput.value.trim();
    loadGallery({ mode: "reset" });
  }, 250);
});

drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", async (event) => {
  event.preventDefault();
  drop.classList.remove("over");
  stageFiles(await filesFromDataTransfer(event.dataTransfer));
});
fileInput.addEventListener("change", () => {
  stageFiles(fileInput.files);
  fileInput.value = "";
});
document.addEventListener("paste", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const files = event.clipboardData?.files;
  if (files?.length) {
    event.preventDefault();
    stageFiles(files);
  }
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "/" &&
    !(event.target instanceof HTMLInputElement) &&
    !(event.target instanceof HTMLTextAreaElement)
  ) {
    event.preventDefault();
    searchInput.focus();
  }
  if (!detail.open) return;
  if (event.key === "ArrowLeft") stepDetail(-1);
  if (event.key === "ArrowRight") stepDetail(1);
});

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((node) => node.classList.remove("on"));
    chip.classList.add("on");
    kindFilter = chip.dataset.kind ?? "";
    loadGallery({ mode: "reset" });
  });
}

function api(path) {
  return `${API_BASE}${path}`;
}

function token() {
  return tokenInput.value.trim();
}

function inferKind(file) {
  const mime = (file.type || "").toLowerCase().split(";")[0]?.trim() ?? "";
  const ext = extensionOf(file.name);
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return null;
}

function extensionOf(filename) {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

async function filesFromDataTransfer(dt) {
  if (!dt) return [];
  const items = [...(dt.items ?? [])];
  if (items.some((item) => typeof item.webkitGetAsEntry === "function")) {
    const collected = [];
    await Promise.all(
      items.map(async (item) => {
        const entry = item.webkitGetAsEntry?.();
        if (entry) await walkEntry(entry, collected);
        else if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) collected.push(file);
        }
      }),
    );
    if (collected.length) return collected;
  }
  return [...(dt.files ?? [])];
}

async function walkEntry(entry, into) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    into.push(file);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    await Promise.all(batch.map((child) => walkEntry(child, into)));
  }
}

function stageFiles(fileList) {
  if (!fileList?.length) return;
  let skipped = 0;
  let oversized = 0;
  for (const file of fileList) {
    if (file.size > MAX_BYTES) {
      oversized += 1;
      continue;
    }
    const dup = stage.some(
      (item) => item.status === "staged" && item.file.name === file.name && item.file.size === file.size,
    );
    if (dup) {
      skipped += 1;
      continue;
    }
    const item = {
      localId: crypto.randomUUID(),
      file,
      title: "",
      kind: inferKind(file),
      status: "staged",
      progress: 0,
      error: "",
      assetId: "",
      xhr: null,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
    };
    stage.push(item);
  }
  if (oversized) toast(`${oversized} file${oversized === 1 ? "" : "s"} over 95 MB skipped.`, "bad");
  if (skipped) toast("Skipped duplicates already in the batch.");
  renderQueue();
  syncBatchActions();
}

function clearStaged() {
  for (const item of [...stage]) {
    if (item.status === "staged") removeItem(item.localId);
  }
}

function removeItem(localId) {
  const index = stage.findIndex((item) => item.localId === localId);
  if (index < 0) return;
  const item = stage[index];
  if (item.status === "uploading") item.xhr?.abort();
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  stage.splice(index, 1);
  renderQueue();
  syncBatchActions();
  updateOverall();
}

function startBatch() {
  if (!token()) {
    tokenInput.focus();
    tokenOk.textContent = "Paste the upload token first.";
    tokenOk.classList.remove("hidden");
    tokenOk.classList.add("warn");
    return;
  }
  tokenOk.classList.remove("warn");
  let queued = 0;
  for (const item of stage) {
    if (item.status === "staged") {
      if (!item.kind) {
        item.status = "failed";
        item.error = "unknown type — skipped";
        continue;
      }
      item.status = "queued";
      item.progress = 0;
      item.error = "";
      queued += 1;
    }
  }
  if (!queued) {
    toast("Nothing staged to upload.");
    renderQueue();
    return;
  }
  overall.hidden = false;
  renderQueue();
  syncBatchActions();
  pump();
}

function pump() {
  for (const item of stage) {
    if (uploading >= CONCURRENCY) break;
    if (item.status === "queued") startUpload(item);
  }
  updateOverall();
  syncBatchActions();
}

function startUpload(item) {
  uploading += 1;
  item.status = "uploading";
  item.progress = 0;
  renderQueue();
  const xhr = new XMLHttpRequest();
  item.xhr = xhr;
  xhr.open("POST", api("/upload"));
  xhr.setRequestHeader("Authorization", `Bearer ${token()}`);
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      item.progress = Math.round((event.loaded / event.total) * 100);
      renderQueue();
      updateOverall();
    }
  };
  xhr.onload = async () => {
    uploading = Math.max(0, uploading - 1);
    item.xhr = null;
    item.progress = 100;
    if (xhr.status === 401) {
      item.status = "failed";
      item.error = "unauthorized";
      for (const other of stage) {
        if (other.localId === item.localId) continue;
        if (other.status === "queued") {
          other.status = "failed";
          other.error = "upload token rejected";
        } else if (other.status === "uploading") {
          other.xhr?.abort();
        }
      }
      tokenOk.textContent = "Token rejected. Check pass show cloudflare/media-pipeline/upload-token.";
      tokenOk.classList.remove("hidden");
      tokenOk.classList.add("warn");
      renderQueue();
      updateOverall();
      return;
    }
    if (xhr.status >= 400) {
      let message = `failed (${xhr.status})`;
      try {
        message = JSON.parse(xhr.responseText).error || message;
      } catch {
        /* keep status text */
      }
      item.status = "failed";
      item.error = message;
      renderQueue();
      pump();
      return;
    }
    let asset;
    try {
      asset = JSON.parse(xhr.responseText);
    } catch {
      item.status = "failed";
      item.error = "bad response";
      renderQueue();
      pump();
      return;
    }
    item.assetId = asset.id;
    if (asset.status === "ready") {
      item.status = "ready";
      await loadGallery({ mode: "refresh", silent: true });
      renderQueue();
      pump();
      return;
    }
    item.status = "processing";
    await loadGallery({ mode: "refresh", silent: true });
    watch(asset.id, item);
    renderQueue();
    pump();
  };
  xhr.onerror = () => {
    uploading = Math.max(0, uploading - 1);
    item.xhr = null;
    item.status = "failed";
    item.error = "network error";
    renderQueue();
    pump();
  };
  xhr.onabort = () => {
    uploading = Math.max(0, uploading - 1);
    item.xhr = null;
    if (item.status === "uploading") {
      item.status = "failed";
      item.error = "canceled";
    }
    renderQueue();
    pump();
  };
  const form = new FormData();
  form.set("file", item.file);
  const title = item.title.trim() || titleInput.value.trim();
  if (title) form.set("title", title);
  if (item.kind) form.set("kind", item.kind);
  xhr.send(form);
}

function retryItem(item) {
  if (item.status !== "failed") return;
  if (!item.kind) {
    toast(`${item.file.name} has no known type.`);
    return;
  }
  item.status = "queued";
  item.error = "";
  item.progress = 0;
  overall.hidden = false;
  renderQueue();
  pump();
}

function watch(id, queueItem) {
  if (inflight.has(id)) return;
  const timer = setInterval(async () => {
    const response = await fetch(api(`/assets/${id}/status`));
    if (!response.ok) return;
    const data = await response.json();
    if (data.status === "ready" || data.status === "failed") {
      clearInterval(timer);
      inflight.delete(id);
      if (queueItem) {
        queueItem.status = data.status;
        queueItem.error = data.status === "failed" ? data.error || "processing failed" : "";
        renderQueue();
        updateOverall();
      }
      await loadGallery({ mode: "refresh", silent: true });
    }
  }, POLL_MS);
  inflight.set(id, timer);
}

async function loadGallery({ mode = "reset", silent = false } = {}) {
  const params = new URLSearchParams();
  if (kindFilter) params.set("kind", kindFilter);
  if (query) params.set("q", query);
  if (mode === "reset") offset = 0;
  const limit = mode === "refresh" ? Math.min(100, Math.max(PAGE, assets.length || PAGE)) : PAGE;
  const start = mode === "more" ? offset : 0;
  params.set("limit", String(limit));
  params.set("offset", String(start));
  const response = await fetch(api(`/assets?${params}`));
  if (!response.ok) {
    if (!silent) count.textContent = "Could not load the library.";
    return;
  }
  const data = await response.json();
  const page = data.assets ?? [];
  total = data.total ?? page.length;
  counts = data.counts ?? counts;
  assets = mode === "more" ? assets.concat(page) : page;
  offset = assets.length;
  paintCounts();
  const shown = assets.length;
  count.textContent = total
    ? `${shown} of ${total} item${total === 1 ? "" : "s"}${query ? ` matching “${query}”` : ""}`
    : "";
  empty.classList.toggle("hidden", shown > 0);
  gallery.replaceChildren(...assets.map(card));
  moreBtn.classList.toggle("hidden", shown >= total);
  for (const asset of assets) {
    if (asset.status === "uploaded" || asset.status === "processing") watch(asset.id);
  }
}

function paintCounts() {
  for (const node of document.querySelectorAll("[data-count]")) {
    const key = node.dataset.count;
    node.textContent = String(counts[key] ?? 0);
  }
}

function card(asset) {
  const button = document.createElement("button");
  button.className = "card";
  button.type = "button";
  button.addEventListener("click", () => openDetail(asset.id));
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (asset.kind === "image") {
    const img = document.createElement("img");
    img.alt = asset.title ?? "";
    img.loading = "lazy";
    img.src = asset.urls?.thumbnail || asset.urls?.original;
    img.onerror = () => {
      img.onerror = null;
      img.src = asset.urls?.original;
    };
    thumb.append(img);
  } else {
    const glyph = document.createElement("span");
    glyph.className = "kind-glyph";
    glyph.textContent = asset.kind;
    thumb.append(glyph);
  }
  if (asset.status === "uploaded" || asset.status === "processing") {
    const bar = document.createElement("div");
    bar.className = "card-progress";
    const span = document.createElement("span");
    bar.append(span);
    thumb.append(bar);
  }
  const body = document.createElement("div");
  body.className = "card-body";
  const title = document.createElement("strong");
  title.textContent = asset.title || asset.filename;
  const badge = document.createElement("span");
  badge.className = `badge ${asset.status}`;
  badge.textContent = `${asset.kind} · ${asset.status}`;
  body.append(title, badge);
  const side = document.createElement("div");
  side.className = "card-side";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "link";
  copy.textContent = "Copy URL";
  copy.addEventListener("click", (event) => {
    event.stopPropagation();
    copyText(asset.urls?.original ?? "", "Original URL copied.");
  });
  side.append(copy);
  button.append(thumb, body, side);
  return button;
}

async function openDetail(id) {
  activeId = id;
  const response = await fetch(api(`/assets/${id}`));
  if (!response.ok) {
    toast("Asset not found.", "bad");
    return;
  }
  const asset = await response.json();
  $("d-kind").textContent = `${asset.kind} · ${asset.status}`;
  $("d-title").textContent = asset.title || asset.filename;
  $("d-meta").textContent = `${asset.filename} · ${formatBytes(asset.size)} · ${formatWhen(asset.created_at)} · ${asset.id}`;
  const media = $("d-media");
  media.replaceChildren();
  const wrap = $("d-text-wrap");
  const text = $("d-text");
  wrap.classList.add("hidden");
  text.textContent = "";

  if (asset.kind === "image") {
    const img = document.createElement("img");
    img.alt = asset.title ?? "";
    img.src = asset.urls?.display || asset.urls?.original;
    img.onerror = () => {
      img.onerror = null;
      img.src = asset.urls?.original;
    };
    media.append(img);
  } else if (asset.kind === "video") {
    const video = document.createElement("video");
    video.controls = true;
    video.src = asset.urls?.original;
    media.append(video);
  } else if (asset.kind === "audio") {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = asset.urls?.original;
    if (asset.urls?.vtt) {
      const track = document.createElement("track");
      track.kind = "captions";
      track.src = api(`/assets/${id}/vtt`);
      track.default = true;
      audio.append(track);
    }
    media.append(audio);
  } else if (asset.kind === "pdf") {
    const frame = document.createElement("iframe");
    frame.title = asset.title || asset.filename;
    frame.src = asset.urls?.original;
    media.append(frame);
  }

  if (asset.kind === "pdf" && asset.status === "ready") {
    const markdown = await fetch(api(`/assets/${id}/markdown`));
    if (markdown.ok) {
      $("d-text-label").textContent = "Markdown";
      text.textContent = await markdown.text();
      wrap.classList.remove("hidden");
    }
  }
  if (asset.kind === "audio" && asset.status === "ready") {
    const transcript = await fetch(api(`/assets/${id}/transcript`));
    if (transcript.ok) {
      $("d-text-label").textContent = "Transcript";
      text.textContent = await transcript.text();
      wrap.classList.remove("hidden");
    }
  }

  const urls = $("d-urls");
  urls.replaceChildren();
  for (const [name, href] of Object.entries(asset.urls ?? {})) {
    if (!href) continue;
    const dt = document.createElement("dt");
    dt.textContent = name;
    const dd = document.createElement("dd");
    const a = document.createElement("a");
    a.href = href;
    a.textContent = href;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "link copy-mini";
    copy.textContent = "copy";
    copy.addEventListener("click", () => copyText(href, `${name} copied.`));
    dd.append(a, copy);
    urls.append(dt, dd);
  }
  if (!detail.open) detail.showModal();
}

function stepDetail(delta) {
  if (!assets.length) return;
  const index = assets.findIndex((asset) => asset.id === activeId);
  const next = assets[(index + delta + assets.length) % assets.length];
  if (next) openDetail(next.id);
}

function copyDetailText() {
  copyText($("d-text").textContent, "Copied.");
}

function renderQueue() {
  queueEl.replaceChildren(
    ...stage.map((item) => {
      const li = document.createElement("li");
      const thumb = document.createElement("div");
      thumb.className = "thumb-sm";
      if (item.previewUrl) {
        const img = document.createElement("img");
        img.alt = "";
        img.src = item.previewUrl;
        thumb.append(img);
      } else {
        thumb.textContent = item.kind ?? "?";
      }
      const meta = document.createElement("div");
      meta.className = "meta";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = item.file.name;
      const sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = statusLine(item);
      const bar = document.createElement("div");
      bar.className = item.status === "processing" ? "bar pulse" : "bar";
      const fill = document.createElement("span");
      fill.style.width = item.status === "processing" ? "100%" : `${item.progress}%`;
      bar.append(fill);
      meta.append(name, sub, bar);
      if (item.status === "staged") {
        const title = document.createElement("input");
        title.className = "title-mini";
        title.type = "text";
        title.placeholder = "Title (optional)";
        title.value = item.title;
        title.addEventListener("input", () => {
          item.title = title.value;
        });
        title.addEventListener("click", (event) => event.stopPropagation());
        meta.append(title);
      }
      const actions = document.createElement("div");
      actions.className = "item-actions";
      if (item.status === "staged" || item.status === "failed" || item.status === "ready") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "link";
        remove.textContent = "remove";
        remove.addEventListener("click", () => removeItem(item.localId));
        actions.append(remove);
      }
      if (item.status === "failed") {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "link";
        retry.textContent = "retry";
        retry.addEventListener("click", () => retryItem(item));
        actions.append(retry);
      }
      if (item.status === "uploading" || item.status === "queued") {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "link";
        cancel.textContent = "cancel";
        cancel.addEventListener("click", () => {
          if (item.status === "queued") {
            item.status = "failed";
            item.error = "canceled";
            renderQueue();
            updateOverall();
            return;
          }
          item.xhr?.abort();
        });
        actions.append(cancel);
      }
      li.append(thumb, meta, actions);
      return li;
    }),
  );
  const staged = stage.filter((item) => item.status === "staged").length;
  const live = stage.filter((item) => item.status === "queued" || item.status === "uploading" || item.status === "processing").length;
  batchCount.textContent = stage.length
    ? `${stage.length} file${stage.length === 1 ? "" : "s"}${live ? ` · ${live} in flight` : ""}`
    : "Empty";
  uploadBtn.textContent = staged ? `Upload ${staged}` : "Upload";
  updateOverall();
}

function statusLine(item) {
  const size = formatBytes(item.file.size);
  const kind = item.kind ?? "unknown";
  if (item.status === "staged") return `${kind} · ${size}`;
  if (item.status === "queued") return `${kind} · queued`;
  if (item.status === "uploading") return `${kind} · uploading ${item.progress}%`;
  if (item.status === "processing") return `${kind} · transcribing / parsing`;
  if (item.status === "ready") return `${kind} · ready`;
  return `${kind} · ${item.error || "failed"}`;
}

function updateOverall() {
  const batch = stage.filter((item) => item.status !== "staged");
  if (!batch.length) {
    overall.hidden = true;
    return;
  }
  overall.hidden = false;
  const totalBytes = batch.reduce((sum, item) => sum + item.file.size, 0) || 1;
  const loadedBytes = batch.reduce((sum, item) => {
    if (item.status === "ready" || item.status === "processing" || item.status === "failed") return sum + item.file.size;
    return sum + Math.round((item.file.size * item.progress) / 100);
  }, 0);
  const pct = Math.min(100, Math.round((loadedBytes / totalBytes) * 100));
  const done = batch.filter((item) => item.status === "ready" || item.status === "failed").length;
  const processing = batch.filter((item) => item.status === "processing").length;
  const failed = batch.filter((item) => item.status === "failed").length;
  overallBar.style.width = `${pct}%`;
  overallPct.textContent = `${pct}%`;
  overallLabel.textContent = processing
    ? "Uploading · derivatives running"
    : failed && done === batch.length
      ? "Batch finished with errors"
      : done === batch.length
        ? "Batch complete"
        : "Uploading";
  overallFiles.textContent = `${done} of ${batch.length} finished${processing ? ` · ${processing} processing` : ""}${
    failed ? ` · ${failed} failed` : ""
  }`;
}

function syncBatchActions() {
  const staged = stage.some((item) => item.status === "staged");
  uploadBtn.disabled = !staged;
  clearStagedBtn.disabled = !staged;
}

function setView(next, { persist = true } = {}) {
  view = next;
  gallery.classList.toggle("list", view === "list");
  $("view-grid").classList.toggle("on", view === "grid");
  $("view-list").classList.toggle("on", view === "list");
  $("view-grid").setAttribute("aria-pressed", String(view === "grid"));
  $("view-list").setAttribute("aria-pressed", String(view === "list"));
  if (persist) localStorage.setItem(VIEW_KEY, view);
}

function toast(message, kind = "") {
  const node = document.createElement("div");
  node.className = kind === "bad" ? "toast bad" : "toast";
  node.textContent = message;
  $("toasts").append(node);
  window.setTimeout(() => node.remove(), 4200);
}

async function copyText(value, ok) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast(ok);
  } catch {
    toast("Could not copy.", "bad");
  }
}

function formatBytes(size) {
  if (!size) return "unknown size";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

loadGallery({ mode: "reset" }).catch((error) => {
  count.textContent = error.message;
});
