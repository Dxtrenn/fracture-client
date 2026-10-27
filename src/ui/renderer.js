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

/* Styled confirm dialog (replaces the plain Windows popup) */
let dlgResolve = null;
let dlgInputMode = false;
function ask({ title, message = "", ok = "OK", danger = false, icon, input }) {
  if (dlgResolve) dlgResolve(false);
  dlgInputMode = !!input;
  $("dlgInput").classList.toggle("hidden", !input);
  $("dlgInput").value = "";
  $("dlgInput").placeholder = typeof input === "string" ? input : "";
  $("dlgTitle").textContent = title;
  $("dlgMsg").textContent = message;
  $("dlgMsg").classList.toggle("hidden", !message);
  $("dlgOk").textContent = ok;
  $("dlgOk").classList.toggle("danger", danger);
  $("dlgIcon").textContent = icon || (danger ? "🗑" : "?");
  $("dlgIcon").classList.toggle("danger", danger);
  $("dlg").classList.remove("hidden");
  requestAnimationFrame(() => $("dlg").classList.add("show"));
  setTimeout(() => $(input ? "dlgInput" : danger ? "dlgCancel" : "dlgOk").focus(), 50);
  return new Promise((resolve) => (dlgResolve = resolve));
}
function closeDialog(result) {
  if (!dlgResolve) return;
  const r = dlgResolve;
  dlgResolve = null;
  $("dlg").classList.remove("show");
  setTimeout(() => $("dlg").classList.add("hidden"), 150);
  r(result && dlgInputMode ? $("dlgInput").value : result);
}
$("dlgOk").onclick = () => closeDialog(true);
$("dlgCancel").onclick = () => closeDialog(false);
$("dlg").addEventListener("mousedown", (e) => { if (e.target === $("dlg")) closeDialog(false); });
document.addEventListener("keydown", (e) => {
  if (!dlgResolve) return;
  if (e.key === "Escape") { e.preventDefault(); closeDialog(false); }
  if (e.key === "Enter") { e.preventDefault(); closeDialog(document.activeElement !== $("dlgCancel")); }
}, true);

/* Mouse tilt, like the website: the element leans toward the cursor */
function tiltOnHover(target, area = target, strength = 6) {
  area.addEventListener("mousemove", (e) => {
    const r = area.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    target.classList.add("tilting");
    target.style.setProperty("--ry", `${(x * strength).toFixed(2)}deg`);
    target.style.setProperty("--rx", `${(-y * strength * 0.7).toFixed(2)}deg`);
  });
  area.addEventListener("mouseleave", () => {
    target.classList.remove("tilting");
    target.style.removeProperty("--ry");
    target.style.removeProperty("--rx");
  });
}
tiltOnHover($("skin"), $("side-profile"), 18);

/* Window + navigation */
document.querySelectorAll("[data-win]").forEach((b) => b.addEventListener("click", () => api.window(b.dataset.win)));

document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab, .page").forEach((el) => el.classList.remove("active"));
    tab.classList.add("active");
    $(tab.dataset.tab).classList.add("active");
    if (tab.dataset.group) openAccGroup(tab.dataset.group);
    if (tab.dataset.tab === "profiles") renderProfilesPage();
    if (tab.dataset.tab === "events") renderEvents();
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
      if (!(await ask({ title: `Remove ${a.name}?`, message: "You'll need to sign in again to use this account.", ok: "Remove", danger: true }))) return;
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
  lastNewsItems = items;
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
      if (!(await ask({ title: `Delete ${m.name}?`, message: "The mod is removed from this profile.", ok: "Delete", danger: true }))) return;
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
    if (!(await ask({ title: `Delete ${item.name}?`, message: "It's removed from your library.", ok: "Delete", danger: true }))) return;
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
        if (!(await ask({ title: `Delete "${p.name}"?`, message: "Its mods, worlds and screenshots go to the Recycle Bin, so you can still get them back.", ok: "Delete profile", danger: true }))) return;
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
        if (!(await ask({ title: `Delete "${p.name}"?`, message: "Its mods, worlds and screenshots go to the Recycle Bin, so you can still get them back.", ok: "Delete profile", danger: true }))) return;
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
    const result = await api.launch({ server, profileId });
    if (result && typeof result.running === "number") gamesRunning = result.running;
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
  classic: { play: "▶", profiles: "▤", mods: "▦", skins: "☻", capes: "◭", events: "★", shop: "◆" },
  emoji: { play: "🎮", profiles: "🗂", mods: "🧩", skins: "👕", capes: "🧣", events: "🎁", shop: "💎" },
  none: { play: "", profiles: "", mods: "", skins: "", capes: "", events: "", shop: "" },
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
  const base = t.base || BASES[t.mode] || BASES.dark;
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
  if (window.layoutsReady) setLayout(t.layout || null);

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
document.querySelectorAll("#tpMode button").forEach((b) => (b.onclick = () => { draft.mode = b.dataset.mode; delete draft.base; syncThemeForm(); }));
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
    if (!(await ask({ title: `Update to version ${u.version}?`, message: "The launcher downloads it and restarts into the installer. Your profiles and mods stay.", ok: "Update", icon: "⬇" }))) return;
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

/* ---- Fracture server: sign-in, broadcasts, events, dev panel ---- */
let fUser = null;
const escH = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const timeLeft = (ms) => {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h < 48 ? h + "h " + (m % 60) + "m" : Math.floor(h / 24) + "d " + (h % 24) + "h";
};
const toMs = (t) => (typeof t === "number" ? (t < 1e12 ? t * 1000 : t) : Date.parse(t));

async function fractureConnect(force) {
  const r = await api.fractureSignIn(force);
  fUser = r.ok ? r.user : null;
  const isDev = fUser?.role === "dev";
  document.querySelector(".dev-badge")?.remove();
  if (isDev) {
    if (fUser.name) $("chipName").textContent = fUser.name;
    const b = document.createElement("span");
    b.className = "dev-badge";
    b.textContent = "DEV";
    b.style.background = fUser.color || "#8b0000";
    $("chipName").appendChild(b);
  }
  $("devPanel").classList.toggle("hidden", !isDev);
  $("tpPresetsWrap").classList.toggle("hidden", !isDev);
  $("devChatTab").classList.toggle("hidden", !isDev);
  if (isDev) pollChat();
  if (isDev) renderBugs();
  renderFriends();
  if (fUser?.color) $("devPanel").style.setProperty("--dev", fUser.color);
  $("evStatus").textContent = fUser ? "" : r.error ? "Not connected: " + r.error : "";
  renderBroadcasts();
  if ($("events").classList.contains("active")) renderEvents();
}

