const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const os = require("os");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { Client } = require("minecraft-launcher-core");
const { Auth } = require("msmc");
const extract = require("extract-zip");

const ROOT = path.join(app.getPath("appData"), ".fractur");
const SETTINGS_FILE = path.join(ROOT, "settings.json");
const ACCOUNT_FILE = path.join(ROOT, "account.json");
const ACCOUNTS_FILE = path.join(ROOT, "accounts.json");
fs.mkdirSync(ROOT, { recursive: true });

// Fabric performance + PvP quality-of-life mods pulled from Modrinth for modern versions
const PVP_MODS = ["sodium", "lithium", "ferrite-core", "entityculling", "immediatelyfast", "zoomify", "modmenu", "fabric-api"];

const DEFAULT_SETTINGS = {
  version: "1.21.4",
  loader: "fabric",
  ramMin: 2,
  ramMax: 4,
  width: 1280,
  height: 720,
  fullscreen: false,
  pvpMods: true,
  jvmArgs: "-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions -XX:G1NewSizePercent=20 -XX:MaxGCPauseMillis=50",
  closeOnLaunch: false,
};

let win;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "FractureClient/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(getJson(res.headers.location));
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "FractureClient/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(download(res.headers.location, dest, onProgress));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const total = Number(res.headers["content-length"]) || 0;
      let done = 0;
      const out = fs.createWriteStream(dest);
      res.on("data", (c) => {
        done += c.length;
        if (total && onProgress) onProgress(done / total);
      });
      res.pipe(out);
      out.on("finish", () => out.close(resolve));
      out.on("error", reject);
    }).on("error", reject);
  });
}

function status(text, progress) {
  if (win) win.webContents.send("status", { text, progress });
}

// Keep login tokens out of the console, people paste it when asking for help
function redact(text) {
  return text
    .replace(/(--accessToken\s+)\S+/g, "$1[hidden]")
    .replace(/(--clientId\s+)\S+/g, "$1[hidden]")
    .replace(/(--xuid\s+)\S+/g, "$1[hidden]")
    .replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, "[hidden token]");
}

function log(line) {
  if (win) win.webContents.send("log", redact(String(line)));
}

// Old versions need Java 8, 1.17-1.20.4 need 17, newer need 21
function javaMajorFor(version) {
  const [, minor, patch = 0] = version.split(".").map(Number);
  if (minor < 17) return 8;
  if (minor < 20 || (minor === 20 && patch < 5)) return 17;
  return 21;
}

async function ensureJava(major) {
  const dir = path.join(ROOT, "runtime", `java${major}`);
  const findExe = (d) => {
    if (!fs.existsSync(d)) return null;
    for (const entry of fs.readdirSync(d)) {
      const exe = path.join(d, entry, "bin", "javaw.exe");
      if (fs.existsSync(exe)) return exe;
    }
    return null;
  };
  const existing = findExe(dir);
  if (existing) return existing;

  status(`Downloading Java ${major}...`, 0);
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, "jre.zip");
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse`;
  await download(url, zip, (p) => status(`Downloading Java ${major}...`, p));
  status(`Extracting Java ${major}...`, null);
  await extract(zip, { dir });
  fs.unlinkSync(zip);
  const exe = findExe(dir);
  if (!exe) throw new Error("Java download did not contain javaw.exe");
  return exe;
}

async function ensureFabric(version) {
  const loaders = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${version}`);
  const stable = loaders.find((l) => l.loader.stable) || loaders[0];
  if (!stable) throw new Error(`Fabric does not support ${version}`);
  const id = `fabric-loader-${stable.loader.version}-${version}`;
  const versionDir = path.join(ROOT, "versions", id);
  const jsonPath = path.join(versionDir, `${id}.json`);
  if (!fs.existsSync(jsonPath)) {
    status("Installing Fabric...", null);
    const profile = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${version}/${stable.loader.version}/profile/json`);
    fs.mkdirSync(versionDir, { recursive: true });
    writeJson(jsonPath, profile);
  }
  return id;
}

async function ensureMods(version) {
  const installed = await modIndex(version);
  for (let i = 0; i < PVP_MODS.length; i++) {
    const slug = PVP_MODS[i];
    status(`Checking mods (${slug})...`, i / PVP_MODS.length);
    // Skip mods the user already has from anywhere (imports, drag and drop)
    const modId = { "ferrite-core": "ferritecore", "fabric-api": "fabric-api" }[slug] || slug;
    if (installed.has(modId)) continue;
    try {
      await installModrinth(slug, version);
    } catch (e) {
      log(`[mods] ${slug}: ${e.message}`);
    }
  }
}

/* Crash detection and auto-fix */

// mod id -> [file names] for every jar in the instance, enabled or not
async function modIndex(version) {
  const dir = modsDir(version);
  const index = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jar") || x.endsWith(".jar.disabled"))) {
    const full = path.join(dir, f);
    const key = `${f.replace(/\.disabled$/, "")}:${fs.statSync(full).size}`;
    if (!jarMetaCache.has(key)) jarMetaCache.set(key, await readJarMeta(full));
    const id = jarMetaCache.get(key).id;
    if (!id) continue;
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(f);
  }
  return index;
}

// Fabric mod ids that don't match their Modrinth slug
const MODID_TO_SLUG = {
  yet_another_config_lib_v3: "yacl",
  fabric: "fabric-api",
  "fabric-api": "fabric-api",
  "fabric-language-kotlin": "fabric-language-kotlin",
  owo: "owo-lib",
  cloth_config: "cloth-config",
  "cloth-config2": "cloth-config",
  "cloth-config": "cloth-config",
  geckolib: "geckolib",
  architectury: "architectury-api",
  balm: "balm",
  modmenu: "modmenu",
  puzzleslib: "puzzles-lib",
  forgeconfigapiport: "forge-config-api-port",
  malilib: "malilib",
  placeholder_api: "placeholder-api",
  iceberg: "iceberg",
  ukulib: "ukulib",
};

async function findModrinthProject(modId, version) {
  const candidates = [MODID_TO_SLUG[modId], modId, modId.replace(/_/g, "-")].filter(Boolean);
  for (const slug of candidates) {
    try {
      const p = await getJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}`);
      if (p && p.id) return p.id;
    } catch {}
  }
  const facets = encodeURIComponent(JSON.stringify([["categories:fabric"], [`versions:${version}`], ["project_type:mod"]]));
  const r = await getJson(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(modId.replace(/[_-]/g, " "))}&facets=${facets}&limit=1`);
  if (r.hits && r.hits[0]) return r.hits[0].project_id;
  throw new Error(`Couldn't find ${modId} on Modrinth`);
}

