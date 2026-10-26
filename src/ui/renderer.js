const $ = (id) => document.getElementById(id);
const api = window.fractur;
document.body.classList.add(`platform-${api.platform}`);

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
let launching = false; // true only while a game is being set up
let gamesRunning = 0;

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
    if (tab.dataset.group) openAccGroup(tab.dataset.group);
    if (tab.dataset.tab === "profiles") renderProfilesPage();
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
    $("heroMsg").textContent = `Minecraft ${prof().version} · ${prof().loader === "fabric" ? "Fabric" : "Vanilla"}`;
    $("playBtn").textContent = launching ? "STARTING..." : gamesRunning ? `PLAY (${gamesRunning} OPEN)` : "PLAY";
  }
  $("playBtn").disabled = launching;
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
  if (open && $("themePanel").classList.contains("open")) closeThemePanel(false);
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
function renderNewsItems(items) {
  const wrap = $("news");
  wrap.innerHTML = "";
  for (const n of items) {
    const el = document.createElement("div");
    el.className = "news-item";
    // Posts come from the internet, so everything goes in as text, never HTML
    if (n.tag) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = n.tag;
      if (/^#[0-9a-f]{6}$/i.test(n.tagColor || "")) tag.style.background = n.tagColor;
      el.appendChild(tag);
    }
    const title = document.createElement("b");
    title.textContent = n.title || "";
    const body = document.createElement("p");
    body.textContent = n.body || "";
    el.append(title, body);
    if (/^https:\/\//.test(n.image || "")) {
      el.classList.add("has-image");
      el.style.backgroundImage = `linear-gradient(180deg, rgba(10,10,14,.1), rgba(10,10,14,.92)), url("${encodeURI(n.image)}")`;
    }
    if (/^https:\/\//.test(n.link || "")) {
      el.classList.add("clickable");
      el.title = n.link;
      el.onclick = () => api.openNewsLink(n.link);
    }
    wrap.appendChild(el);
  }
}

async function renderNews() {
  renderNewsItems(NEWS);
  try {
    const remote = await api.getNews();
    if (Array.isArray(remote) && remote.length) renderNewsItems(remote);
  } catch {}
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
    if (s.icon) {
      const img = document.createElement("img");
      img.src = `data:image/png;base64,${s.icon}`;
      row.querySelector(".noicon").replaceWith(img);
    }
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
      if (r.icon && row.querySelector(".noicon")) {
        const img = document.createElement("img");
        img.src = r.icon;
        row.querySelector(".noicon").replaceWith(img);
      }
    });
  });
}

// Adds servers saved in any profile (or other launcher) that aren't in the list yet.
// Each address is only imported once, so removing one keeps it removed.
async function importSavedServers() {
  let saved;
  try { saved = await api.savedServers(); } catch { return; }
  let imported;
  try { imported = new Set(JSON.parse(localStorage.getItem("importedServers")) || []); } catch { imported = new Set(); }
  const list = loadServers();
  const have = new Set(list.map((s) => s.ip.toLowerCase()));
  let added = 0;
  for (const s of saved) {
    const key = s.ip.toLowerCase();
    if (imported.has(key)) continue;
    imported.add(key);
    if (have.has(key)) continue;
    list.push({ name: s.name, ip: s.ip, icon: s.icon || undefined });
    have.add(key);
    added++;
  }
  try { localStorage.setItem("importedServers", JSON.stringify([...imported])); } catch {}
  if (added) {
    saveServers(list);
    renderServers();
    setStatus(`Added ${added} saved server${added === 1 ? "" : "s"} from your profiles`);
  }
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
  $("modsVersion").textContent = `${prof().name} (${prof().version})`;
  const list = await api.listMods(prof().id);
  const wrap = $("modList");
  wrap.innerHTML = list.length ? "" : `<p class="muted">No mods in ${prof().name} yet. Install some from Modrinth or launch once on Fabric to get the performance pack.</p>`;
  for (const m of list) {
    const el = document.createElement("div");
    el.className = `mod${m.enabled ? "" : " off"}`;
    el.innerHTML = `<div class="mod-icon"></div><div class="mod-info"><b></b><small></small></div><div class="mod-side"><button class="del" title="Delete">🗑</button><button class="switch${m.enabled ? " on" : ""}"></button></div>`;
    if (m.icon) el.querySelector(".mod-icon").style.backgroundImage = `url("${m.icon}")`;
    else el.querySelector(".mod-icon").textContent = m.name.charAt(0).toUpperCase();
    el.querySelector("b").textContent = m.name;
    el.querySelector("small").textContent = m.authors.join(", ");
    el.querySelector(".switch").onclick = async () => {
      await api.toggleMod(prof().id, m.file);
      renderMods();
    };
    el.querySelector(".del").onclick = async () => {
      if (!confirm(`Delete ${m.name}?`)) return;
      await api.deleteMod(prof().id, m.file);
      renderMods();
    };
    wrap.appendChild(el);
  }
}
$("openModsBtn").onclick = () => api.openMods(prof().id);

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

