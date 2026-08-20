const API_BASE = location.hostname === "dsamuelhodge.github.io" ? "https://ingest.hodgeluke.com" : "";
const TOKEN_KEY = "media-pipeline-upload-token";

const $ = (id) => document.getElementById(id);
const fileInput = $("file");
const drop = $("drop");
const gallery = $("gallery");
const empty = $("empty");
const count = $("count");
const queueEl = $("queue");
const queuePanel = $("queue-panel");
const tokenInput = $("token");
const detail = $("detail");
const inflight = new Map();
let kindFilter = "";

tokenInput.value = localStorage.getItem(TOKEN_KEY) ?? "";
if (tokenInput.value) $("token-ok").classList.remove("hidden");

tokenInput.addEventListener("change", () => {
  localStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
  $("token-ok").classList.toggle("hidden", !tokenInput.value.trim());
});
$("toggle-token").addEventListener("click", () => {
  const shown = tokenInput.type === "text";
  tokenInput.type = shown ? "password" : "text";
  $("toggle-token").textContent = shown ? "show" : "hide";
});

$("browse").addEventListener("click", () => fileInput.click());
$("refresh").addEventListener("click", loadGallery);
$("close").addEventListener("click", () => detail.close());
detail.addEventListener("click", (event) => {
  if (event.target === detail) detail.close();
});

drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("over");
  uploadFiles(event.dataTransfer?.files);
});
fileInput.addEventListener("change", () => {
  uploadFiles(fileInput.files);
  fileInput.value = "";
});

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((node) => node.classList.remove("on"));
    chip.classList.add("on");
    kindFilter = chip.dataset.kind ?? "";
    loadGallery();
  });
}

function api(path) {
  return `${API_BASE}${path}`;
}

function authHeaders() {
  const token = tokenInput.value.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function loadGallery() {
  const query = kindFilter ? `?kind=${encodeURIComponent(kindFilter)}&limit=100` : "?limit=100";
  const response = await fetch(api(`/assets${query}`));
  const data = await response.json();
  const assets = data.assets ?? [];
  count.textContent = assets.length ? `${assets.length} item${assets.length === 1 ? "" : "s"}` : "";
  empty.classList.toggle("hidden", assets.length > 0);
  gallery.replaceChildren(...assets.map(card));
  for (const asset of assets) {
    if (asset.status === "uploaded" || asset.status === "processing") watch(asset.id);
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
    thumb.textContent = asset.kind;
  }
  const body = document.createElement("div");
  body.className = "card-body";
  body.innerHTML = `<strong>${escapeHtml(asset.title || asset.filename)}</strong>
    <span class="badge ${asset.status}">${asset.kind} · ${asset.status}</span>`;
  button.append(thumb, body);
  return button;
}

async function openDetail(id) {
  const asset = await (await fetch(api(`/assets/${id}`))).json();
  $("d-kind").textContent = `${asset.kind} · ${asset.status}`;
  $("d-title").textContent = asset.title || asset.filename;
  $("d-meta").textContent = `${asset.filename} · ${formatBytes(asset.size)} · ${asset.id}`;
  const media = $("d-media");
  media.replaceChildren();
  const text = $("d-text");
  text.classList.add("hidden");
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
  }

  if (asset.kind === "pdf" && asset.status === "ready") {
    const markdown = await fetch(api(`/assets/${id}/markdown`));
    if (markdown.ok) {
      text.textContent = await markdown.text();
      text.classList.remove("hidden");
    }
  }
  if (asset.kind === "audio" && asset.status === "ready") {
    const transcript = await fetch(api(`/assets/${id}/transcript`));
    if (transcript.ok) {
      text.textContent = await transcript.text();
      text.classList.remove("hidden");
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
    dd.append(a);
    urls.append(dt, dd);
  }
  detail.showModal();
}

function uploadFiles(fileList) {
  if (!fileList?.length) return;
  const token = tokenInput.value.trim();
  if (!token) {
    tokenInput.focus();
    $("token-ok").textContent = "Paste the upload token first.";
    $("token-ok").classList.remove("hidden");
    $("token-ok").style.color = "var(--bad)";
    return;
  }
  $("token-ok").style.color = "";
  queuePanel.classList.remove("hidden");
  for (const file of fileList) uploadOne(file, token);
}

function uploadOne(file, token) {
  const item = document.createElement("li");
  item.innerHTML = `<div>${escapeHtml(file.name)}</div><div class="bar"><span></span></div>`;
  queueEl.prepend(item);
  const bar = item.querySelector("span");
  const xhr = new XMLHttpRequest();
  xhr.open("POST", api("/upload"));
  xhr.setRequestHeader("Authorization", `Bearer ${token}`);
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) bar.style.width = `${Math.round((event.loaded / event.total) * 100)}%`;
  };
  xhr.onload = async () => {
    bar.style.width = "100%";
    if (xhr.status >= 400) {
      item.querySelector("div").textContent = `${file.name} — failed`;
      return;
    }
    const asset = JSON.parse(xhr.responseText);
    if (asset.status === "ready") {
      item.querySelector("div").textContent = `${file.name} — ready`;
      await loadGallery();
      return;
    }
    item.querySelector("div").textContent = `${file.name} — processing`;
    await loadGallery();
    watch(asset.id, item);
  };
  xhr.onerror = () => {
    item.querySelector("div").textContent = `${file.name} — network error`;
  };
  const form = new FormData();
  form.set("file", file);
  const title = $("title").value.trim();
  if (title) form.set("title", title);
  xhr.send(form);
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
        queueItem.querySelector("div").textContent += ` — ${data.status}`;
      }
      await loadGallery();
    }
  }, 2000);
  inflight.set(id, timer);
}

function formatBytes(size) {
  if (!size) return "unknown size";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

loadGallery().catch((error) => {
  count.textContent = error.message;
});