// Turns Fabric's "Incompatible mods found!" report (and common crash causes) into fix actions
function analyzeCrash(output) {
  const fixes = [];
  const seen = new Set();
  const add = (fix) => {
    const key = `${fix.type}:${fix.modId}`;
    if (!seen.has(key)) { seen.add(key); fixes.push(fix); }
  };
  for (const line of output.split(/\r?\n/)) {
    let m;
    if ((m = line.match(/Install (\S+?), (?:version |any version)/))) add({ type: "install", modId: m[1] });
    else if ((m = line.match(/Replace mod '(.+?)' \((\S+?)\) .+? with (?:version |any version)/))) add({ type: "update", modId: m[2], name: m[1] });
    else if ((m = line.match(/Remove mod '(.+?)' \((\S+?)\)/))) add({ type: "remove", modId: m[2], name: m[1] });
    else if ((m = line.match(/of (\S+?), which is missing!/))) add({ type: "install", modId: m[1] });
    else if ((m = line.match(/Mod '(.+?)' \((\S+?)\) .*? requires .*? of (?:mod '.+?' \()?minecraft\)?, but only the wrong version is present/))) add({ type: "remove", modId: m[2], name: m[1] });
    else if ((m = line.match(/requires (?:version .+?|any version) of (?:mod '.+?' \()?(\S+?)\)?, but only the wrong version is present/))) {
      if (m[1] !== "minecraft" && m[1] !== "fabricloader" && m[1] !== "java") add({ type: "update", modId: m[1] });
    }
    else if ((m = line.match(/Mod '(.+?)' \((\S+?)\) .*? is incompatible with/))) add({ type: "remove", modId: m[2], name: m[1] });
    else if ((m = line.match(/Mixin apply for mod (\S+?) failed/))) add({ type: "remove", modId: m[1] });
    // "Could not execute entrypoint stage 'preLaunch' due to errors, provided by 'dawn'"
    else if ((m = line.match(/Could not execute entrypoint stage '\w+' due to errors, provided by '(\S+?)'/))) add({ type: "remove", modId: m[1] });
    else if ((m = line.match(/Exception while loading entries for entrypoint '\w+' provided by '(\S+?)'/))) add({ type: "remove", modId: m[1] });
    // Crash reports: "Suspected Mod: Foo (foo), Version: ..."
    else if ((m = line.match(/Suspected Mods?: .*?\((\S+?)\), Version/))) add({ type: "remove", modId: m[1] });
  }
  // Drop "install" fixes for things that aren't real mods
  // Never touch the game/loader itself, and never turn off Fabric API (it's always a victim, not the cause)
  return fixes.filter((f) =>
    !["minecraft", "java", "fabricloader"].includes(f.modId) &&
    !(f.type === "remove" && ["fabric-api", "fabric"].includes(f.modId)));
}

function disableMod(version, files) {
  const dir = modsDir(version);
  for (const f of files) {
    if (f.endsWith(".jar")) fs.renameSync(path.join(dir, f), path.join(dir, `${f}.disabled`));
  }
}

let lastCrash = null;