let dismissed = [];
try { dismissed = JSON.parse(localStorage.getItem("fractureDismissed") || "[]"); } catch {}
async function renderBroadcasts() {
  const r = await api.fractureApi("GET", "/broadcasts");
  const list = r.data?.broadcasts || [];
  $("bcastBar").innerHTML = list.filter((b) => !dismissed.includes(String(b.id))).map((b) =>
    `<div class="b">📣 <span>${escH(b.message)}</span><small>${escH(b.author || "")}</small><button data-dismiss="${b.id}" title="Dismiss">✕</button></div>`).join("");
  $("bcastBar").classList.toggle("hidden", !$("bcastBar").innerHTML);
  $("devBcList").innerHTML = list.map((b) =>
    `<div><span>📣 ${escH(b.message)}</span><button class="pill" data-delbc="${b.id}">DELETE</button></div>`).join("");
}
$("bcastBar").addEventListener("click", (e) => {
  const id = e.target.dataset?.dismiss;
  if (!id) return;
  dismissed.push(id);
  try { localStorage.setItem("fractureDismissed", JSON.stringify(dismissed.slice(-100))); } catch {}
  renderBroadcasts();
});
$("devBcList").addEventListener("click", async (e) => {
  const id = e.target.dataset?.delbc;
  if (!id || !(await ask({ title: "Delete broadcast?", message: "Players will stop seeing it.", ok: "Delete", danger: true }))) return;
  await api.fractureApi("DELETE", "/broadcasts/" + id);
  renderBroadcasts();
});
$("devBcSend").addEventListener("click", async () => {
  const message = $("devBcMsg").value.trim();
  if (!message) return;
  const r = await api.fractureApi("POST", "/broadcasts", { message, hours: Number($("devBcHours").value) || 24 });
  if (!r.ok) return ask({ title: "Broadcast failed", message: r.data?.error || "Error " + r.status });
  $("devBcMsg").value = "";
  renderBroadcasts();
});
$("devEvCreate").addEventListener("click", async () => {
  const title = $("devEvTitle").value.trim(), prize = $("devEvPrize").value.trim();
  if (!title || !prize) return;
  const r = await api.fractureApi("POST", "/events", { title, prize, hours: Number($("devEvHours").value) || 48 });
  if (!r.ok) return ask({ title: "Could not start giveaway", message: r.data?.error || "Error " + r.status });
  $("devEvTitle").value = $("devEvPrize").value = "";
  renderEvents();
});

async function renderEvents() {
  const r = await api.fractureApi("GET", "/events");
  if (!r.ok) { $("eventList").innerHTML = `<div class="empty-ev">Can't reach the Fracture server right now.</div>`; return; }
  const list = r.data?.events || [];
  const isDev = fUser?.role === "dev";
  $("eventList").innerHTML = list.length ? list.map((e) => {
    const ends = toMs(e.ends_at);
    const winner = e.winner_name || e.winner;
    const open = !winner && ends > Date.now();
    return `<div class="ev ${open ? "open" : ""}">
      <h4>${escH(e.title)}</h4>
      <div class="prize">🎁 ${escH(e.prize)}</div>
      <div class="meta">${e.entry_count ?? 0} entered · ${winner ? "finished" : open ? "ends in " + timeLeft(ends) : "ended, waiting for draw"}</div>
      ${winner ? `<div class="winner">🏆 Winner: ${escH(winner)}</div>` : ""}
      <div class="row">
        ${winner ? "" : e.entered ? `<button class="pill" disabled>✓ ENTERED</button>`
          : `<button class="pill accent" data-enter="${e.id}" ${fUser && open ? "" : "disabled"}>${fUser ? "ENTER" : "SIGN IN TO ENTER"}</button>`}
        ${isDev && !winner ? `<button class="pill" data-draw="${e.id}">DRAW WINNER</button>` : ""}
      </div>
    </div>`;
  }).join("") : `<div class="empty-ev">No events right now. Check back soon!</div>`;
}
$("eventList").addEventListener("click", async (e) => {
  const enter = e.target.dataset?.enter, draw = e.target.dataset?.draw;
  if (enter) {
    e.target.disabled = true;
    const r = await api.fractureApi("POST", `/events/${enter}/enter`);
    if (!r.ok) ask({ title: "Could not enter", message: r.data?.error || "Error " + r.status });
    renderEvents();
  } else if (draw) {
    if (!(await ask({ title: "Draw a winner?", message: "This picks one random entry and closes the giveaway.", ok: "Draw" }))) return;
    const r = await api.fractureApi("POST", `/events/${draw}/draw`);
    if (!r.ok) ask({ title: "Could not draw", message: r.data?.error || "Error " + r.status });
    renderEvents();
  }
});

// Loading screen: stays up while we sign in to the Fracture server (never more than 6 seconds)
{
  // Bar fills while we sign in, then the screen cracks and shatters like glass to show the launcher
  let done = false, shown = 0;
  const t0 = performance.now();
  (function grow(t) {
    if (done && shown >= 1) return;
    const target = done ? 1 : Math.min(0.9, (t - t0) / 3000);
    shown += (target - shown) * 0.12;
    if (done && shown > 0.995) shown = 1;
    $("splashFill").style.width = shown * 100 + "%";
    if (shown < 1) requestAnimationFrame(grow); else setTimeout(shatterSplash, 250);
  })(t0);
  const finish = () => { if (!done) { done = true; $("splashStatus").textContent = "Ready"; } };
  setTimeout(finish, 6000);
  fractureConnect().finally(finish);
}
setInterval(renderBroadcasts, 5 * 60 * 1000);

/* ---- Bug reports ---- */
$("bugBtn").addEventListener("click", async () => {
  if (!fUser) return ask({ title: "Sign in first", message: "Sign in with your Minecraft account so the team can reply to your report.", icon: "🐞" });
  const text = await ask({ title: "Report a bug", message: "What went wrong? Say what you clicked and what happened.", ok: "Send", icon: "🐞", input: "Describe the bug..." });
  if (!text || !text.trim()) return;
  const r = await api.fractureApi("POST", "/bugs", { message: text.trim() });
  ask({ title: r.ok ? "Thanks, report sent!" : "Couldn't send it", message: r.ok ? "The Fracture team will look at it." : r.data?.error || "Error " + r.status, icon: r.ok ? "✓" : "!" });
});