/* Modrinth browser */
const browse = { type: "mod", categories: new Set(), page: 0, total: 0 };
const TYPE_WORDS = { mod: "mods", modpack: "modpacks", resourcepack: "resource packs", shader: "shaders" };

function timeAgo(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

async function loadCategories() {
  const wrap = $("mbCats");
  wrap.innerHTML = "";
  let cats = [];
  try { cats = await api.modrinthCategories(browse.type); } catch {}
  for (const c of cats) {
    const label = document.createElement("label");
    label.className = "mb-cat";
    label.innerHTML = `<input type="checkbox" /><span></span>`;
    label.querySelector("span").textContent = c.replace(/-/g, " ");
    const box = label.querySelector("input");
    box.checked = browse.categories.has(c);
    box.onchange = () => {
      if (box.checked) browse.categories.add(c); else browse.categories.delete(c);
      browse.page = 0;
      searchMods();
    };
    wrap.appendChild(label);
  }
}

document.querySelectorAll(".mb-type").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".mb-type").forEach((x) => x.classList.toggle("active", x === b));
  browse.type = b.dataset.type;
  browse.categories.clear();
  browse.page = 0;
  $("modSearch").placeholder = `Search ${TYPE_WORDS[browse.type]}...`;
  loadCategories();
  searchMods();
}));
$("mbSort").onchange = () => { browse.page = 0; searchMods(); };
$("mbLimit").onchange = () => { browse.page = 0; searchMods(); };
document.querySelectorAll(".mb-pages button").forEach((b) => b.addEventListener("click", () => {
  const pages = Math.max(1, Math.ceil(browse.total / Number($("mbLimit").value)));
  const to = { first: 0, prev: browse.page - 1, next: browse.page + 1, last: pages - 1 }[b.dataset.page];
  if (to < 0 || to >= pages || to === browse.page) return;
  browse.page = to;
  searchMods();
  $("mbScroll").scrollTop = 0;
}));

// Shared install handler for rows and trending cards
async function installHit(h, btn) {
  btn.disabled = true;
  const label = btn.querySelector(".lbl");
  label.textContent = "Installing...";
  try {
    const r = await api.installProject(h.id, prof().id, browse.type);
    if (browse.type === "modpack" && r && r.profileId) {
      await switchProfile(r.profileId);
      setStatus(`Installed ${h.title} as the new profile "${r.name}"`);
    }
    label.textContent = "Installed";
    btn.classList.add("done");
  } catch (e) {
    label.textContent = "Failed";
    btn.title = cleanError(e);
    btn.disabled = false;
  }
}

function installButton(h, installed) {
  const btn = document.createElement("button");
  btn.className = "mb-install";
  btn.innerHTML = `<span class="ico">⤓</span><span class="lbl"></span>`;
  btn.querySelector(".lbl").textContent = installed ? "Installed" : "Install";
  if (installed) { btn.disabled = true; btn.classList.add("done"); }
  btn.onclick = (e) => { e.stopPropagation(); installHit(h, btn); };
  return btn;
}

function iconEl(h, cls) {
  if (h.icon) {
    const img = document.createElement("img");
    img.className = cls;
    img.src = h.icon;
    img.alt = "";
    return img;
  }
  const span = document.createElement("span");
  span.className = `${cls} noicon`;
  span.textContent = h.title.charAt(0).toUpperCase();
  return span;
}