ipcMain.handle("crash:fix", async () => {
  if (!lastCrash) return { applied: [] };
  const { version, fixes } = lastCrash;
  const applied = [];
  for (const fix of fixes) {
    const index = await modIndex(version);
    try {
      if (fix.type === "install") {
        status(`Installing ${fix.modId}...`, null);
        const existing = index.get(fix.modId) || [];
        const disabled = existing.find((f) => f.endsWith(".disabled"));
        if (disabled) {
          // Already have it, just switched off
          fs.renameSync(path.join(modsDir(version), disabled), path.join(modsDir(version), disabled.slice(0, -9)));
        } else {
          await installModrinth(await findModrinthProject(fix.modId, version), version);
        }
        applied.push(`Installed ${fix.modId}`);
      } else if (fix.type === "update") {
        status(`Updating ${fix.name || fix.modId}...`, null);
        const old = index.get(fix.modId) || [];
        const projectId = await findModrinthProject(fix.modId, version);
        for (const f of old) fs.rmSync(path.join(modsDir(version), f), { force: true });
        const manifestPath = path.join(modsDir(version), ".fractur-mods.json");
        const manifest = readJson(manifestPath, {});
        delete manifest[projectId];
        writeJson(manifestPath, manifest);
        await installModrinth(projectId, version);
        applied.push(`Updated ${fix.name || fix.modId}`);
      } else if (fix.type === "remove") {
        disableMod(version, index.get(fix.modId) || []);
        applied.push(`Turned off ${fix.name || fix.modId}`);
      }
    } catch (e) {
      applied.push(`Couldn't fix ${fix.modId}: ${e.message}`);
    }
  }
  lastCrash = null;
  status("Fixed. Press Play to try again", null);
  return { applied };
});

function createWindow() {
  win = new BrowserWindow({
    width: 1260,
    height: 800,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    backgroundColor: "#0b0b10",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  win.loadFile(path.join(__dirname, "ui", "index.html"));
}

/* Skin and cape library */

const LIBRARY_KINDS = ["skins", "capes"];

function libraryDir(kind) {
  if (!LIBRARY_KINDS.includes(kind)) throw new Error("Unknown library");
  const dir = path.join(ROOT, kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function loadLibrary(kind) { return readJson(path.join(libraryDir(kind), "library.json"), []); }
function saveLibrary(kind, list) { writeJson(path.join(libraryDir(kind), "library.json"), list); }

function isPng(buf) {
  return buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47;
}

function addToLibrary(kind, buf, name, extra = {}) {
  if (!isPng(buf)) throw new Error("That isn't a PNG image");
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  fs.writeFileSync(path.join(libraryDir(kind), `${id}.png`), buf);
  const list = loadLibrary(kind);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  list.unshift({ id, name: (name || `${kind === "skins" ? "Skin" : "Cape"} ${list.length + 1}`).slice(0, 40), slim: false, width, height, added: Date.now(), ...extra });
  saveLibrary(kind, list);
  if (win) win.webContents.send("library-changed", kind);
  return id;
}

async function fetchImage(url) {
  const res = await fetch(url, { headers: { "User-Agent": "FractureClient/1.0" } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

ipcMain.handle("library:list", (_e, kind) =>
  loadLibrary(kind).map((item) => {
    const file = path.join(libraryDir(kind), `${item.id}.png`);
    if (!fs.existsSync(file)) return null;
    return { ...item, data: `data:image/png;base64,${fs.readFileSync(file).toString("base64")}` };
  }).filter(Boolean));

ipcMain.handle("library:import", async (_e, kind) => {
  const r = await dialog.showOpenDialog(win, {
    title: kind === "skins" ? "Import skins" : "Import capes",
    filters: [{ name: "PNG images", extensions: ["png"] }],
    properties: ["openFile", "multiSelections"],
  });
  if (r.canceled) return 0;
  for (const f of r.filePaths) addToLibrary(kind, fs.readFileSync(f), path.basename(f, ".png"));
  return r.filePaths.length;
});

ipcMain.handle("library:addUrl", async (_e, kind, url, name) => addToLibrary(kind, await fetchImage(url), name));

ipcMain.handle("library:update", (_e, kind, id, changes) => {
  const list = loadLibrary(kind);
  const item = list.find((i) => i.id === id);
  if (item) {
    if (typeof changes.name === "string") item.name = changes.name.slice(0, 40);
    if (typeof changes.slim === "boolean") item.slim = changes.slim;
  }
  saveLibrary(kind, list);
  return true;
});

ipcMain.handle("library:delete", (_e, kind, id) => {
  saveLibrary(kind, loadLibrary(kind).filter((i) => i.id !== id));
  fs.rmSync(path.join(libraryDir(kind), `${path.basename(id)}.png`), { force: true });
  return true;
});

ipcMain.handle("library:export", async (_e, kind, id) => {
  const item = loadLibrary(kind).find((i) => i.id === id);
  if (!item) return false;
  const r = await dialog.showSaveDialog(win, { defaultPath: `${item.name}.png`, filters: [{ name: "PNG", extensions: ["png"] }] });
  if (r.canceled || !r.filePath) return false;
  fs.copyFileSync(path.join(libraryDir(kind), `${item.id}.png`), r.filePath);
  return true;
});

// Uploads a library skin to the signed-in Minecraft account
ipcMain.handle("skin:apply", async (_e, id) => {
  const item = loadLibrary("skins").find((i) => i.id === id);
  if (!item) throw new Error("Skin not found");
  const auth = await freshAccount();
  const form = new FormData();
  form.append("variant", item.slim ? "slim" : "classic");
  form.append("file", new Blob([fs.readFileSync(path.join(libraryDir("skins"), `${item.id}.png`))], { type: "image/png" }), "skin.png");
  const res = await fetch("https://api.minecraftservices.com/minecraft/profile/skins", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.access_token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Minecraft rejected the skin (${res.status})`);
  return true;
});

/* Embedded sites */

const WEBVIEW_SITES = /^https:\/\/([\w-]+\.)?(tiktok\.com|mccapes\.net|skinmc\.net|namemc\.com|minecraftcapes\.net|spotify\.com|instagram\.com)\//;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function libraryKindFor(contents) {
  const { session } = require("electron");
  if (contents.session === session.fromPartition("persist:skins")) return "skins";
  if (contents.session === session.fromPartition("persist:capes")) return "capes";
  return null;
}

// Lock embedded pages down: only known sites may load in <webview>, with no node access
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (event, webPreferences, params) => {
    if (!WEBVIEW_SITES.test(params.src)) return event.preventDefault();
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });
  if (contents.getType() === "webview") {
    // Login popups (Google, etc.) open in a normal window sharing the same session
    contents.setWindowOpenHandler(() => ({ action: "allow", overrideBrowserWindowOptions: { width: 500, height: 700, autoHideMenuBar: true } }));

    // Right-click any image in the skin/cape sites to save it straight to the library
    contents.on("context-menu", (_ev, params) => {
      const kind = libraryKindFor(contents);
      if (!kind || params.mediaType !== "image" || !params.srcURL) return;
      const { Menu } = require("electron");
      Menu.buildFromTemplate([{
        label: kind === "skins" ? "Save to My Skins" : "Save to My Capes",
        click: async () => {
          try {
            const buf = params.srcURL.startsWith("data:")
              ? Buffer.from(params.srcURL.split(",")[1], "base64")
              : await fetchImage(params.srcURL);
            addToLibrary(kind, buf);
            status(`Saved to My ${kind === "skins" ? "Skins" : "Capes"}`, null);
          } catch (e) {
            status(`Couldn't save: ${e.message}`, null);
          }
        },
      }]).popup();
    });
  }
});