async function renderBugs() {
  if (fUser?.role !== "dev") return;
  const r = await api.fractureApi("GET", "/bugs");
  const list = r.data?.bugs || [];
  $("devBugList").innerHTML = list.length ? list.map((b) =>
    `<div><span>🐞 <b>${escH(b.name)}</b>${b.version ? " (v" + escH(b.version) + ")" : ""}: ${escH(b.message)}</span><button class="pill" data-fixbug="${b.id}">DONE</button></div>`).join("")
    : `<div><span class="muted">No open bug reports.</span></div>`;
}
$("devBugList").addEventListener("click", async (e) => {
  const id = e.target.dataset?.fixbug;
  if (!id) return;
  await api.fractureApi("POST", `/bugs/${id}/resolve`);
  renderBugs();
});

/* ---- Friends and the team list ---- */
const TEAM_ICONS = { "red-cross": "cross", fishbones: "fish", "pig-snout": "pig", rose: "rose" };
const head = (uuid) => `https://mc-heads.net/avatar/${uuid}/28`;
const frRow = (f, buttons = "") =>
  `<div class="fr ${f.online ? "on" : ""}"><img src="${head(f.uuid)}" alt="" /><div class="who"><b>${escH(f.name)}</b><small>${f.online ? escH(f.status || "Online") : "Offline"}</small></div>${buttons}<span class="dot"></span></div>`;

async function renderFriends() {
  const t = await api.fractureApi("GET", "/team");
  const team = t.data?.team || [];
  $("teamList").innerHTML = team.map((m) =>
    frRow({ uuid: m.uuid, name: m.display, online: m.online, status: m.status }).replace("<b>", `<b style="color:${escH(m.color)}">${TEAM_ICONS[m.icon] ? `<img class="team-ico" src="team/${TEAM_ICONS[m.icon]}.png" alt="" />` : ""}`)).join("") || `<div class="fr-empty">Can't reach the Fracture server.</div>`;
  if (!fUser) {
    $("frList").innerHTML = `<div class="fr-empty">Sign in to add friends.</div>`;
    $("frIncoming").innerHTML = "";
    return;
  }
  const r = await api.fractureApi("GET", "/friends");
  const d = r.data || {};
  $("frIncoming").innerHTML = (d.incoming || []).map((f) =>
    frRow(f, `<button class="yes" data-fraccept="${f.uuid}">ACCEPT</button><button data-frremove="${f.uuid}">✕</button>`).replace('class="fr', 'class="fr req')).join("");
  const friends = (d.friends || []).map((f) => frRow(f, `<button data-frremove="${f.uuid}" title="Remove friend">✕</button>`));
  const outgoing = (d.outgoing || []).map((f) => frRow({ ...f, status: null }, `<button data-frremove="${f.uuid}" title="Cancel request">✕</button>`).replace("Offline", "Request sent"));
  $("frList").innerHTML = [...friends, ...outgoing].join("") || `<div class="fr-empty">No friends yet. Add someone who uses Fracture Client.</div>`;
  const pending = (d.incoming || []).length;
  document.querySelector('[data-side="friends"]').textContent = pending ? `Friends (${pending})` : "Friends";
}
async function addFriend() {
  const name = $("frName").value.trim();
  if (!name) return;
  const r = await api.fractureApi("POST", "/friends", { name });
  $("frMsg").textContent = r.ok ? (r.data.accepted ? `You and ${r.data.name} are now friends!` : `Friend request sent to ${r.data.name}.`) : r.data?.error || "Couldn't add them";
  if (r.ok) $("frName").value = "";
  renderFriends();
}
$("frAddBtn").addEventListener("click", addFriend);
$("frName").addEventListener("keydown", (e) => { if (e.key === "Enter") addFriend(); });
$("side-friends").addEventListener("click", async (e) => {
  const acc = e.target.dataset?.fraccept, rm = e.target.dataset?.frremove;
  if (acc) await api.fractureApi("POST", `/friends/${acc}/accept`);
  else if (rm) {
    if (!(await ask({ title: "Remove friend?", ok: "Remove", danger: true }))) return;
    await api.fractureApi("DELETE", `/friends/${rm}`);
  } else return;
  renderFriends();
});
document.querySelector('[data-side="friends"]').addEventListener("click", renderFriends);
setInterval(() => { if (fUser) renderFriends(); }, 60000);

/* ---- Client style theme presets (dev accounts only) ---- */
const CLIENT_STYLES = {
  "Modrinth style": { layout: "modrinth", colors: ["#1bd96a", "#00af5c"], base: { bg: "#16181c", panel: "#1e2026", panel2: "#27292f", card: "#1a1c20", line: "#33363d", text: "#e2e4e9", muted: "#9a9fa8" }, font: "Segoe UI" },
  "Lunar style": { layout: "lunar", colors: ["#2f7bff", "#56c8ff"], base: { bg: "#080b12", panel: "#0f141e", panel2: "#161d2b", card: "#0c1018", line: "#1f2838", text: "#e6ecf7", muted: "#7c879c" }, font: "Bahnschrift" },
  "Dawn style": { layout: "dawn", colors: ["#ff7a59", "#ffc163"], base: { bg: "#120c0d", panel: "#1a1214", panel2: "#24191b", card: "#160f11", line: "#33242a", text: "#f4e9e4", muted: "#a38f8a" }, font: "Segoe UI" },
  "Prism style": { layout: "prism", colors: ["#8b5cf6", "#e879f9"], base: { bg: "#17161c", panel: "#1f1e26", panel2: "#292833", card: "#1b1a21", line: "#353443", text: "#ebe9f2", muted: "#9592a6" }, font: "Segoe UI" },
};
$("tpPresets").innerHTML = Object.entries(CLIENT_STYLES).map(([name, p]) =>
  `<button class="tp-preset" data-preset="${name}" style="background:${p.base.panel2};color:${p.base.text}">${name}<i style="background:linear-gradient(90deg, ${p.colors.join(", ")})"></i></button>`).join("");