let searchToken = 0;
async function searchMods() {
  const token = ++searchToken;
  const wrap = $("modResults");
  const query = $("modSearch").value.trim();
  const limit = Number($("mbLimit").value);
  $("modsVersion").textContent = `${prof().name} (${prof().version})`;
  $("mbVersion").textContent = `Minecraft ${prof().version}${browse.type === "mod" || browse.type === "modpack" ? " · Fabric" : ""}`;
  wrap.innerHTML = `<p class="muted">Searching...</p>`;
  let res;
  try {
    res = await api.browseModrinth({ type: browse.type, query, sort: $("mbSort").value, limit, offset: browse.page * limit, categories: [...browse.categories], profileId: prof().id });
  } catch (e) {
    wrap.innerHTML = `<p class="muted">Couldn't reach Modrinth: ${cleanError(e)}</p>`;
    return;
  }
  if (token !== searchToken) return;
  browse.total = res.total;
  const pages = Math.max(1, Math.ceil(res.total / limit));
  $("mbCount").textContent = `${res.total.toLocaleString()} results`;
  $("mbPage").textContent = `${browse.page + 1} / ${pages.toLocaleString()}`;

  const installed = browse.type === "mod" ? (await api.listMods(prof().id)).map((m) => m.fileName.toLowerCase()) : [];
  const isInstalled = (h) => installed.some((n) => n.startsWith(h.slug.toLowerCase()));

  // Trending strip: the most-liked picks, only on the first page of an unfiltered browse
  const showTrending = browse.page === 0 && !query && browse.categories.size === 0;
  $("mbTrendingWrap").classList.toggle("hidden", !showTrending);
  if (showTrending) {
    api.browseModrinth({ type: browse.type, sort: "follows", limit: 4, profileId: prof().id }).then((t) => {
      if (token !== searchToken) return;
      const tw = $("mbTrending");
      tw.innerHTML = "";
      for (const h of t.hits) {
        const card = document.createElement("div");
        card.className = "mb-tcard";
        const head = document.createElement("div");
        head.className = "mb-thead";
        head.appendChild(iconEl(h, "mb-ticon"));
        const txt = document.createElement("div");
        txt.className = "mb-ttext";
        txt.innerHTML = `<b></b><small></small>`;
        txt.querySelector("b").textContent = h.title;
        txt.querySelector("small").textContent = h.description;
        head.appendChild(txt);
        card.append(head, installButton(h, isInstalled(h)));
        tw.appendChild(card);
      }
    }).catch(() => {});
  }

  wrap.innerHTML = res.hits.length ? "" : `<p class="muted">No ${TYPE_WORDS[browse.type]} found for ${prof().version}.</p>`;
  for (const h of res.hits) {
    const row = document.createElement("div");
    row.className = "mb-row";
    row.appendChild(iconEl(h, "mb-icon"));
    const info = document.createElement("div");
    info.className = "mb-info";
    info.innerHTML = `<div class="mb-title"><b></b><span class="by"></span></div><p></p>`;
    info.querySelector("b").textContent = h.title;
    info.querySelector(".by").textContent = `by ${h.author}`;
    info.querySelector("p").textContent = h.description;
    const side = document.createElement("div");
    side.className = "mb-side";
    const stats = document.createElement("div");
    stats.className = "mb-stats";
    stats.innerHTML = `<span title="Downloads">⤓ <i></i></span><span title="Likes">♥ <i></i></span><span title="Last updated">◷ <i></i></span>`;
    const [d, f, u] = stats.querySelectorAll("i");
    d.textContent = formatCount(h.downloads);
    f.textContent = formatCount(h.follows);
    u.textContent = timeAgo(h.updated);
    side.append(installButton(h, isInstalled(h)), stats);
    row.append(info, side);
    wrap.appendChild(row);
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
    const r = await api.addFiles(prof().id, files);
    setStatus(`Added ${r.mods} mod(s) and ${r.packs} resource pack(s) to ${prof().name}`);
  } catch (err) {
    setStatus(`Error: ${cleanError(err)}`);
  }
  document.querySelector('[data-mtab="installed"]').click();
});

/* Profile import */
function versionOptions(selected) {
  return [...$("version").options].map((o) => `<option${o.value === selected ? " selected" : ""}>${o.value}</option>`).join("");
}