app.whenReady().then(async () => {
  // castLabs Electron: wait for the Widevine module so Spotify can play protected audio
  const { session, components } = require("electron");
  if (components) {
    try { await components.whenReady(); } catch (e) { console.error("Widevine unavailable:", e); }
  }
  // Chrome-like user agent so the embedded sites serve their normal pages
  for (const part of ["persist:tiktok", "persist:spotify", "persist:instagram", "persist:skins", "persist:capes", "persist:mccapes"]) {
    session.fromPartition(part).setUserAgent(BROWSER_UA);
  }
  // Downloads from the skin/cape editors land in the library instead of a save dialog
  for (const kind of LIBRARY_KINDS) {
    session.fromPartition(`persist:${kind}`).on("will-download", (_ev, item) => {
      const tmp = path.join(os.tmpdir(), `fracture-${Date.now()}-${path.basename(item.getFilename())}`);
      item.setSavePath(tmp);
      item.once("done", (_e, state) => {
        if (state !== "completed") return;
        try {
          addToLibrary(kind, fs.readFileSync(tmp), path.basename(item.getFilename(), path.extname(item.getFilename())));
          status(`Saved ${item.getFilename()} to My ${kind === "skins" ? "Skins" : "Capes"}`, null);
        } catch (e) {
          status(`Download wasn't a PNG: ${e.message}`, null);
        }
        fs.rmSync(tmp, { force: true });
      });
    });
  }
  createWindow();
});
app.on("window-all-closed", () => app.quit());

ipcMain.handle("window", (_e, action) => {
  if (action === "close") win.close();
  else if (action === "min") win.minimize();
  else if (action === "max") win.isMaximized() ? win.unmaximize() : win.maximize();
});

ipcMain.handle("settings:get", () => ({ ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) }));
ipcMain.handle("settings:set", (_e, s) => { writeJson(SETTINGS_FILE, s); return true; });