$("tpPresets").addEventListener("click", (e) => {
  const name = e.target.closest("[data-preset]")?.dataset.preset;
  if (!name) return;
  const p = CLIENT_STYLES[name];
  draft = { ...JSON.parse(JSON.stringify(DEFAULT_THEME)), mode: "dark", colors: [...p.colors], base: { ...p.base }, font: p.font, layout: p.layout, buttonSize: draft.buttonSize, icons: draft.icons };
  activeStop = 0;
  syncThemeForm();
});

/* ---- Dawn-style layout (dev-only client style): icon sidebar, big skin card, last played, news, TikTok ---- */
var lastNewsItems = [];
const dawnOn = () => document.body.classList.contains("layout-dawn");

// Original pixel sunset, drawn small and scaled up so it looks blocky
function drawSunset() {
  const c = $("dhSky"), g = c.getContext("2d");
  const W = c.width, H = c.height;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sky = ["#f6c6d8", "#f8cfd2", "#fbd9c8", "#fde2b8", "#fdeaa8", "#fff1a0"];
  const band = Math.ceil((H * 0.75) / sky.length);
  sky.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, i * band, W, band); });
  // Sun
  g.fillStyle = "#fff7c2"; g.fillRect(W * 0.5 - 7, H * 0.52, 14, 10);
  g.fillStyle = "#fffbe0"; g.fillRect(W * 0.5 - 5, H * 0.54, 10, 6);
  // Clouds
  g.fillStyle = "#fdf2ee";
  for (let i = 0; i < 6; i++) {
    const x = rnd() * W, y = 4 + rnd() * H * 0.3, w = 10 + rnd() * 18;
    g.fillRect(x, y, w, 3); g.fillRect(x + 3, y - 2, w - 6, 2);
  }
  // Distant hills
  g.fillStyle = "#d9c98a";
  for (let x = 0; x < W; x += 4) { const h = 6 + Math.round(Math.sin(x / 13) * 3 + rnd() * 3); g.fillRect(x, H * 0.66 - h, 4, h + 10); }
  // Trees: trunk + blocky leaves, bigger ones at the edges
  const tree = (x, base, s) => {
    g.fillStyle = "#6b4a2b"; g.fillRect(x + s * 2, base - s * 4, s, s * 4);
    g.fillStyle = "#5d8f2e"; g.fillRect(x, base - s * 7, s * 5, s * 3);
    g.fillStyle = "#77ad3a"; g.fillRect(x + s, base - s * 8, s * 3, s * 2);
    g.fillStyle = "#8cc444"; g.fillRect(x + s, base - s * 7, s, s);
  };
  for (let i = 0; i < 9; i++) tree(rnd() * W, H * 0.72, 2 + Math.round(rnd()));
  tree(-4, H * 0.8, 6); tree(W - 26, H * 0.8, 6);
  // Grass and dirt
  for (let x = 0; x < W; x += 3) {
    g.fillStyle = rnd() > 0.5 ? "#79b33c" : "#6aa233"; g.fillRect(x, H * 0.76, 3, 4);
    for (let y = H * 0.76 + 4; y < H; y += 3) { g.fillStyle = rnd() > 0.6 ? "#7a5232" : rnd() > 0.5 ? "#8b603b" : "#6c4729"; g.fillRect(x, y, 3, 3); }
  }
  // A few flowers
  for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? "#e8323c" : "#f4d03f"; g.fillRect(rnd() * W, H * 0.76 - 2, 2, 2); }
}

function renderDawnNews() {
  const items = (lastNewsItems.length ? lastNewsItems : NEWS).slice(0, 2);
  $("dhNews").innerHTML = "";
  for (const n of items) {
    const el = document.createElement("div");
    el.className = "dh-news-card";
    if (/^https:\/\//.test(n.image || "")) el.style.backgroundImage = `linear-gradient(180deg, rgba(10,10,14,.15), rgba(10,10,14,.9)), url("${encodeURI(n.image)}")`;
    if (n.tag) { const t = document.createElement("span"); t.className = "tag"; t.textContent = n.tag; el.appendChild(t); }
    const b = document.createElement("b"); b.textContent = n.title || "";
    const s = document.createElement("small"); s.textContent = n.date ? timeAgo(n.date) : (n.body || "").slice(0, 60);
    el.append(b, s);
    if (/^https:\/\//.test(n.link || "")) { el.classList.add("clickable"); el.onclick = () => api.openNewsLink(n.link); }
    $("dhNews").appendChild(el);
  }
}

async function renderDawnProfiles() {
  let stats = {};
  try { stats = await api.profileStats(); } catch {}
  const when = (p) => p.lastPlayed || stats[p.id]?.lastPlayed || 0;
  const list = [...profiles.list].sort((a, b) => when(b) - when(a)).slice(0, 3);
  $("dhProfiles").innerHTML = "";
  list.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = `dh-prof${i === 0 ? " big" : ""}`;
    row.innerHTML = `<div class="dh-ico"><img src="heart.png" alt="" /></div><div class="dh-pinfo"><b></b><small></small></div><button class="dh-play">▶ Play</button><button class="dh-gear" title="Edit profile">⚙</button>`;
    row.querySelector("b").textContent = p.name;
    row.querySelector("small").textContent = `${p.loader === "fabric" ? "Fabric" : "Vanilla"} ${p.version} · ${lastPlayedText(when(p))}`;
    row.querySelector(".dh-play").onclick = async () => { await switchProfile(p.id); play(undefined, p.id); };
    row.querySelector(".dh-gear").onclick = () => { editingProfile = p; fillProfileForm(p); renderProfiles(); openModal("versionModal"); };
    $("dhProfiles").appendChild(row);
  });
}

async function renderDawnEvent() {
  const r = await api.fractureApi("GET", "/events");
  const open = (r.data?.events || []).find((e) => !e.winner && toMs(e.ends_at) > Date.now());
  $("dhEventTitle").textContent = open ? open.title : "No giveaway right now";
  $("dhEventPrize").textContent = open ? `🎁 ${open.prize} · ends in ${timeLeft(toMs(open.ends_at))}` : "Check back soon for free Fracture cosmetics.";
}