async function afterImport(r) {
  if (!r) return;
  if (r.profileId) await switchProfile(r.profileId);
  setStatus(`Imported ${r.mods || 0} mods, ${r.resourcepacks || 0} resource packs into the new profile "${r.name}"`);
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
    sel.innerHTML = versionOptions(p.version || prof().version);
    const btn = el.querySelector(".install");
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "...";
      try {
        const r = await api.runImport(p.gameDir, sel.value, !!p.modsOnly, `${p.source} ${p.name}`);
        btn.textContent = "DONE";
        afterImport(r);
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
  try { afterImport(await api.importFile(prof().id)); } catch (e) { setStatus(`Error: ${cleanError(e)}`); }
};
$("importFolderBtn").onclick = async () => {
  try { afterImport(await api.importFolder(prof().id)); } catch (e) { setStatus(`Error: ${cleanError(e)}`); }
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

// The Skins and Capes top tabs share one page; each shows only its own sub-tabs
// and comes back to whichever sub-tab was open last.
const lastAccTab = { skins: "skins", capes: "capes" };
function openAccGroup(group) {
  document.querySelectorAll(".acc-tab").forEach((t) => t.classList.toggle("hidden", t.dataset.group !== group));
  openAccTab(lastAccTab[group]);
}
document.querySelectorAll(".acc-tab").forEach((t) => t.addEventListener("click", () => { lastAccTab[t.dataset.group] = t.dataset.atab; }));

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
  wrap.innerHTML = list.length ? "" : `<div class="lib-empty">No skins yet<small>Import a PNG, make one in Skin Creator, or grab one from Skin Finder.</small></div>`;
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
  wrap.innerHTML = list.length ? "" : `<div class="lib-empty small">No saved capes yet<small>Save one from Cape Maker or Cape Finder.</small></div>`;
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
    await api.installModrinth("capes", prof().id);
    btn.textContent = `CAPES MOD INSTALLED (${prof().name})`;
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
  updateHero();
  api.setSettings(settings);
}

/* Profiles */
let profiles = { active: null, list: [] };

function prof() {
  return profiles.list.find((p) => p.id === profiles.active) || profiles.list[0] || { id: "1.21.4", name: "1.21.4 Fabric", version: "1.21.4", loader: "fabric" };
}

async function loadProfiles() {
  profiles = await api.listProfiles();
  $("profileBtnName").textContent = prof().name;
  $("profileBtnSub").textContent = `${prof().version} · ${prof().loader === "fabric" ? "Fabric" : "Vanilla"}`;
  updateHero();
  if ($("profiles").classList.contains("active")) renderProfilesPage();
}

async function switchProfile(id) {
  await api.selectProfile(id);
  await loadProfiles();
  if ($("mods").classList.contains("active")) {
    if ($("mtab-installed").classList.contains("active")) renderMods();
    else if ($("mtab-browse").classList.contains("active")) searchMods();
  }
}

let editingProfile = null; // null = list view, {} = new, profile = edit

function renderProfiles() {
  const wrap = $("profileList");
  $("profileEditor").classList.toggle("hidden", !editingProfile);
  wrap.classList.toggle("hidden", !!editingProfile);
  $("newProfileBtn").classList.toggle("hidden", !!editingProfile);
  if (editingProfile) return;
  wrap.innerHTML = "";
  for (const p of profiles.list) {
    const el = document.createElement("div");
    el.className = `profile${p.id === profiles.active ? " active" : ""}`;
    el.innerHTML = `<div class="p-ico"></div><div class="p-info"><b></b><small></small></div><div class="p-acts"><button data-act="edit" title="Edit">✎</button><button data-act="dup" title="Duplicate">⧉</button><button data-act="open" title="Open folder">📁</button><button data-act="del" title="Delete">🗑</button></div>`;
    el.querySelector(".p-ico").textContent = (p.name.match(/[a-z0-9]/i) || ["?"])[0].toUpperCase();
    el.querySelector("b").textContent = p.name;
    el.querySelector("small").textContent = `Minecraft ${p.version} · ${p.loader === "fabric" ? "Fabric" : "Vanilla"}${p.id === profiles.active ? " · Selected" : ""}`;
    el.onclick = async (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === "edit") { editingProfile = p; fillProfileForm(p); return renderProfiles(); }
      if (act === "dup") { await api.duplicateProfile(p.id); await loadProfiles(); setStatus(`Duplicated ${p.name}`); return renderProfiles(); }
      if (act === "open") return api.openProfile(p.id);
      if (act === "del") {
        if (!confirm(`Delete the profile "${p.name}"? Its folder (mods, worlds, screenshots) goes to the Recycle Bin.`)) return;
        try { await api.deleteProfile(p.id); } catch (err) { return setStatus(`Error: ${cleanError(err)}`); }
        await loadProfiles();
        return renderProfiles();
      }
      await switchProfile(p.id);
      renderProfiles();
      $("versionModal").classList.add("hidden");
      setStatus(`Switched to ${p.name}`);
    };
    wrap.appendChild(el);
  }
}

function fillProfileForm(p) {
  $("profName").value = p.name || "";
  $("version").value = p.version || prof().version;
  $("profLoader").value = p.loader || "fabric";
  $("profTitle").textContent = p.id ? "EDIT PROFILE" : "NEW PROFILE";
}