ipcMain.handle("versions", async () => {
  const manifest = await getJson("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
  return manifest.versions.filter((v) => v.type === "release").map((v) => v.id);
});

// { active: uuid, list: [{ refresh, mclc }] }
function loadAccounts() {
  const data = readJson(ACCOUNTS_FILE, null);
  if (data) return data;
  // Older builds kept a single account in account.json
  const single = readJson(ACCOUNT_FILE, null);
  return single ? { active: single.mclc.uuid, list: [single] } : { active: null, list: [] };
}

function saveAccount(xbox, mc) {
  const data = loadAccounts();
  const entry = { refresh: xbox.save(), mclc: mc.mclc() };
  data.list = data.list.filter((a) => a.mclc.uuid !== entry.mclc.uuid).concat(entry);
  data.active = entry.mclc.uuid;
  writeJson(ACCOUNTS_FILE, data);
  return { name: entry.mclc.name, uuid: entry.mclc.uuid };
}

function activeAccount() {
  const data = loadAccounts();
  return data.list.find((a) => a.mclc.uuid === data.active) || null;
}

ipcMain.handle("account:get", () => {
  const acc = activeAccount();
  return acc ? { name: acc.mclc.name, uuid: acc.mclc.uuid } : null;
});

ipcMain.handle("accounts:list", () => {
  const data = loadAccounts();
  return data.list.map((a) => ({ name: a.mclc.name, uuid: a.mclc.uuid, active: a.mclc.uuid === data.active }));
});

ipcMain.handle("accounts:select", (_e, uuid) => {
  const data = loadAccounts();
  if (data.list.some((a) => a.mclc.uuid === uuid)) data.active = uuid;
  writeJson(ACCOUNTS_FILE, data);
  return true;
});

ipcMain.handle("accounts:remove", (_e, uuid) => {
  const data = loadAccounts();
  data.list = data.list.filter((a) => a.mclc.uuid !== uuid);
  if (data.active === uuid) data.active = data.list.length ? data.list[0].mclc.uuid : null;
  writeJson(ACCOUNTS_FILE, data);
  return true;
});

ipcMain.handle("account:login", async () => {
  const auth = new Auth("select_account");
  const xbox = await auth.launch("electron");
  return saveAccount(xbox, await xbox.getMinecraft());
});

// "Via link": Microsoft device-code login (enter a code at microsoft.com/link)
const QRCode = require("qrcode");
const MS_CLIENT = "00000000402b5328"; // same client msmc uses, so its refresh() accepts our token
let deviceLogin = 0;

async function postForm(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return res.json();
}

ipcMain.handle("account:deviceStart", async () => {
  const id = ++deviceLogin;
  const dc = await postForm("https://login.live.com/oauth20_connect.srf", {
    client_id: MS_CLIENT,
    scope: "XboxLive.signin offline_access",
    response_type: "device_code",
  });
  if (!dc.user_code) throw new Error(dc.error_description || "Couldn't get a login code");
  const qr = await QRCode.toDataURL(`${dc.verification_uri}?otc=${dc.user_code}`, { margin: 1, width: 220 });

  (async () => {
    const deadline = Date.now() + dc.expires_in * 1000;
    let interval = (dc.interval || 5) * 1000;
    while (id === deviceLogin && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (id !== deviceLogin) return;
      try {
        const tok = await postForm("https://login.live.com/oauth20_token.srf", {
          client_id: MS_CLIENT,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: dc.device_code,
        });
        if (tok.error === "authorization_pending") continue;
        if (tok.error === "slow_down") { interval += 5000; continue; }
        if (tok.error) throw new Error(tok.error_description || tok.error);
        const xbox = await new Auth("select_account").refresh(tok.refresh_token);
        const acc = saveAccount(xbox, await xbox.getMinecraft());
        win.webContents.send("device-done", acc);
        return;
      } catch (e) {
        win.webContents.send("device-error", e.message || String(e));
        return;
      }
    }
    if (id === deviceLogin) win.webContents.send("device-error", "The code expired, try again");
  })();

  return { code: dc.user_code, url: dc.verification_uri, qr };
});

ipcMain.handle("account:deviceCancel", () => { deviceLogin++; return true; });

ipcMain.handle("open-external", (_e, url) => {
  if (/^https:\/\/(www\.)?microsoft\.com\/link/.test(url)) shell.openExternal(url);
});

ipcMain.handle("open-folder", () => shell.openPath(ROOT));

// News posts are published to the GitHub repo by the Fracture News Editor app
const NEWS_URL = "https://raw.githubusercontent.com/dxtrenn/fracture-client/main/news.json";

ipcMain.handle("news:get", async () => {
  const data = await getJson(`${NEWS_URL}?t=${Date.now()}`);
  return Array.isArray(data.posts) ? data.posts.slice(0, 20) : [];
});

ipcMain.handle("news:open", (_e, url) => {
  if (/^https:\/\//.test(String(url))) shell.openExternal(url);
});

ipcMain.handle("server:ping", async (_e, ip) => {
  try {
    const r = await getJson(`https://api.mcsrvstat.us/3/${encodeURIComponent(ip)}`);
    return { online: !!r.online, players: r.players ? r.players.online : 0, icon: r.icon || null };
  } catch {
    return { online: false, players: 0, icon: null };
  }
});

function modsDir(version) {
  const dir = path.join(ROOT, "instances", version, "mods");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const yauzl = require("yauzl");
const jarMetaCache = new Map();

function readEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  });
}

// Pulls name, authors and icon out of a mod jar's fabric.mod.json
function readJarMeta(file) {
  return new Promise((resolve) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) return resolve({});
      const entries = new Map();
      zip.on("entry", (e) => { entries.set(e.fileName, e); zip.readEntry(); });
      zip.on("error", () => resolve({}));
      zip.on("end", async () => {
        try {
          const metaEntry = entries.get("fabric.mod.json");
          if (!metaEntry) return resolve({});
          const meta = JSON.parse((await readEntry(zip, metaEntry)).toString("utf8").replace(/^﻿/, ""));
          const authors = (meta.authors || []).map((a) => (typeof a === "string" ? a : a.name)).filter(Boolean);
          let iconPath = meta.icon;
          if (iconPath && typeof iconPath === "object") iconPath = iconPath[Object.keys(iconPath).sort((a, b) => b - a)[0]];
          let icon = null;
          const iconEntry = iconPath && entries.get(iconPath.replace(/^\//, ""));
          if (iconEntry && iconEntry.uncompressedSize < 2_000_000) {
            icon = `data:image/png;base64,${(await readEntry(zip, iconEntry)).toString("base64")}`;
          }
          resolve({ id: meta.id, name: meta.name, authors, icon, description: meta.description });
        } catch {
          resolve({});
        } finally {
          zip.close();
        }
      });
      zip.readEntry();
    });
  });
}

