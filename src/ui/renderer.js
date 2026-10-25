const $ = (id) => document.getElementById(id);
const api = window.fractur;

const DEFAULT_SERVERS = [
  { name: "Hypixel", ip: "mc.hypixel.net" },
  { name: "Minemen Club", ip: "minemen.club" },
  { name: "PvP Legacy", ip: "pvplegacy.net" },
  { name: "CrixSMP", ip: "crixsmp.suhosting.net" },
  { name: "BedwarsPractice", ip: "bedwarspractice.club" },
];

const NEWS = [
  { title: "Fracture Client 1.0", body: "Microsoft login, auto Java, Fabric performance mods and one-click server joins.", tag: "NEW" },
  { title: "TikTok in the side panel", body: "Log in once, scroll with ↑ ↓ and pause with Space without leaving the launcher." },
  { title: "Tuned for PvP", body: "G1GC flags and Sodium, Lithium and Entity Culling installed for you on modern versions." },
];

let settings;
let account = null;
let running = false;

function loadServers() {
  let list;
  try { list = JSON.parse(localStorage.getItem("servers")) || DEFAULT_SERVERS; } catch { list = DEFAULT_SERVERS; }
  // Older saves still have Lunar in CrixSMP's slot
  return list.map((s) => (s.ip === "lunar.gg" ? DEFAULT_SERVERS[3] : s));
}
function saveServers(list) {
  try { localStorage.setItem("servers", JSON.stringify(list)); } catch {}
}

/* Window + navigation */
document.querySelectorAll("[data-win]").forEach((b) => b.addEventListener("click", () => api.window(b.dataset.win)));

document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab, .page").forEach((el) => el.classList.remove("active"));
    tab.classList.add("active");
    $(tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "capes") openAccTab(document.querySelector(".acc-tab.active").dataset.atab);
    if (tab.dataset.tab === "mods") {
      if ($("mtab-installed").classList.contains("active")) renderMods();
      else searchMods();
    }
  })
);

function openModal(id) { $(id).classList.remove("hidden"); }
document.querySelectorAll(".modal").forEach((m) => {
  m.addEventListener("mousedown", (e) => { if (e.target === m) m.classList.add("hidden"); });
  m.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => m.classList.add("hidden")));
});
$("settingsBtn").onclick = () => openModal("settingsModal");
$("consoleBtn").onclick = () => openModal("consoleModal");
$("versionBtn").onclick = () => openModal("versionModal");
$("addServerBtn").onclick = () => openModal("serverModal");

/* Status */
function setStatus(text, progress) {
  $("statusText").textContent = text;
  const bar = $("bar");
  if (progress == null) {
    bar.classList.toggle("indeterminate", !/^(Ready|Playing|Error|Game closed|Login failed|Offline)/.test(text));
    bar.style.width = "";
  } else {
    bar.classList.remove("indeterminate");
    bar.style.width = `${Math.round(progress * 100)}%`;
  }
}

function updateHero() {
  if (!account) {
    $("heroMsg").textContent = "You're not logged in. Log in to start using Fracture.";
    $("playBtn").textContent = "LOG IN";
  } else {
    $("heroMsg").textContent = `Minecraft ${settings.version} · ${settings.loader === "fabric" ? "Fabric" : "Vanilla"}`;
    $("playBtn").textContent = running ? "RUNNING" : "PLAY";
  }
  $("playBtn").disabled = running;
}

/* Account */
async function renderAccount() {
  account = await api.getAccount();
  if (account) {
    $("chipHead").src = `https://mc-heads.net/avatar/${account.uuid}/36`;
    $("chipSub").textContent = "Signed in";
    $("chipName").textContent = account.name;
    $("skin").src = `https://mc-heads.net/body/${account.uuid}/300`;
    $("skin").classList.remove("hidden");
    $("sideLogo").classList.add("hidden");
    $("sideName").textContent = account.name;
  } else {
    $("chipHead").removeAttribute("src");
    $("chipSub").textContent = "Not signed in";
    $("chipName").textContent = "Guest User";
    $("skin").classList.add("hidden");
    $("sideLogo").classList.remove("hidden");
    $("sideName").textContent = "";
  }
  updateHero();
}