function renderDawn() {
  if (!dawnOn()) return;
  if (account) {
    $("dhSkin").src = `https://mc-heads.net/body/${account.uuid}/260`;
    $("dhName").textContent = account.name;
    $("dhAccHead").src = `https://mc-heads.net/avatar/${account.uuid}/24`;
    $("dhAccName").textContent = account.name;
  }
  $("dhSkin").classList.toggle("hidden", !account);
  renderDawnProfiles();
  renderDawnNews();
  renderDawnEvent();
}

// Turns the layout on or off (called from applyTheme)
let dawnBuilt = false;
function setDawnLayout(on) {
  document.body.classList.toggle("layout-dawn", on);
  // Move the shared status bar and crash screen into whichever home is showing
  const home = on ? $("dhStatusSlot") : document.querySelector("#play .hero-content");
  if (home && $("statusText")) home.appendChild($("statusText").closest(".status"));
  (on ? $("dhHero") : document.querySelector("#play .hero")).appendChild($("crash"));
  if (on) {
    if (!dawnBuilt) { drawSunset(); dawnBuilt = true; }
    showSide("tiktok");
    renderDawn();
  }
}

$("dhGoProfile").onclick = () => document.querySelector('[data-tab="profiles"]').click();
$("dhAccBtn").onclick = () => toggleSwitcher(!$("switcher").classList.contains("open"));
$("dhEdit").onclick = () => $("themeBtn").click();
$("dhManage").onclick = () => document.querySelector('[data-tab="profiles"]').click();
$("dhAddMods").onclick = () => document.querySelector('[data-tab="mods"]').click();
$("dhViewNews").onclick = () => api.openNewsLink("https://fracture-client.github.io/");
$("dhEventBtn").onclick = () => document.querySelector('[data-tab="events"]').click();
$("dawnChat").onclick = () => {
  const toFriends = !$("side-friends").classList.contains("active");
  showSide(toFriends ? "friends" : "tiktok");
  if (toFriends) renderFriends();
  $("dawnChat").textContent = toFriends ? "♪ Back to TikTok" : "💬 Chat";
};
document.querySelector('[data-tab="play"]').addEventListener("click", renderDawn);

/* ---- Lunar-style layout (dev-only client style): space banner, launch button, news grid, friends + TikTok ---- */
const lunarOn = () => document.body.classList.contains("layout-lunar");

// Original pixel space scene: stars, a blocky planet and a moon
function drawSpace() {
  const c = $("lhSky"), g = c.getContext("2d");
  const W = c.width, H = c.height;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, "#05060c"); grd.addColorStop(1, "#141a33");
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) { g.fillStyle = rnd() > 0.8 ? "#9fb4ff" : "#d8dcf0"; g.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), 1, 1); }
  // Planet: blue ball with green land, drawn pixel by pixel
  const px = 34, py = 44, r = 22;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (x * x + y * y > r * r) continue;
    const land = Math.sin((x + 5) / 6) + Math.cos((y - 3) / 5) > 0.9;
    const shade = x + y > r * 0.6;
    g.fillStyle = land ? (shade ? "#3d7a2a" : "#5aa83a") : (shade ? "#1f5a9e" : "#2f7dd1");
    g.fillRect(px + x, py + y, 1, 1);
  }
  g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(px - 10, py - 14, 8, 3); g.fillRect(px + 4, py + 6, 6, 2);
  // Moon
  const mx = W - 30, my = 20, mr = 11;
  for (let y = -mr; y <= mr; y++) for (let x = -mr; x <= mr; x++) {
    if (x * x + y * y > mr * mr) continue;
    g.fillStyle = (x * 3 + y * 7) % 5 === 0 ? "#b8bcc8" : x + y > mr * 0.5 ? "#c9ccd6" : "#eceef4";
    g.fillRect(mx + x, my + y, 1, 1);
  }
  // A small heart-shaped "ship" for Fracture
  g.fillStyle = "#ff3b4e";
  [[1,0],[2,0],[4,0],[5,0],[0,1],[1,1],[2,1],[3,1],[4,1],[5,1],[6,1],[1,2],[2,2],[3,2],[4,2],[5,2],[2,3],[3,3],[4,3],[3,4]].forEach(([x, y]) => g.fillRect(W - 70 + x, H - 34 + y, 1, 1));
  g.fillStyle = "#ffb347"; g.fillRect(W - 68, H - 28, 1, 2); g.fillRect(W - 64, H - 28, 1, 2);
}