ipcMain.handle("mods:list", async (_e, version) => {
  const dir = modsDir(version);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jar") || f.endsWith(".jar.disabled"));
  const mods = await Promise.all(files.map(async (f) => {
    const full = path.join(dir, f);
    const key = `${f.replace(/\.disabled$/, "")}:${fs.statSync(full).size}`;
    if (!jarMetaCache.has(key)) jarMetaCache.set(key, await readJarMeta(full));
    const meta = jarMetaCache.get(key);
    return {
      file: f,
      fileName: f.replace(/\.disabled$/, "").replace(/\.jar$/, ""),
      name: meta.name || f.replace(/\.disabled$/, "").replace(/\.jar$/, ""),
      authors: meta.authors || [],
      icon: meta.icon || null,
      enabled: f.endsWith(".jar"),
    };
  }));
  return mods.sort((a, b) => a.name.localeCompare(b.name));
});

ipcMain.handle("mods:toggle", (_e, version, file) => {
  const dir = modsDir(version);
  const target = file.endsWith(".disabled") ? file.slice(0, -9) : `${file}.disabled`;
  fs.renameSync(path.join(dir, file), path.join(dir, target));
  return true;
});

ipcMain.handle("mods:open", (_e, version) => shell.openPath(modsDir(version)));

ipcMain.handle("modrinth:search", async (_e, query, version) => {
  const facets = encodeURIComponent(JSON.stringify([["categories:fabric"], [`versions:${version}`], ["project_type:mod"]]));
  const r = await getJson(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${facets}&limit=30&index=${query ? "relevance" : "downloads"}`);
  return r.hits.map((h) => ({ id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url, downloads: h.downloads, author: h.author }));
});

// Installs the newest Fabric build of a project for this version, plus its required dependencies
async function installModrinth(projectId, version, seen = new Set()) {
  if (seen.has(projectId)) return;
  seen.add(projectId);
  const dir = modsDir(version);
  const manifestPath = path.join(dir, ".fractur-mods.json");
  const q = encodeURIComponent(JSON.stringify([version]));
  const versions = await getJson(`https://api.modrinth.com/v2/project/${projectId}/version?loaders=%5B%22fabric%22%5D&game_versions=${q}`);
  if (!versions.length) throw new Error(`No Fabric build for ${version}`);
  const v = versions[0];
  const file = v.files.find((f) => f.primary) || v.files[0];
  const manifest = readJson(manifestPath, {});
  if (!fs.existsSync(path.join(dir, file.filename)) && !fs.existsSync(path.join(dir, `${file.filename}.disabled`))) {
    if (manifest[projectId]) fs.rmSync(path.join(dir, manifest[projectId]), { force: true });
    await download(file.url, path.join(dir, file.filename));
    log(`[modrinth] installed ${file.filename}`);
  }
  manifest[projectId] = file.filename;
  writeJson(manifestPath, manifest);
  for (const dep of v.dependencies || []) {
    if (dep.dependency_type === "required" && dep.project_id) await installModrinth(dep.project_id, version, seen);
  }
}

ipcMain.handle("modrinth:install", (_e, projectId, version) => installModrinth(projectId, version));

/* Drag and drop */

function instanceDir(version, sub) {
  const dir = path.join(ROOT, "instances", version, sub || "");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle("mods:addFiles", async (_e, version, files) => {
  let mods = 0, packs = 0;
  for (const file of files) {
    const lower = file.toLowerCase();
    if (lower.endsWith(".jar")) {
      fs.copyFileSync(file, path.join(instanceDir(version, "mods"), path.basename(file)));
      mods++;
    } else if (lower.endsWith(".mrpack")) {
      const r = await importArchive(file, version);
      mods += r.mods;
      packs += r.resourcepacks;
    } else if (lower.endsWith(".zip")) {
      fs.copyFileSync(file, path.join(instanceDir(version, "resourcepacks"), path.basename(file)));
      packs++;
    }
  }
  return { mods, packs };
});

/* Profile import from other launchers */

const MC_VERSION = /\b(1\.\d+(?:\.\d+)?|2\d\.\d+(?:\.\d+)?)\b/;

function firstDir(base, names) {
  for (const n of names) {
    const p = path.join(base, n);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  return null;
}

function subdirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name)); } catch { return []; }
}

function countJars(dir) {
  try { return fs.readdirSync(path.join(dir, "mods")).filter((f) => f.endsWith(".jar")).length; } catch { return 0; }
}