/* Account switcher */
function toggleSwitcher(open) {
  $("switcher").classList.toggle("open", open);
  if (open) renderSwitcher();
}

async function renderSwitcher() {
  const list = await api.listAccounts();
  const wrap = $("swList");
  wrap.innerHTML = list.length ? "" : `<div class="sw-empty">No Accounts</div>`;
  for (const a of list) {
    const el = document.createElement("div");
    el.className = `sw-acc${a.active ? " active" : ""}`;
    el.innerHTML = `<img alt="" /><div class="nm"><span></span><small></small></div><button class="rm" title="Remove">✕</button>`;
    el.querySelector("img").src = `https://mc-heads.net/avatar/${a.uuid}/36`;
    el.querySelector("span").textContent = a.name;
    el.querySelector("small").textContent = a.active ? "Active · Microsoft" : "Microsoft";
    el.onclick = async () => {
      await api.selectAccount(a.uuid);
      await renderAccount();
      renderSwitcher();
    };
    el.querySelector(".rm").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove ${a.name}?`)) return;
      await api.removeAccount(a.uuid);
      await renderAccount();
      renderSwitcher();
    };
    wrap.appendChild(el);
  }
}

function login() {
  toggleSwitcher(true);
}

$("accountChip").onclick = () => toggleSwitcher(!$("switcher").classList.contains("open"));
$("swClose").onclick = () => toggleSwitcher(false);

$("swAdd").onclick = async () => {
  $("swAdd").disabled = true;
  try {
    setStatus("Waiting for Microsoft login...");
    await api.login();
    setStatus("Ready");
  } catch (e) {
    setStatus(`Login failed: ${cleanError(e)}`);
  }
  $("swAdd").disabled = false;
  await renderAccount();
  renderSwitcher();
};

/* Add account via link (device code) */
let linkInfo = null;

function closeLink() {
  $("linkOverlay").classList.add("hidden");
  linkInfo = null;
  api.deviceCancel();
}

async function copyCode() {
  if (!linkInfo) return;
  try { await navigator.clipboard.writeText(linkInfo.code); } catch {}
  $("linkCode").querySelector(".copy-ico").textContent = "✓";
  setTimeout(() => ($("linkCode").querySelector(".copy-ico").textContent = "⧉"), 1200);
}

$("swAddLink").onclick = async () => {
  $("linkOverlay").classList.remove("hidden");
  $("linkCodeText").textContent = "········";
  $("linkQr").removeAttribute("src");
  $("linkText").textContent = "Getting a code...";
  try {
    linkInfo = await api.deviceStart();
  } catch (e) {
    $("linkText").textContent = `Couldn't get a code: ${cleanError(e)}`;
    return;
  }
  $("linkQr").src = linkInfo.qr;
  $("linkCodeText").textContent = linkInfo.code;
  $("linkText").innerHTML = `To sign in, use a web browser to open the page <a href="#" id="linkUrl"></a> and enter the code <b></b> to authenticate.`;
  $("linkUrl").textContent = linkInfo.url;
  $("linkText").querySelector("b").textContent = linkInfo.code;
  $("linkUrl").onclick = (e) => { e.preventDefault(); api.openExternal(linkInfo.url); };
};

$("linkCode").onclick = copyCode;
$("linkOpen").onclick = async () => {
  if (!linkInfo) return;
  await copyCode();
  api.openExternal(linkInfo.url);
};
$("linkClose").onclick = closeLink;

api.on("device-done", async (acc) => {
  $("linkOverlay").classList.add("hidden");
  linkInfo = null;
  setStatus(`Signed in as ${acc.name}`);
  await renderAccount();
  renderSwitcher();
});
api.on("device-error", (msg) => {
  if (!linkInfo) return;
  $("linkText").textContent = `Login failed: ${msg}`;
});

/* News */
function renderNews() {
  const wrap = $("news");
  for (const n of NEWS) {
    const el = document.createElement("div");
    el.className = "news-item";
    el.innerHTML = `${n.tag ? `<span class="tag">${n.tag}</span>` : ""}<b></b><p></p>`;
    el.querySelector("b").textContent = n.title;
    el.querySelector("p").textContent = n.body;
    wrap.appendChild(el);
  }
}