$("profileBtn").onclick = () => { editingProfile = null; renderProfiles(); openModal("versionModal"); };
$("newProfileBtn").onclick = () => { editingProfile = {}; fillProfileForm({ name: "", version: prof().version, loader: "fabric" }); renderProfiles(); $("profName").focus(); };
$("profCancel").onclick = () => { editingProfile = null; renderProfiles(); };
$("profSave").onclick = async () => {
  const data = { name: $("profName").value.trim(), version: $("version").value, loader: $("profLoader").value };
  try {
    if (editingProfile.id) await api.updateProfile(editingProfile.id, data);
    else await switchProfile((await api.createProfile(data)).id);
  } catch (e) {
    return setStatus(`Error: ${cleanError(e)}`);
  }
  editingProfile = null;
  await loadProfiles();
  renderProfiles();
};
$("openFolder").onclick = () => api.openFolder();

/* Profiles page */
function lastPlayedText(ts) {
  if (!ts) return "Never played";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "Played just now";
  if (mins < 60) return `Played ${mins}m ago`;
  if (mins < 1440) return `Played ${Math.floor(mins / 60)}h ago`;
  return `Played ${Math.floor(mins / 1440)}d ago`;
}

async function renderProfilesPage() {
  const grid = $("profileGrid");
  let stats = {};
  try { stats = await api.profileStats(); } catch {}
  grid.innerHTML = "";
  for (const p of profiles.list) {
    const st = stats[p.id] || {};
    const card = document.createElement("div");
    card.className = `pf-card${p.id === profiles.active ? " active" : ""}`;
    card.innerHTML = `
      <div class="pf-top"><div class="pf-ico"></div><div class="pf-name"><b></b><small></small></div></div>
      <div class="pf-stats"><span><i class="m"></i> mods</span><span><i class="r"></i> packs</span><span><i class="s"></i> shaders</span></div>
      <div class="pf-last"></div>
      <div class="pf-actions">
        <button class="pf-play">▶ PLAY</button>
        <button class="pf-btn" data-act="edit" title="Edit">✎</button>
        <button class="pf-btn" data-act="dup" title="Duplicate">⧉</button>
        <button class="pf-btn" data-act="open" title="Open folder">📁</button>
        <button class="pf-btn danger" data-act="del" title="Delete">🗑</button>
      </div>`;
    card.querySelector(".pf-ico").textContent = (p.name.match(/[a-z0-9]/i) || ["?"])[0].toUpperCase();
    card.querySelector("b").textContent = p.name;
    card.querySelector("small").textContent = `Minecraft ${p.version} · ${p.loader === "fabric" ? "Fabric" : "Vanilla"}${p.id === profiles.active ? " · Selected" : ""}`;
    card.querySelector(".m").textContent = st.mods ?? 0;
    card.querySelector(".r").textContent = st.packs ?? 0;
    card.querySelector(".s").textContent = st.shaders ?? 0;
    card.querySelector(".pf-last").textContent = lastPlayedText(st.lastPlayed);

    card.querySelector(".pf-play").onclick = async (e) => {
      e.stopPropagation();
      await switchProfile(p.id);
      play(undefined, p.id);
    };
    card.querySelectorAll(".pf-btn").forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      const act = b.dataset.act;
      if (act === "edit") {
        editingProfile = p;
        fillProfileForm(p);
        renderProfiles();
        openModal("versionModal");
      } else if (act === "dup") {
        await api.duplicateProfile(p.id);
        await loadProfiles();
        renderProfilesPage();
        setStatus(`Duplicated ${p.name}`);
      } else if (act === "open") {
        api.openProfile(p.id);
      } else if (act === "del") {
        if (!confirm(`Delete the profile "${p.name}"? Its folder (mods, worlds, screenshots) goes to the Recycle Bin.`)) return;
        try { await api.deleteProfile(p.id); } catch (err) { return setStatus(`Error: ${cleanError(err)}`); }
        await loadProfiles();
        renderProfilesPage();
      }
    }));
    // Clicking the card itself selects the profile
    card.onclick = async () => {
      await switchProfile(p.id);
      renderProfilesPage();
      setStatus(`Selected ${p.name}`);
    };
    grid.appendChild(card);
  }
  const add = document.createElement("button");
  add.className = "pf-card pf-new";
  add.innerHTML = `<span>+</span><b>New profile</b>`;
  add.onclick = () => $("profilesNewBtn").click();
  grid.appendChild(add);
}