ipcMain.handle("import:scan", () => {
  const appData = app.getPath("appData");
  const home = os.homedir();
  const found = [];
  const add = (source, name, version, gameDir) => {
    if (gameDir) found.push({ source, name, version, gameDir, mods: countJars(gameDir) });
  };

  for (const dir of subdirs(path.join(appData, "PrismLauncher", "instances"))) {
    const pack = readJson(path.join(dir, "mmc-pack.json"), null);
    if (!pack) continue;
    const mc = (pack.components || []).find((c) => c.uid === "net.minecraft");
    add("Prism", path.basename(dir), mc && mc.version, firstDir(dir, ["minecraft", ".minecraft"]));
  }

  for (const dir of subdirs(path.join(appData, "ModrinthApp", "profiles"))) {
    const m = path.basename(dir).match(MC_VERSION);
    add("Modrinth", path.basename(dir), m && m[1], dir);
  }

  for (const dir of subdirs(path.join(home, ".lunarclient", "profiles"))) {
    const m = path.basename(dir).match(MC_VERSION);
    add("Lunar", path.basename(dir), m && m[1], dir);
  }

  for (const dir of subdirs(path.join(appData, ".dawn", "profiles"))) {
    const p = readJson(path.join(dir, "profile.json"), null);
    if (!p || !p.profile) continue;
    add("Dawn", p.profile.name || path.basename(dir), p.profile.minecraftVersion, firstDir(dir, ["private-game-content", ".minecraft"]));
  }

  // Feather only keeps user mods, one folder per version ("1.21.4-fabric")
  for (const dir of subdirs(path.join(appData, ".feather", "user-mods"))) {
    const m = path.basename(dir).match(MC_VERSION);
    found.push({ source: "Feather", name: path.basename(dir), version: m && m[1], gameDir: dir, modsOnly: true, mods: fs.readdirSync(dir).filter((f) => f.endsWith(".jar")).length });
  }

  return found;
});

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) n += copyDir(s, d);
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

// Other launchers' own client mods only run inside those launchers (they need their bundled libraries)
const LAUNCHER_ONLY_MOD = /^(dawn-client|feather[-_ ]|lunar[-_ ]?client)/i;

function copyMods(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(src)) {
    if (!/\.jar(\.disabled)?$/i.test(f) || LAUNCHER_ONLY_MOD.test(f)) continue;
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
    n++;
  }
  return n;
}

function importGameDir(gameDir, version, modsOnly) {
  const target = instanceDir(version);
  if (modsOnly) return { mods: copyMods(gameDir, path.join(target, "mods")), resourcepacks: 0, shaderpacks: 0 };
  const result = {
    mods: copyMods(path.join(gameDir, "mods"), path.join(target, "mods")),
    resourcepacks: copyDir(path.join(gameDir, "resourcepacks"), path.join(target, "resourcepacks")),
    shaderpacks: copyDir(path.join(gameDir, "shaderpacks"), path.join(target, "shaderpacks")) + copyDir(path.join(gameDir, "shaders"), path.join(target, "shaderpacks")),
  };
  copyDir(path.join(gameDir, "config"), path.join(target, "config"));
  for (const f of ["options.txt", "optionsshaders.txt", "servers.dat"]) {
    const s = path.join(gameDir, f);
    if (fs.existsSync(s) && !fs.existsSync(path.join(target, f))) fs.copyFileSync(s, path.join(target, f));
  }
  return result;
}

ipcMain.handle("import:run", (_e, gameDir, version, modsOnly) => importGameDir(gameDir, version, modsOnly));

// Finds the folder inside an extracted export that actually holds the game files
function findGameDir(dir, depth = 0) {
  if (["mods", "resourcepacks", "shaderpacks"].some((n) => fs.existsSync(path.join(dir, n)))) return dir;
  if (depth > 3) return null;
  for (const sub of subdirs(dir)) {
    const hit = findGameDir(sub, depth + 1);
    if (hit) return hit;
  }
  return null;
}