function renderLunarNews() {
  const items = lastNewsItems.length ? lastNewsItems : NEWS;
  $("lhNews").innerHTML = "";
  for (const n of items.slice(0, 6)) {
    const el = document.createElement("div");
    el.className = "lh-news-card";
    if (/^https:\/\//.test(n.image || "")) el.style.backgroundImage = `linear-gradient(180deg, rgba(10,10,14,0), rgba(10,10,14,.85)), url("${encodeURI(n.image)}")`;
    const b = document.createElement("b"); b.textContent = n.title || "";
    const s = document.createElement("small"); s.textContent = (n.body || "").slice(0, 70);
    el.append(b, s);
    if (/^https:\/\//.test(n.link || "")) { el.classList.add("clickable"); el.onclick = () => api.openNewsLink(n.link); }
    $("lhNews").appendChild(el);
  }
  $("lhNewsCount").textContent = `(${items.length})`;
}

function renderLunar(light) {
  if (!lunarOn()) return;
  $("lhName").textContent = account ? account.name : "Guest";
  if (account) $("lhHead").src = `https://mc-heads.net/avatar/${account.uuid}/22`;
  $("lhHead").classList.toggle("hidden", !account);
  const p = prof();
  $("lhSub").textContent = p ? `${p.name} · ${p.loader === "fabric" ? "Fabric" : "Vanilla"} ${p.version}` : "";
  $("lhLaunch").disabled = launching;
  $("lhLaunchText").textContent = launching ? "STARTING..." : gamesRunning ? `LAUNCH GAME (${gamesRunning} OPEN)` : "LAUNCH GAME";
  if (light === true) return;
  renderLunarNews();
  renderFriends();
}

let lunarBuilt = false;
function setLunarLayout(on) {
  document.body.classList.toggle("layout-lunar", on);
  const home = on ? $("lhStatusSlot") : (dawnOn() ? $("dhStatusSlot") : document.querySelector("#play .hero-content"));
  if (home && $("statusText")) home.appendChild($("statusText").closest(".status"));
  (on ? $("lhHero") : dawnOn() ? $("dhHero") : document.querySelector("#play .hero")).appendChild($("crash"));
  if (on) {
    if (!lunarBuilt) { drawSpace(); lunarBuilt = true; }
    showSide("tiktok");
    renderLunar();
  }
}
$("lhLaunch").onclick = () => play();
$("lhProfile").onclick = (e) => { e.stopPropagation(); $("profileBtn").click(); };
$("lhAcc").onclick = () => toggleSwitcher(!$("switcher").classList.contains("open"));
$("lhGear").onclick = () => { const p = prof(); if (!p) return; editingProfile = p; fillProfileForm(p); renderProfiles(); openModal("versionModal"); };
$("lhExplore").onclick = () => api.openNewsLink("https://fracture-client.github.io/");
document.querySelector('[data-tab="play"]').addEventListener("click", renderLunar);
setInterval(() => { if (lunarOn() && $("play").classList.contains("active")) renderLunar(true); }, 1500);

/* ---- Modrinth-style layout (dev-only client style): Jump in, Library grid, Playing as, news, TikTok ---- */
const modrinthOn = () => document.body.classList.contains("layout-modrinth");

async function renderModrinth() {
  if (!modrinthOn()) return;
  let stats = {};
  try { stats = await api.profileStats(); } catch {}
  const when = (p) => p.lastPlayed || stats[p.id]?.lastPlayed || 0;
  const sorted = [...profiles.list].sort((a, b) => when(b) - when(a));
  const desc = (p) => `${p.loader === "fabric" ? "Fabric" : "Vanilla"} ${p.version}`;
  // Jump in: the three most recent
  $("rhJump").innerHTML = "";
  for (const p of sorted.slice(0, 3)) {
    const row = document.createElement("div");
    row.className = "rh-jump";
    row.innerHTML = `<div class="rh-ico"><img src="heart.png" alt="" /></div><div class="rh-info"><b></b><small></small></div><button class="rh-play">▶ Play</button><button class="rh-more" title="Edit profile">⋮</button>`;
    row.querySelector("b").textContent = p.name;
    row.querySelector("small").textContent = `${desc(p)} · ${when(p) ? lastPlayedText(when(p)) : "Never played"}`;
    row.querySelector(".rh-play").onclick = async () => { await switchProfile(p.id); play(undefined, p.id); };
    row.querySelector(".rh-more").onclick = () => { editingProfile = p; fillProfileForm(p); renderProfiles(); openModal("versionModal"); };
    $("rhJump").appendChild(row);
  }
  renderModrinthLibrary(sorted);
  // Right column
  $("rhAccName").textContent = account ? account.name : "Not signed in";
  if (account) $("rhAccHead").src = `https://mc-heads.net/avatar/${account.uuid}/36`;
  const n = (lastNewsItems.length ? lastNewsItems : NEWS)[0];
  $("rhNewsTitle").textContent = n?.title || "";
  $("rhNewsBody").textContent = n?.body || "";
  $("rhNewsImg").style.backgroundImage = /^https:\/\//.test(n?.image || "") ? `url("${encodeURI(n.image)}")` : "";
  $("rhNewsImg").classList.toggle("hidden", !/^https:\/\//.test(n?.image || ""));
  const f = await api.fractureApi("GET", "/friends");
  const online = (f.data?.friends || []).filter((x) => x.online);
  $("rhFriends").textContent = !fUser ? "Sign in to see what your friends are playing." : online.length ? online.map((x) => `${x.name}: ${x.status || "Online"}`).join(" · ") : `${(f.data?.friends || []).length} friends, none online right now.`;
}

let rhSorted = [];
function renderModrinthLibrary(sorted) {
  if (sorted) rhSorted = sorted;
  const q = $("rhSearch").value.trim().toLowerCase();
  $("rhLib").innerHTML = "";
  for (const p of rhSorted.filter((p) => !q || p.name.toLowerCase().includes(q))) {
    const t = document.createElement("button");
    t.className = "rh-tile";
    t.innerHTML = `<div class="rh-tile-img"><img src="heart.png" alt="" /></div><b></b><small></small>`;
    t.querySelector("b").textContent = p.name;
    t.querySelector("small").textContent = `${p.loader === "fabric" ? "Fabric" : "Vanilla"} ${p.version}`;
    t.onclick = async () => { await switchProfile(p.id); play(undefined, p.id); };
    t.title = `Play ${p.name}`;
    $("rhLib").appendChild(t);
  }
}

function setModrinthLayout(on) {
  document.body.classList.toggle("layout-modrinth", on);
  if (on) {
    $("rhStatusSlot").appendChild($("statusText").closest(".status"));
    $("rhMain").prepend($("crash"));
    showSide("tiktok");
    renderModrinth();
  }
}
$("rhSearch").addEventListener("input", () => renderModrinthLibrary());
$("rhNew").onclick = () => $("profilesNewBtn").click();
$("rhAcc").onclick = () => toggleSwitcher(!$("switcher").classList.contains("open"));
$("rhFriendsBtn").onclick = () => {
  const toFriends = !$("side-friends").classList.contains("active");
  showSide(toFriends ? "friends" : "tiktok");
  if (toFriends) renderFriends();
  $("rhFriendsBtn").textContent = toFriends ? "Back to TikTok" : "Open friends";
};
document.querySelector('[data-tab="play"]').addEventListener("click", renderModrinth);

// One place that picks the layout; the plain layout puts the status bar and crash screen back
function setLayout(name) {
  setDawnLayout(false); setLunarLayout(false); setModrinthLayout(false); setPrismLayout(false);
  document.querySelector("#play .hero-content").appendChild($("statusText").closest(".status"));
  document.querySelector("#play .hero").appendChild($("crash"));
  if (name === "dawn") setDawnLayout(true);
  else if (name === "lunar") setLunarLayout(true);
  else if (name === "modrinth") setModrinthLayout(true);
  else if (name === "prism") setPrismLayout(true);
  document.body.classList.toggle("layout-alt", !!name);
}

/* ---- Prism-style layout (dev-only client style): toolbar, profile grid, actions column, news bar ---- */
const prismOn = () => document.body.classList.contains("layout-prism");
let pmSelected = null;

async function renderPrism() {
  if (!prismOn()) return;
  let stats = {};
  try { stats = await api.profileStats(); } catch {}
  if (!profiles.list.some((p) => p.id === pmSelected)) pmSelected = profiles.active;
  $("pmGrid").innerHTML = "";
  for (const p of profiles.list) {
    const t = document.createElement("button");
    t.className = `pm-tile${p.id === pmSelected ? " sel" : ""}`;
    t.innerHTML = `<img src="heart.png" alt="" /><span></span>`;
    t.querySelector("span").textContent = p.name;
    t.onclick = () => { pmSelected = p.id; renderPrism(); };
    t.ondblclick = async () => { await switchProfile(p.id); play(undefined, p.id); };
    $("pmGrid").appendChild(t);
  }
  const p = profiles.list.find((x) => x.id === pmSelected);
  $("pmName").textContent = p ? p.name : "";
  const st = (p && stats[p.id]) || {};
  const last = p?.lastPlayed || st.lastPlayed;
  $("pmInfo").textContent = p ? `Minecraft ${p.version}${p.loader === "fabric" ? " (Fabric)" : ""}, ${last ? "last played " + new Date(last).toLocaleString() : "never played"} · ${st.mods ?? 0} mods` : "";
  const n = (lastNewsItems.length ? lastNewsItems : NEWS)[0];
  $("pmNews").textContent = n ? n.title : "";
}

function setPrismLayout(on) {
  document.body.classList.toggle("layout-prism", on);
  if (on) {
    $("pmStatusSlot").appendChild($("statusText").closest(".status"));
    $("pmMain").prepend($("crash"));
    showSide("tiktok");
    renderPrism();
  }
}
const pmProfile = () => profiles.list.find((x) => x.id === pmSelected);
$("pmLaunch").onclick = async () => { const p = pmProfile(); if (!p) return; await switchProfile(p.id); play(undefined, p.id); };
$("pmEdit").onclick = () => { const p = pmProfile(); if (!p) return; editingProfile = p; fillProfileForm(p); renderProfiles(); openModal("versionModal"); };
$("pmFolder").onclick = () => { const p = pmProfile(); if (p) api.openProfile(p.id); };
$("pmCopy").onclick = async () => { const p = pmProfile(); if (!p) return; await api.duplicateProfile(p.id); await loadProfiles(); renderPrism(); };
$("pmDelete").onclick = async () => {
  const p = pmProfile(); if (!p) return;
  if (!(await ask({ title: `Delete "${p.name}"?`, message: "Its mods, worlds and screenshots go to the Recycle Bin, so you can still get them back.", ok: "Delete profile", danger: true }))) return;
  try { await api.deleteProfile(p.id); } catch (err) { return setStatus(`Error: ${cleanError(err)}`); }
  await loadProfiles(); renderPrism();
};
$("pmAdd").onclick = () => $("profilesNewBtn").click();
$("pmMods").onclick = () => document.querySelector('[data-tab="mods"]').click();
$("pmNewsBtn").onclick = () => api.openNewsLink("https://fracture-client.github.io/");
document.querySelector('[data-tab="play"]').addEventListener("click", renderPrism);

/* ---- Shop: points from playtime, capes from the ideas notes. The server owns balances and ownership ---- */
async function renderShop() {
  const r = await api.fractureApi("GET", "/shop");
  if (!r.ok) { $("shopGrid").innerHTML = `<div class="empty-ev">Can't reach the Fracture server right now.</div>`; return; }
  const d = r.data;
  const owned = new Set(d.owned || []);
  $("shopBalance").textContent = fUser ? (d.balance ?? 0).toLocaleString() : "–";
  $("shopToday").textContent = fUser ? `${d.today ?? 0} / ${d.dailyCap} earned today` : "Sign in to earn points";
  $("shopTodayBar").style.width = fUser ? Math.min(100, ((d.today || 0) / d.dailyCap) * 100) + "%" : "0";
  $("shopGrid").innerHTML = d.items.map((it) => {
    const have = owned.has(it.id), worn = d.equipped === it.id;
    const btn = !fUser ? `<button class="pill" disabled>SIGN IN</button>`
      : worn ? `<button class="pill" data-unequip="1">✓ WEARING</button>`
      : have ? `<button class="pill accent" data-equip="${it.id}">WEAR</button>`
      : it.price == null ? `<button class="pill" disabled>WIN A GIVEAWAY</button>`
      : `<button class="pill accent" data-buy="${it.id}" ${(d.balance || 0) < it.price ? "disabled" : ""}>◆ ${it.price}</button>`;
    return `<div class="shop-item${worn ? " worn" : ""}"><div class="cape-svg">${CAPE_SVGS[it.name] || ""}</div><b>${escH(it.name)}</b>${it.season ? '<small class="season">Seasonal</small>' : ""}${btn}</div>`;
  }).join("");
}
$("shopGrid").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  let r;
  if (b.dataset.buy) {
    const item = b.closest(".shop-item").querySelector("b").textContent;
    if (!(await ask({ title: `Buy ${item}?`, message: `It costs ${b.textContent.replace("◆", "").trim()} points. Capes are visual only.`, ok: "Buy", icon: "◆" }))) return;
    r = await api.fractureApi("POST", `/shop/${b.dataset.buy}/buy`);
  } else if (b.dataset.equip) r = await api.fractureApi("POST", "/equip", { cape: b.dataset.equip });
  else if (b.dataset.unequip) r = await api.fractureApi("POST", "/equip", { cape: null });
  else return;
  if (!r.ok) ask({ title: "Couldn't do that", message: r.data?.error || "Error " + r.status, icon: "!" });
  renderShop();
});
document.querySelector('[data-tab="shop"]').addEventListener("click", renderShop);

/* ---- Dev chat (team only; the server checks) ---- */
let chatLast = 0;
async function pollChat() {
  if (fUser?.role !== "dev") return;
  const r = await api.fractureApi("GET", `/chat?after=${chatLast}`);
  const list = r.data?.messages || [];
  if (!list.length) return;
  const atBottom = $("chatLog").scrollHeight - $("chatLog").scrollTop - $("chatLog").clientHeight < 40;
  for (const m of list) {
    chatLast = Math.max(chatLast, m.id);
    const el = document.createElement("div");
    el.className = "chat-msg";
    const ico = TEAM_ICONS[m.icon] ? `<img src="team/${TEAM_ICONS[m.icon]}.png" alt="" />` : "";
    const time = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    el.innerHTML = `<div class="chat-who">${ico}<b style="color:${escH(m.color || "#fff")}">${escH(m.name || "?")}</b><small>${time}</small></div><p></p>`;
    el.querySelector("p").textContent = m.message;
    $("chatLog").appendChild(el);
  }
  if (atBottom) $("chatLog").scrollTop = $("chatLog").scrollHeight;
  if (!$("side-devchat").classList.contains("active")) document.querySelector('[data-side="devchat"]').classList.add("unread");
}
async function sendChat() {
  const message = $("chatInput").value.trim();
  if (!message) return;
  $("chatInput").value = "";
  const r = await api.fractureApi("POST", "/chat", { message });
  if (!r.ok) ask({ title: "Message not sent", message: r.data?.error || "Error " + r.status, icon: "!" });
  pollChat();
}
$("chatSend").addEventListener("click", sendChat);
$("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
document.querySelector('[data-side="devchat"]').addEventListener("click", (e) => {
  e.currentTarget.classList.remove("unread");
  setTimeout(() => ($("chatLog").scrollTop = $("chatLog").scrollHeight), 50);
});
setInterval(pollChat, 5000);

/* ---- Play Bedrock (Windows): opens the Minecraft Bedrock app if it's installed ---- */
if (api.platform === "win32") $("bedrockBtn").classList.remove("hidden");
$("bedrockBtn").addEventListener("click", async () => {
  const ok = await api.playBedrock();
  if (!ok) ask({ title: "Bedrock isn't installed", message: "Install Minecraft for Windows from the Microsoft Store or the Xbox app first.", icon: "!" });
});

/* ---- Theme codes: share a theme as a short code ---- */
$("tpCopyCode").addEventListener("click", async () => {
  const { layout, ...shareable } = draft; // layouts stay dev-only
  const code = "FRC1-" + btoa(unescape(encodeURIComponent(JSON.stringify(shareable))));
  try { await navigator.clipboard.writeText(code); } catch {}
  ask({ title: "Theme code copied", message: "Send it to a friend. They paste it with Paste code in their theme editor.", icon: "✓" });
});
$("tpPasteCode").addEventListener("click", async () => {
  const code = (await ask({ title: "Paste a theme code", ok: "Use it", icon: "✎", input: "FRC1-..." }) || "").trim();
  if (!code) return;
  try {
    if (!code.startsWith("FRC1-")) throw 0;
    const t = JSON.parse(decodeURIComponent(escape(atob(code.slice(5)))));
    const colors = (t.colors || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6);
    if (!colors.length) throw 0;
    draft = { ...JSON.parse(JSON.stringify(DEFAULT_THEME)), ...t, colors, layout: undefined };
    if (t.base && typeof t.base !== "object") delete draft.base;
    activeStop = 0;
    syncThemeForm();
  } catch {
    ask({ title: "That code doesn't work", message: "Theme codes start with FRC1-. Ask your friend to copy it again.", icon: "!" });
  }
});

window.layoutsReady = true;
setLayout(theme.layout || null);

function shatterSplash() {
  const sp = $("splash"), NS = "http://www.w3.org/2000/svg";
  if (sp.classList.contains("gone")) return;
  const W = innerWidth, H = innerHeight, cx = W / 2, cy = H * 0.45, N = 11;
  const rings = [0, W * 0.07, W * 0.17, W * 0.32, W * 0.55, W * 1.2];
  const pts = rings.map((r, ri) => Array.from({ length: N }, (_, k) => {
    const ang = (k / N) * Math.PI * 2 + (ri ? (Math.random() - 0.5) * 0.35 : 0), rr = r * (ri ? 0.85 + Math.random() * 0.3 : 0);
    return [cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr];
  }));
  const holder = document.createElement("div");
  holder.className = "shatter";
  document.body.appendChild(holder);
  // Crack lines draw in first
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const lines = [];
  for (let ri = 0; ri < rings.length - 1; ri++) for (let k = 0; k < N; k++) {
    const a = pts[ri][k], b = pts[ri + 1][k], c = pts[ri + 1][(k + 1) % N];
    lines.push(`M${a} L${b}`, `M${b} L${c}`);
  }
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", lines.join(" "));
  path.setAttribute("stroke", "#dfe6ff"); path.setAttribute("stroke-width", "1.5"); path.setAttribute("fill", "none");
  svg.appendChild(path); holder.appendChild(svg);
  const L = path.getTotalLength();
  path.style.strokeDasharray = L;
  path.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 350, fill: "forwards", easing: "ease-out" });
  sp.animate([{ transform: "translate(0,0)" }, { transform: "translate(-6px,4px)" }, { transform: "translate(5px,-3px)" }, { transform: "translate(0,0)" }], { duration: 250 });
  setTimeout(() => {
    // Each piece is a copy of the loading screen clipped to one shard, then it falls away
    for (let ri = 0; ri < rings.length - 1; ri++) for (let k = 0; k < N; k++) {
      const poly = [pts[ri][k], pts[ri][(k + 1) % N], pts[ri + 1][(k + 1) % N], pts[ri + 1][k]];
      const s = document.createElement("div");
      s.className = "shard";
      s.style.clipPath = "polygon(" + poly.map((q) => q[0] + "px " + q[1] + "px").join(",") + ")";
      const c = sp.cloneNode(true);
      c.removeAttribute("id");
      c.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
      s.appendChild(c);
      holder.insertBefore(s, svg);
      const mx = poly.reduce((a, q) => a + q[0], 0) / 4, my = poly.reduce((a, q) => a + q[1], 0) / 4;
      const dx = (mx - cx) * 0.35 + (Math.random() - 0.5) * 60, rot = (Math.random() - 0.5) * 70;
      s.style.transformOrigin = mx + "px " + my + "px";
      s.animate([
        { transform: "translate(0,0) rotate(0)", opacity: 1 },
        { transform: `translate(${dx}px,${H * 0.25}px) rotate(${rot * 0.4}deg)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${dx * 1.6}px,${H * 1.3}px) rotate(${rot}deg)`, opacity: 0.9 },
      ], { duration: 1300 + Math.random() * 500, delay: (4 - ri) * 60 + Math.random() * 120, easing: "cubic-bezier(.4,0,.9,.6)", fill: "forwards" });
    }
    sp.classList.add("gone");
    svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
    setTimeout(() => holder.remove(), 2400);
  }, 550);
}