$("profilesNewBtn").onclick = () => {
  editingProfile = {};
  fillProfileForm({ name: "", version: prof().version, loader: "fabric" });
  renderProfiles();
  openModal("versionModal");
  $("profName").focus();
};

/* Launch */
function cleanError(e) {
  return (e && e.message ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

async function play(server, profileId) {
  if (!account) return login();
  if (launching) return;
  launching = true;
  $("crash").classList.add("hidden");
  updateHero();
  document.querySelector('[data-tab="play"]').click();
  try {
    await api.launch({ server, profileId });
  } catch (e) {
    setStatus(`Error: ${cleanError(e)}`);
  }
  launching = false;
  updateHero();
}

$("playBtn").addEventListener("click", () => play());

api.on("status", ({ text, progress }) => setStatus(text, progress));
api.on("game-started", (d) => { gamesRunning = d.running; updateHero(); });
api.on("game-closed", (d) => { gamesRunning = d.running; updateHero(); });

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

/* Theme customizer */
const DEFAULT_THEME = { mode: "dark", colors: ["#ff3b4e", "#ff7a3b"], intensity: 0, angle: 135, font: "Segoe UI", icons: "classic", buttonSize: 100 };
const THEME_FONTS = ["Segoe UI", "Minecraft", "Bahnschrift", "Trebuchet MS", "Verdana", "Tahoma", "Georgia", "Consolas", "Lucida Console", "Franklin Gothic Medium", "Segoe Print", "Comic Sans MS", "Impact"];
const ICON_SETS = {
  classic: { play: "▶", profiles: "▤", mods: "▦", skins: "☻", capes: "◭" },
  emoji: { play: "🎮", profiles: "🗂", mods: "🧩", skins: "👕", capes: "🧣" },
  none: { play: "", profiles: "", mods: "", skins: "", capes: "" },
};
const BASES = {
  dark: { bg: "#07070a", panel: "#111116", panel2: "#18181f", line: "#22222c", text: "#ececf1", muted: "#7d7d8c", card: "#0d0d12" },
  light: { bg: "#eeeef3", panel: "#ffffff", panel2: "#e9e9f0", line: "#d6d6e0", text: "#15151c", muted: "#686876", card: "#f5f5f8" },
};

let theme = { ...DEFAULT_THEME };
let draft = null;
let activeStop = 0;

const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbToHex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); };
const rgba = (h, a) => { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; };

function hsvToHex(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
}
function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

function applyTheme(t) {
  const base = BASES[t.mode] || BASES.dark;
  const colors = t.colors.length ? t.colors : DEFAULT_THEME.colors;
  const k = t.intensity / 100;
  const root = document.documentElement.style;
  const tint = (c, amt) => mix(c, colors[0], amt);

  root.setProperty("--accent", colors[0]);
  root.setProperty("--accent2", colors[colors.length - 1]);
  root.setProperty("--text", base.text);
  root.setProperty("--muted", base.muted);
  root.setProperty("--bg", base.bg);
  // Intensity tints the background with the gradient and lets it show through the panels
  root.setProperty("--panel", k ? rgba(tint(base.panel, k * 0.15), 1 - k * 0.45) : base.panel);
  root.setProperty("--panel2", k ? rgba(tint(base.panel2, k * 0.2), 1 - k * 0.35) : base.panel2);
  root.setProperty("--card", k ? rgba(tint(base.card, k * 0.15), 1 - k * 0.4) : base.card);
  root.setProperty("--line", k ? tint(base.line, k * 0.3) : base.line);
  const stops = colors.map((c) => mix(base.bg, c, k * (t.mode === "light" ? 0.45 : 0.55)));
  root.setProperty("--bg-image", k ? `linear-gradient(${t.angle}deg, ${stops.length > 1 ? stops.join(", ") : `${stops[0]}, ${base.bg}`})` : "none");
  root.setProperty("--btn-zoom", String((t.buttonSize || 100) / 100));
  root.setProperty("--font", `"${t.font}", "Segoe UI", system-ui, sans-serif`);
  document.body.classList.toggle("light", t.mode === "light");

  const icons = ICON_SETS[t.icons] || ICON_SETS.classic;
  document.querySelectorAll(".ti").forEach((el) => (el.textContent = icons[el.dataset.i] || ""));
}

/* Panel */
function openThemePanel() {
  draft = JSON.parse(JSON.stringify(theme));
  activeStop = 0;
  $("switcher").classList.remove("open");
  $("themePanel").classList.add("open");
  syncThemeForm();
}
function closeThemePanel(apply) {
  if (apply) {
    theme = draft;
    settings.theme = theme;
    api.setSettings(settings);
    setStatus("Theme applied");
  }
  applyTheme(theme);
  draft = null;
  $("themePanel").classList.remove("open");
}