async function importArchive(file, fallbackVersion) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fracture-import-"));
  try {
    await extract(file, { dir: tmp });
    const index = readJson(path.join(tmp, "modrinth.index.json"), null);
    if (index) {
      // Modrinth pack: files are listed with download URLs, extras live in overrides/
      const version = (index.dependencies && index.dependencies.minecraft) || fallbackVersion;
      const target = instanceDir(version);
      let done = 0;
      for (const f of index.files || []) {
        if (f.env && f.env.client === "unsupported") continue;
        const dest = path.resolve(target, f.path);
        if (!dest.startsWith(target)) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        status(`Importing ${index.name || "pack"}...`, done++ / index.files.length);
        await download(f.downloads[0], dest);
      }
      copyDir(path.join(tmp, "overrides"), target);
      copyDir(path.join(tmp, "client-overrides"), target);
      status("Import finished", null);
      return { version, name: index.name, mods: countJars(target), resourcepacks: 0 };
    }

    // Prism export: version from mmc-pack.json
    let version = fallbackVersion;
    const packFile = [tmp, ...subdirs(tmp)].map((d) => path.join(d, "mmc-pack.json")).find((p) => fs.existsSync(p));
    if (packFile) {
      const mc = (readJson(packFile, {}).components || []).find((c) => c.uid === "net.minecraft");
      if (mc) version = mc.version;
    }
    const gameDir = findGameDir(tmp);
    if (!gameDir) throw new Error("Couldn't find mods or resource packs in that file");
    return { version, ...importGameDir(gameDir, version) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

ipcMain.handle("import:file", async (_e, fallbackVersion) => {
  const r = await dialog.showOpenDialog(win, {
    title: "Import profile",
    filters: [{ name: "Profiles", extensions: ["mrpack", "zip"] }],
    properties: ["openFile"],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return importArchive(r.filePaths[0], fallbackVersion);
});

ipcMain.handle("import:folder", async (_e, fallbackVersion) => {
  const r = await dialog.showOpenDialog(win, { title: "Import profile folder", properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  const gameDir = findGameDir(r.filePaths[0]);
  if (!gameDir) throw new Error("Couldn't find mods or resource packs in that folder");
  return { version: fallbackVersion, ...importGameDir(gameDir, fallbackVersion) };
});

/* Capes (official Mojang capes on the signed-in account) */

function apiRequest(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "FractureClient/1.0",
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let out = "";
      res.on("data", (c) => (out += c));
      res.on("end", () => {
        if (res.statusCode >= 400) return reject(new Error(`Minecraft API error ${res.statusCode}`));
        try { resolve(out ? JSON.parse(out) : {}); } catch { resolve({}); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

ipcMain.handle("capes:owned", async () => {
  const auth = await freshAccount();
  const profile = await apiRequest("GET", PROFILE_URL, auth.access_token);
  return (profile.capes || []).map((c) => ({ id: c.id, name: c.alias, url: c.url, active: c.state === "ACTIVE" }));
});

ipcMain.handle("capes:equip", async (_e, capeId) => {
  const auth = await freshAccount();
  if (capeId) await apiRequest("PUT", `${PROFILE_URL}/capes/active`, auth.access_token, { capeId });
  else await apiRequest("DELETE", `${PROFILE_URL}/capes/active`, auth.access_token);
  return true;
});

ipcMain.handle("mods:delete", (_e, version, file) => {
  fs.rmSync(path.join(modsDir(version), path.basename(file)), { force: true });
  return true;
});

async function freshAccount() {
  const acc = activeAccount();
  if (!acc) throw new Error("Log in with your Microsoft account first");
  // Minecraft tokens expire after a day, so refresh before every launch
  const auth = new Auth("select_account");
  const xbox = await auth.refresh(acc.refresh);
  const mc = await xbox.getMinecraft();
  saveAccount(xbox, mc);
  return mc.mclc();
}

let running = false;

ipcMain.handle("launch", async (_e, { server }) => {
  if (running) throw new Error("Minecraft is already running");
  running = true;
  try {
    const s = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
    status("Signing in...", null);
    const authorization = await freshAccount();
    const javaPath = await ensureJava(javaMajorFor(s.version));

    const useFabric = s.loader === "fabric";
    let custom;
    if (useFabric) {
      custom = await ensureFabric(s.version);
      if (s.pvpMods) await ensureMods(s.version);
    }

    const instanceDir = path.join(ROOT, "instances", s.version);
    fs.mkdirSync(instanceDir, { recursive: true });

    const opts = {
      root: ROOT,
      authorization,
      javaPath,
      version: { number: s.version, type: "release", ...(custom ? { custom } : {}) },
      memory: { min: `${s.ramMin}G`, max: `${s.ramMax}G` },
      window: s.fullscreen ? { fullscreen: true } : { width: s.width, height: s.height },
      // fabric.noGui: report mod errors in the log instead of Fabric's popup, so we can offer a fix
      customArgs: ["-Dfabric.noGui=true", ...s.jvmArgs.split(/\s+/).filter(Boolean)],
      overrides: { gameDirectory: instanceDir, detached: false },
    };
    if (server) {
      const [host, port] = server.split(":");
      opts.quickPlay = { type: "multiplayer", identifier: `${host}:${port || 25565}` };
      opts.server = { host, port: port || "25565" };
    }

    const launcher = new Client();
    launcher.on("debug", log);
    let output = "";
    launcher.on("data", (d) => {
      log(d);
      output += d;
      if (output.length > 2_000_000) output = output.slice(-1_000_000);
    });
    launcher.on("progress", (p) => status(`Downloading ${p.type}...`, p.total ? p.task / p.total : null));
    launcher.on("close", (code) => {
      running = false;
      win.webContents.send("game-closed");
      if (code !== 0 && code !== null) {
        const fixes = analyzeCrash(output);
        lastCrash = { version: s.version, fixes };
        status(`Game crashed (code ${code})`, null);
        if (s.closeOnLaunch) win.show();
        win.webContents.send("game-crashed", { fixes });
        return;
      }
      status(`Game closed (code ${code})`, null);
      if (s.closeOnLaunch) app.quit();
    });

    status("Launching...", null);
    const proc = await launcher.launch(opts);
    if (!proc) throw new Error("Launch failed, check the console for details");
    status("Playing", null);
    win.webContents.send("game-started");
    if (s.closeOnLaunch) win.hide();
    return true;
  } catch (e) {
    running = false;
    status(`Error: ${e.message}`, null);
    throw e;
  }
});