/* Servers */
function renderServers() {
  const list = loadServers();
  const wrap = $("serverList");
  wrap.innerHTML = "";
  list.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "srv";
    row.title = `Join ${s.ip}`;
    row.innerHTML = `<span class="noicon"></span><span class="name"></span><span class="count"><span class="dot"></span><span class="n">…</span></span><button class="del" title="Remove">✕</button>`;
    row.querySelector(".name").textContent = s.name;
    row.onclick = () => play(s.ip);
    row.querySelector(".del").onclick = (e) => {
      e.stopPropagation();
      list.splice(i, 1);
      saveServers(list);
      renderServers();
    };
    wrap.appendChild(row);

    api.ping(s.ip).then((r) => {
      row.querySelector(".n").textContent = r.online ? r.players.toLocaleString() : "offline";
      row.querySelector(".dot").classList.toggle("on", r.online);
      if (r.icon) {
        const img = document.createElement("img");
        img.src = r.icon;
        row.querySelector(".noicon").replaceWith(img);
      }
    });
  });
}

$("addServer").addEventListener("submit", (e) => {
  e.preventDefault();
  const list = loadServers();
  list.push({ name: $("srvName").value.trim(), ip: $("srvIp").value.trim() });
  saveServers(list);
  $("srvName").value = $("srvIp").value = "";
  $("serverModal").classList.add("hidden");
  renderServers();
});

/* Mods */
async function renderMods() {
  $("modsVersion").textContent = settings.version;
  const list = await api.listMods(settings.version);
  const wrap = $("modList");
  wrap.innerHTML = list.length ? "" : `<p class="muted">No mods yet for ${settings.version}. Install some from Modrinth or launch once on Fabric to get the performance pack.</p>`;
  for (const m of list) {
    const el = document.createElement("div");
    el.className = `mod${m.enabled ? "" : " off"}`;
    el.innerHTML = `<div class="mod-icon"></div><div class="mod-info"><b></b><small></small></div><div class="mod-side"><button class="del" title="Delete">🗑</button><button class="switch${m.enabled ? " on" : ""}"></button></div>`;
    if (m.icon) el.querySelector(".mod-icon").style.backgroundImage = `url("${m.icon}")`;
    else el.querySelector(".mod-icon").textContent = m.name.charAt(0).toUpperCase();
    el.querySelector("b").textContent = m.name;
    el.querySelector("small").textContent = m.authors.join(", ");
    el.querySelector(".switch").onclick = async () => {
      await api.toggleMod(settings.version, m.file);
      renderMods();
    };
    el.querySelector(".del").onclick = async () => {
      if (!confirm(`Delete ${m.name}?`)) return;
      await api.deleteMod(settings.version, m.file);
      renderMods();
    };
    wrap.appendChild(el);
  }
}
$("openModsBtn").onclick = () => api.openMods(settings.version);

document.querySelectorAll(".mod-tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".mod-tab").forEach((x) => x.classList.toggle("active", x === t));
    document.querySelectorAll("#mods .mtab").forEach((p) => p.classList.toggle("active", p.id === `mtab-${t.dataset.mtab}`));
    if (t.dataset.mtab === "installed") renderMods();
    else if (t.dataset.mtab === "import") renderImports();
    else searchMods();
  })
);

function formatCount(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
}

let searchToken = 0;
async function searchMods() {
  const token = ++searchToken;
  const wrap = $("modResults");
  $("modsVersion").textContent = settings.version;
  wrap.innerHTML = `<p class="muted">Searching...</p>`;
  let hits;
  try {
    hits = await api.searchModrinth($("modSearch").value.trim(), settings.version);
  } catch (e) {
    wrap.innerHTML = `<p class="muted">Couldn't reach Modrinth: ${cleanError(e)}</p>`;
    return;
  }
  if (token !== searchToken) return;
  const installed = (await api.listMods(settings.version)).map((m) => m.fileName.toLowerCase());
  wrap.innerHTML = hits.length ? "" : `<p class="muted">No Fabric mods found for ${settings.version}.</p>`;
  for (const h of hits) {
    const el = document.createElement("div");
    el.className = "mr";
    el.innerHTML = `${h.icon ? `<img alt="" />` : `<span class="noicon"></span>`}<div class="info"><b></b><span class="by"></span><p></p></div><span class="dl"></span><button class="install">INSTALL</button>`;
    if (h.icon) el.querySelector("img").src = h.icon;
    el.querySelector("b").textContent = h.title;
    el.querySelector(".by").textContent = `by ${h.author}`;
    el.querySelector("p").textContent = h.description;
    el.querySelector(".dl").textContent = `⬇ ${formatCount(h.downloads)}`;
    const btn = el.querySelector(".install");
    if (installed.some((n) => n.startsWith(h.slug.toLowerCase()))) {
      btn.textContent = "INSTALLED";
      btn.disabled = true;
    }
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "...";
      try {
        await api.installModrinth(h.id, settings.version);
        btn.textContent = "INSTALLED";
      } catch (e) {
        btn.textContent = "FAILED";
        btn.title = cleanError(e);
        btn.disabled = false;
      }
    };
    wrap.appendChild(el);
  }
}