function syncThemeForm() {
  document.querySelectorAll("#tpMode button").forEach((b) => b.classList.toggle("active", b.dataset.mode === draft.mode));
  document.querySelectorAll("#tpIcons button").forEach((b) => b.classList.toggle("active", b.dataset.icons === draft.icons));
  $("tpIntensity").value = draft.intensity;
  $("tpIntensityLabel").textContent = `${draft.intensity}%`;
  $("tpAngle").value = draft.angle;
  $("tpAngleLabel").textContent = `${draft.angle}°`;
  $("tpButtons").value = draft.buttonSize || 100;
  $("tpButtonsLabel").textContent = `${draft.buttonSize || 100}%`;
  $("tpFont").value = draft.font;
  $("tpAddColor").disabled = draft.colors.length >= 4;
  renderStops();
  syncPicker();
  applyTheme(draft);
}

function renderStops() {
  const wrap = $("tpStops");
  wrap.innerHTML = "";
  draft.colors.forEach((c, i) => {
    const el = document.createElement("div");
    el.className = `stop${i === activeStop ? " active" : ""}`;
    el.innerHTML = `<span class="sw"></span><input maxlength="7" spellcheck="false" />${window.EyeDropper ? `<button data-act="pick" title="Pick from screen">⌖</button>` : ""}${draft.colors.length > 1 ? `<button data-act="del" title="Remove">✕</button>` : ""}`;
    el.querySelector(".sw").style.background = c;
    const input = el.querySelector("input");
    input.value = c.toUpperCase();
    el.onclick = (e) => { if (e.target.tagName !== "BUTTON" && activeStop !== i) { activeStop = i; renderStops(); syncPicker(); } };
    input.oninput = () => {
      if (/^#[0-9a-f]{6}$/i.test(input.value)) { draft.colors[i] = input.value.toLowerCase(); el.querySelector(".sw").style.background = input.value; syncPicker(); applyTheme(draft); }
    };
    const pick = el.querySelector("[data-act=pick]");
    if (pick) pick.onclick = async () => {
      try {
        const r = await new EyeDropper().open();
        draft.colors[i] = r.sRGBHex.toLowerCase();
        activeStop = i;
        syncThemeForm();
      } catch {}
    };
    const del = el.querySelector("[data-act=del]");
    if (del) del.onclick = () => { draft.colors.splice(i, 1); activeStop = Math.min(activeStop, draft.colors.length - 1); syncThemeForm(); };
    wrap.appendChild(el);
  });
}

let pickerHue = 0;
function syncPicker() {
  const [h, s, v] = hexToHsv(draft.colors[activeStop]);
  if (s > 0.01 && v > 0.01) pickerHue = h;
  $("tpSv").style.background = `hsl(${pickerHue}, 100%, 50%)`;
  $("tpSvKnob").style.left = `${s * 100}%`;
  $("tpSvKnob").style.top = `${(1 - v) * 100}%`;
  $("tpHueKnob").style.left = `${(pickerHue / 360) * 100}%`;
}

function setActiveColor(hex) {
  draft.colors[activeStop] = hex;
  const stop = $("tpStops").children[activeStop];
  if (stop) { stop.querySelector(".sw").style.background = hex; stop.querySelector("input").value = hex.toUpperCase(); }
  applyTheme(draft);
}

function dragOn(el, onMove) {
  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = el.getBoundingClientRect();
      onMove(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
    };
    move(e);
    el.onpointermove = move;
    el.onpointerup = () => (el.onpointermove = null);
  });
}

dragOn($("tpSv"), (x, y) => {
  $("tpSvKnob").style.left = `${x * 100}%`;
  $("tpSvKnob").style.top = `${y * 100}%`;
  setActiveColor(hsvToHex(pickerHue, x, 1 - y));
});
dragOn($("tpHue"), (x) => {
  pickerHue = x * 360;
  $("tpHueKnob").style.left = `${x * 100}%`;
  $("tpSv").style.background = `hsl(${pickerHue}, 100%, 50%)`;
  const [, s, v] = hexToHsv(draft.colors[activeStop]);
  setActiveColor(hsvToHex(pickerHue, s || 1, v || 1));
});