/* Drag and drop into the Mods tab */
let dragDepth = 0;
const modsPage = $("mods");
modsPage.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; $("dropZone").classList.remove("hidden"); });
modsPage.addEventListener("dragover", (e) => e.preventDefault());
modsPage.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("dropZone").classList.add("hidden"); } });
modsPage.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("dropZone").classList.add("hidden");
  const files = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
  if (!files.length) return;
  try {
    const r = await api.addFiles(settings.version, files);
    setStatus(`Added ${r.mods} mod(s) and ${r.packs} resource pack(s) to ${settings.version}`);
  } catch (err) {
    setStatus(`Error: ${cleanError(err)}`);
  }
  document.querySelector('[data-mtab="installed"]').click();
});

/* Profile import */
function versionOptions(selected) {
  return [...$("version").options].map((o) => `<option${o.value === selected ? " selected" : ""}>${o.value}</option>`).join("");
}

function afterImport(r) {
  if (!r) return;
  if (r.version) {
    settings.version = r.version;
    settings.loader = "fabric";
    $("version").value = r.version;
    $("loader").value = "fabric";
    saveSettings();
  }
  setStatus(`Imported ${r.mods || 0} mods, ${r.resourcepacks || 0} resource packs into ${r.version}`);
  document.querySelector('[data-mtab="installed"]').click();
}

async function renderImports() {
  const wrap = $("importList");
  wrap.innerHTML = `<p class="muted">Scanning...</p>`;
  const found = await api.scanImports();
  wrap.innerHTML = found.length ? "" : `<p class="muted">No profiles from other launchers found. Use the import buttons above.</p>`;
  for (const p of found) {
    const el = document.createElement("div");
    el.className = "mr";
    el.innerHTML = `<span class="src"></span><div class="info"><b></b><p></p></div><select></select><button class="install">IMPORT</button>`;
    el.querySelector(".src").textContent = p.source.toUpperCase();
    el.querySelector("b").textContent = p.name;
    el.querySelector("p").textContent = `${p.mods} mods${p.modsOnly ? "" : " · resource packs · shaders · settings"}`;
    const sel = el.querySelector("select");
    sel.innerHTML = versionOptions(p.version || settings.version);
    const btn = el.querySelector(".install");
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "...";
      try {
        const r = await api.runImport(p.gameDir, sel.value, !!p.modsOnly);
        btn.textContent = "DONE";
        afterImport({ ...r, version: sel.value });
      } catch (e) {
        btn.textContent = "FAILED";
        btn.title = cleanError(e);
        btn.disabled = false;
      }
    };
    wrap.appendChild(el);
  }
}

$("rescanBtn").onclick = renderImports;
$("importFileBtn").onclick = async () => {
  try { afterImport(await api.importFile(settings.version)); } catch (e) { setStatus(`Error: ${cleanError(e)}`); }
};
$("importFolderBtn").onclick = async () => {
  try { afterImport(await api.importFolder(settings.version)); } catch (e) { setStatus(`Error: ${cleanError(e)}`); }
};

/* Accessories */
const webPanes = {};

function openAccTab(name) {
  document.querySelectorAll(".acc-tab").forEach((x) => x.classList.toggle("active", x.dataset.atab === name));
  document.querySelectorAll(".apane").forEach((p) => p.classList.toggle("active", p.id === `atab-${name}`));
  const pane = $(`atab-${name}`);
  if (pane.classList.contains("web-pane")) ensureWebPane(pane);
  if (name === "skins") renderSkins();
  if (name === "capes") { renderCapes(); renderCapeLib(); }
}
document.querySelectorAll(".acc-tab").forEach((t) => t.addEventListener("click", () => openAccTab(t.dataset.atab)));

// Embedded site with a small toolbar; created on first open
function ensureWebPane(pane) {
  if (webPanes[pane.id]) return;
  pane.innerHTML = `<div class="web-bar"><button class="icon-btn" data-act="back" title="Back">‹</button><button class="icon-btn" data-act="reload" title="Reload">⟳</button><span class="web-hint"></span>${pane.dataset.save ? `<button class="pill save-btn" disabled>SAVE THIS SKIN</button>` : ""}</div>`;
  pane.querySelector(".web-hint").textContent = pane.dataset.hint;
  const view = document.createElement("webview");
  view.setAttribute("partition", pane.dataset.part);
  view.setAttribute("allowpopups", "");
  view.src = pane.dataset.src;
  pane.appendChild(view);
  webPanes[pane.id] = view;
  pane.querySelector("[data-act=back]").onclick = () => view.canGoBack() && view.goBack();
  pane.querySelector("[data-act=reload]").onclick = () => view.reload();

  const save = pane.querySelector(".save-btn");
  if (save) {
    const update = () => { save.disabled = !/namemc\.com\/(skin|profile)\//.test(view.getURL()); };
    view.addEventListener("did-navigate", update);
    view.addEventListener("did-navigate-in-page", update);
    save.onclick = () => saveNameMcSkin(view, save);
  }
}

// NameMC serves skin textures at s.namemc.com/i/<hash>.png
async function saveNameMcSkin(view, btn) {
  const url = view.getURL();
  let hash = (url.match(/namemc\.com\/skin\/([0-9a-f]{16})/) || [])[1];
  let name = "NameMC skin";
  const profile = url.match(/namemc\.com\/profile\/([^/.?#]+)/);
  if (!hash && profile) {
    name = decodeURIComponent(profile[1]);
    hash = await view.executeJavaScript(`(() => { const a = document.querySelector('a[href^="/skin/"]'); return a ? a.getAttribute("href").split("/")[2] : ""; })()`);
  } else {
    const title = await view.executeJavaScript("document.title");
    if (title) name = title.split("|")[0].replace(/Minecraft Skin/i, "").trim() || name;
  }
  if (!hash) { setStatus("Open a skin or player page first"); return; }
  btn.disabled = true;
  btn.textContent = "SAVING...";
  try {
    await api.libraryAddUrl("skins", `https://s.namemc.com/i/${hash}.png`, name);
    btn.textContent = "SAVED ✓";
  } catch (e) {
    btn.textContent = "FAILED";
    setStatus(`Couldn't save skin: ${cleanError(e)}`);
  }
  setTimeout(() => { btn.textContent = "SAVE THIS SKIN"; btn.disabled = false; }, 1500);
}

// Draws the front of a skin (or a cape) from its texture
function renderTexture(canvas, data, kind, slim) {
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = img.width / 64;
    if (kind === "capes") {
      ctx.drawImage(img, 1 * s, 1 * s, 10 * s, 16 * s, 0, 0, canvas.width, canvas.height);
      return;
    }
    const legacy = img.height === img.width / 2;
    const u = canvas.width / 16;
    const arm = slim ? 3 : 4;
    const part = (sx, sy, w, h, dx, dy) => ctx.drawImage(img, sx * s, sy * s, w * s, h * s, dx * u, dy * u, w * u, h * u);
    const mirrored = (sx, sy, w, h, dx, dy) => {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx * s, sy * s, w * s, h * s, -(dx + w) * u, dy * u, w * u, h * u);
      ctx.restore();
    };
    part(8, 8, 8, 8, 4, 0); // head
    part(20, 20, 8, 12, 4, 8); // body
    part(44, 20, arm, 12, 4 - arm, 8); // right arm
    part(4, 20, 4, 12, 4, 20); // right leg
    if (legacy) {
      // 64x32 skins reuse the right limbs, mirrored, for the left side
      mirrored(44, 20, arm, 12, 12, 8);
      mirrored(4, 20, 4, 12, 8, 20);
    } else {
      part(36, 52, arm, 12, 12, 8);
      part(20, 52, 4, 12, 8, 20);
      // Second layer (jacket, sleeves, pants)
      part(20, 36, 8, 12, 4, 8);
      part(44, 36, arm, 12, 4 - arm, 8);
      part(52, 52, arm, 12, 12, 8);
      part(4, 36, 4, 12, 4, 20);
      part(4, 52, 4, 12, 8, 20);
    }
    part(40, 8, 8, 8, 4, 0); // hat
  };
  img.src = data;
}

function libraryCard(kind, item, onUse, useLabel) {
  const el = document.createElement("div");
  el.className = "lib-card";
  const [w, h] = kind === "skins" ? [96, 192] : [60, 96];
  el.innerHTML = `<canvas width="${w}" height="${h}"></canvas><input class="lib-name" maxlength="40" /><div class="lib-row">${kind === "skins" ? `<button class="lib-slim" title="Arm style"></button>` : ""}<button class="lib-btn use"></button><button class="lib-btn ghosty" data-act="export" title="Export">⤓</button><button class="lib-btn ghosty" data-act="del" title="Delete">🗑</button></div>`;
  renderTexture(el.querySelector("canvas"), item.data, kind, item.slim);
  const name = el.querySelector(".lib-name");
  name.value = item.name;
  name.onchange = () => api.libraryUpdate(kind, item.id, { name: name.value.trim() || item.name });
  const slim = el.querySelector(".lib-slim");
  if (slim) {
    slim.textContent = item.slim ? "SLIM" : "CLASSIC";
    slim.onclick = async () => {
      item.slim = !item.slim;
      await api.libraryUpdate(kind, item.id, { slim: item.slim });
      slim.textContent = item.slim ? "SLIM" : "CLASSIC";
      renderTexture(el.querySelector("canvas"), item.data, kind, item.slim);
    };
  }
  const use = el.querySelector(".use");
  use.textContent = useLabel;
  use.onclick = () => onUse(use);
  el.querySelector("[data-act=export]").onclick = () => api.libraryExport(kind, item.id);
  el.querySelector("[data-act=del]").onclick = async () => {
    if (!confirm(`Delete ${item.name}?`)) return;
    await api.libraryDelete(kind, item.id);
    if (kind === "skins") renderSkins();
    else renderCapeLib();
  };
  return el;
}

async function renderSkins() {
  const wrap = $("skinList");
  const list = await api.libraryList("skins");
  wrap.innerHTML = list.length ? "" : `<p class="muted">No skins yet. Import a PNG, make one in Skin Creator, or grab one from Skin Finder.</p>`;
  for (const item of list) {
    wrap.appendChild(libraryCard("skins", item, async (btn) => {
      if (!account) { setStatus("Log in to change your skin"); return login(); }
      btn.disabled = true;
      btn.textContent = "...";
      try {
        await api.applySkin(item.id);
        btn.textContent = "WEARING ✓";
        setStatus(`Now wearing ${item.name}`);
        setTimeout(renderAccount, 2500);
      } catch (e) {
        btn.textContent = "WEAR";
        setStatus(`Error: ${cleanError(e)}`);
      }
      btn.disabled = false;
    }, "WEAR"));
  }
}

async function renderCapeLib() {
  const wrap = $("capeLib");
  const list = await api.libraryList("capes");
  wrap.innerHTML = list.length ? "" : `<p class="muted">No saved capes yet.</p>`;
  for (const item of list) {
    wrap.appendChild(libraryCard("capes", item, () => {
      openAccTab("capefinder");
      webPanes["atab-capefinder"].loadURL("https://minecraftcapes.net/user");
      setStatus("Upload the cape on your MinecraftCapes profile (export it first with ⤓)");
    }, "UPLOAD"));
  }
}

$("importSkinBtn").onclick = async () => { if (await api.libraryImport("skins")) renderSkins(); };
$("importCapeBtn").onclick = async () => { if (await api.libraryImport("capes")) renderCapeLib(); };
api.on("library-changed", (kind) => {
  if (kind === "skins" && $("atab-skins").classList.contains("active")) renderSkins();
  if (kind === "capes" && $("atab-capes").classList.contains("active")) renderCapeLib();
});

async function renderCapes() {
  const wrap = $("capeList");
  if (!account) {
    wrap.innerHTML = `<p class="muted">Log in to see the capes on your account.</p>`;
    return;
  }
  wrap.innerHTML = `<p class="muted">Loading capes...</p>`;
  let capes;
  try {
    capes = await api.ownedCapes();
  } catch (e) {
    wrap.innerHTML = `<p class="muted">Couldn't load capes: ${cleanError(e)}</p>`;
    return;
  }
  wrap.innerHTML = "";
  const items = [{ id: null, name: "No cape", active: !capes.some((c) => c.active) }, ...capes];
  for (const c of items) {
    const el = document.createElement("button");
    el.className = `cape${c.active ? " active" : ""}`;
    el.innerHTML = `<div class="art${c.url ? "" : " none"}"></div><span></span>`;
    if (c.url) el.querySelector(".art").style.backgroundImage = `url("${c.url.replace(/^http:/, "https:")}")`;
    el.querySelector("span").textContent = c.name;
    el.onclick = async () => {
      try {
        await api.equipCape(c.id);
        setStatus(c.id ? `Now wearing ${c.name}` : "Cape removed");
        renderCapes();
      } catch (e) {
        setStatus(`Error: ${cleanError(e)}`);
      }
    };
    wrap.appendChild(el);
  }
  if (!capes.length) wrap.insertAdjacentHTML("beforeend", `<p class="muted" style="grid-column:1/-1">This account doesn't own any official capes yet. Check the SHOP tab for codes.</p>`);
}

$("capesModBtn").onclick = async () => {
  const btn = $("capesModBtn");
  btn.disabled = true;
  btn.textContent = "INSTALLING...";
  try {
    await api.installModrinth("capes", settings.version);
    btn.textContent = `CAPES MOD INSTALLED (${settings.version})`;
  } catch (e) {
    btn.textContent = "INSTALL CAPES MOD";
    btn.disabled = false;
    setStatus(`Capes mod: ${cleanError(e)}`);
  }
};

let searchTimer;
$("modSearch").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchMods, 300);
});