$("tpFont").innerHTML = THEME_FONTS.map((f) => `<option value="${f}" style="font-family:'${f}'">${f}</option>`).join("");
$("tpFont").onchange = () => { draft.font = $("tpFont").value; applyTheme(draft); };
document.querySelectorAll("#tpMode button").forEach((b) => (b.onclick = () => { draft.mode = b.dataset.mode; syncThemeForm(); }));
document.querySelectorAll("#tpIcons button").forEach((b) => (b.onclick = () => { draft.icons = b.dataset.icons; syncThemeForm(); }));
$("tpIntensity").oninput = () => { draft.intensity = Number($("tpIntensity").value); $("tpIntensityLabel").textContent = `${draft.intensity}%`; applyTheme(draft); };
$("tpButtons").oninput = () => { draft.buttonSize = Number($("tpButtons").value); $("tpButtonsLabel").textContent = `${draft.buttonSize}%`; applyTheme(draft); };
$("tpAngle").oninput = () => { draft.angle = Number($("tpAngle").value); $("tpAngleLabel").textContent = `${draft.angle}°`; applyTheme(draft); };
$("tpAddColor").onclick = () => {
  if (draft.colors.length >= 4) return;
  const [h] = hexToHsv(draft.colors[draft.colors.length - 1]);
  draft.colors.push(hsvToHex((h + 40) % 360, 0.8, 0.9));
  activeStop = draft.colors.length - 1;
  syncThemeForm();
};
$("tpSurprise").onclick = () => {
  const h = Math.random() * 360;
  const n = 2 + Math.floor(Math.random() * 2);
  draft.colors = Array.from({ length: n }, (_, i) => hsvToHex((h + i * (40 + Math.random() * 60)) % 360, 0.65 + Math.random() * 0.3, 0.75 + Math.random() * 0.25));
  draft.intensity = 40 + Math.floor(Math.random() * 50);
  draft.angle = Math.floor(Math.random() * 360);
  activeStop = 0;
  syncThemeForm();
};
$("tpReset").onclick = () => { draft = JSON.parse(JSON.stringify(DEFAULT_THEME)); activeStop = 0; syncThemeForm(); };
$("themeBtn").onclick = () => ($("themePanel").classList.contains("open") ? closeThemePanel(false) : openThemePanel());
$("themeClose").onclick = () => closeThemePanel(false);
$("tpBack").onclick = () => closeThemePanel(false);
$("tpApply").onclick = () => closeThemePanel(true);

/* Updates */
async function checkForUpdate() {
  const u = await api.checkUpdate();
  const btn = $("updateBtn");
  if (!u.available) return;
  btn.classList.remove("hidden");
  btn.title = `Version ${u.version} is out (you have ${u.current})`;
  btn.onclick = async () => {
    if (!confirm(`Update Fracture Client to version ${u.version}?

The launcher will download it and restart into the installer.`)) return;
    btn.disabled = true;
    btn.textContent = "DOWNLOADING...";
    try {
      await api.installUpdate();
      btn.textContent = "INSTALLING...";
    } catch (e) {
      setStatus(`Update failed: ${cleanError(e)}`);
      btn.disabled = false;
      btn.textContent = "⬇ UPDATE FRACTURE";
    }
  };
}

/* Init */
(async function init() {
  settings = await api.getSettings();
  theme = { ...DEFAULT_THEME, ...(settings.theme || {}) };
  applyTheme(theme);
  await loadProfiles();
  bindSetting("ramMax", "ramMax");
  bindSetting("width", "width");
  bindSetting("height", "height");
  bindSetting("fullscreen", "fullscreen", "checked");
  bindSetting("pvpMods", "pvpMods", "checked");
  bindSetting("fractureMod", "fractureMod", "checked");
  bindSetting("closeOnLaunch", "closeOnLaunch", "checked");
  bindSetting("jvmArgs", "jvmArgs");
  saveSettings();
  renderNews();
  checkForUpdate();
  importSavedServers();
  loadCategories();
  renderServers();
  renderAccount();

  const sel = $("version");
  sel.innerHTML = `<option>${prof().version}</option>`;
  try {
    const versions = await api.versions();
    sel.innerHTML = "";
    for (const v of versions) {
      const o = document.createElement("option");
      o.value = o.textContent = v;
      sel.appendChild(o);
    }
    sel.value = prof().version;
  } catch {
    setStatus("Offline: couldn't load version list");
  }
})();

// Double-click the empty part of the top bar to maximize, like a normal window
document.querySelector(".topbar").addEventListener("dblclick", (e) => {
  if (!e.target.closest("button")) api.window("max");
});