/* Settings */
function bindSetting(id, key, type = "value") {
  const el = $(id);
  el[type] = settings[key];
  el.addEventListener("change", () => {
    settings[key] = type === "checked" ? el.checked : el.type === "number" || el.type === "range" ? Number(el.value) : el.value;
    if (key === "ramMax") settings.ramMin = Math.min(2, settings.ramMax);
    saveSettings();
  });
}

function saveSettings() {
  $("ramLabel").textContent = `${settings.ramMax} GB`;
  document.querySelectorAll(".quick-versions button").forEach((b) => b.classList.toggle("active", b.dataset.v === settings.version));
  updateHero();
  api.setSettings(settings);
}

document.querySelectorAll(".quick-versions button").forEach((b) =>
  b.addEventListener("click", () => {
    settings.version = b.dataset.v;
    $("version").value = b.dataset.v;
    saveSettings();
    $("versionModal").classList.add("hidden");
  })
);
$("openFolder").onclick = () => api.openFolder();

/* Launch */
function cleanError(e) {
  return (e && e.message ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

async function play(server) {
  if (!account) return login();
  if (running) return;
  running = true;
  $("crash").classList.add("hidden");
  updateHero();
  document.querySelector('[data-tab="play"]').click();
  try {
    await api.launch({ server });
  } catch (e) {
    setStatus(`Error: ${cleanError(e)}`);
    running = false;
    updateHero();
  }
}

$("playBtn").addEventListener("click", () => play());

api.on("status", ({ text, progress }) => setStatus(text, progress));
api.on("game-closed", () => { running = false; updateHero(); });

/* Crash screen */
function describeFix(f) {
  const name = f.name || f.modId;
  return f.type === "install" ? `install ${name}` : f.type === "update" ? `update ${name}` : `turn off ${name}`;
}

api.on("game-crashed", ({ fixes }) => {
  document.querySelector('[data-tab="play"]').click();
  $("crash").classList.remove("hidden");
  $("fixBtn").disabled = !fixes.length;
  $("fixBtn").textContent = "FIX";
  $("crashInfo").textContent = fixes.length
    ? `Fix will ${fixes.map(describeFix).join(", ")}.`
    : "No automatic fix found for this crash. Check the log for details.";
});

$("fixBtn").onclick = async () => {
  $("fixBtn").disabled = true;
  $("fixBtn").textContent = "FIXING...";
  try {
    const { applied } = await api.fixCrash();
    $("crash").classList.add("hidden");
    setStatus(applied.length ? `${applied.join(" · ")}. Press Play to try again` : "Nothing to fix");
  } catch (e) {
    $("crashInfo").textContent = `Fix failed: ${cleanError(e)}`;
    $("fixBtn").textContent = "FIX";
    $("fixBtn").disabled = false;
  }
};
$("crashDismiss").onclick = () => $("crash").classList.add("hidden");
$("crashDetails").onclick = () => openModal("consoleModal");
api.on("log", (line) => {
  const log = $("log");
  log.textContent += line + "\n";
  if (log.textContent.length > 200000) log.textContent = log.textContent.slice(-150000);
  log.scrollTop = log.scrollHeight;
});

/* Side panel: TikTok, Spotify, Instagram */
let tiktok = null;
const SIDE_APPS = {
  tiktok: { url: "https://www.tiktok.com/foryou", zoom: 0.8 },
  spotify: { url: "https://open.spotify.com/", zoom: 0.55 },
  instagram: { url: "https://www.instagram.com/", zoom: 0.7 },
};
const sideViews = {};

function showSide(name) {
  document.querySelectorAll(".side-tab").forEach((t) => t.classList.toggle("active", t.dataset.side === name));
  document.querySelectorAll(".side-pane").forEach((p) => p.classList.toggle("active", p.id === `side-${name}`));
  const appInfo = SIDE_APPS[name];
  if (appInfo && !sideViews[name]) {
    // Created on first open so nothing loads (or plays audio) until asked for.
    // Each app keeps its own saved login.
    const view = document.createElement("webview");
    view.setAttribute("partition", `persist:${name}`);
    view.setAttribute("allowpopups", "");
    view.src = appInfo.url;
    view.addEventListener("dom-ready", () => view.setZoomFactor(appInfo.zoom));
    $(`side-${name}`).prepend(view);
    sideViews[name] = view;
    if (name === "tiktok") tiktok = view;
  }
}
document.querySelectorAll(".side-tab").forEach((t) => t.addEventListener("click", () => showSide(t.dataset.side)));

const TT_KEYS = { ArrowUp: "Up", ArrowDown: "Down", " ": "Space" };

// While the TikTok panel is open, route ↑ ↓ and Space to it from anywhere in the launcher
document.addEventListener("keydown", (e) => {
  if (!tiktok || !$("side-tiktok").classList.contains("active")) return;
  if (!(e.key in TT_KEYS)) return;
  if (e.target.closest("input, select, textarea") || document.querySelector(".modal:not(.hidden)")) return;
  e.preventDefault();
  const keyCode = TT_KEYS[e.key];
  tiktok.focus();
  tiktok.sendInputEvent({ type: "keyDown", keyCode });
  if (keyCode === "Space") tiktok.sendInputEvent({ type: "char", keyCode: " " });
  tiktok.sendInputEvent({ type: "keyUp", keyCode });
});

/* Init */
(async function init() {
  settings = await api.getSettings();
  bindSetting("version", "version");
  bindSetting("loader", "loader");
  bindSetting("ramMax", "ramMax");
  bindSetting("width", "width");
  bindSetting("height", "height");
  bindSetting("fullscreen", "fullscreen", "checked");
  bindSetting("pvpMods", "pvpMods", "checked");
  bindSetting("closeOnLaunch", "closeOnLaunch", "checked");
  bindSetting("jvmArgs", "jvmArgs");
  saveSettings();
  renderNews();
  renderServers();
  renderAccount();

  const sel = $("version");
  sel.innerHTML = `<option>${settings.version}</option>`;
  try {
    const versions = await api.versions();
    sel.innerHTML = "";
    for (const v of versions) {
      const o = document.createElement("option");
      o.value = o.textContent = v;
      sel.appendChild(o);
    }
    sel.value = settings.version;
  } catch {
    setStatus("Offline: couldn't load version list");
  }
})();
