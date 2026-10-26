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
  fractureMod: true,
};

let win;

/* Profiles: each one is a named setup (version + loader) with its own game folder in instances/<id> */

const PROFILES_FILE = path.join(ROOT, "profiles.json");
const MC_VERSION_RE = /^(1\.\d+(\.\d+)?|2\d\.\d+(\.\d+)?)$/;

function loadProfiles() {
  const data = readJson(PROFILES_FILE, null);
  if (data && Array.isArray(data.list) && data.list.length) return data;
  // First run with profiles: every existing per-version folder becomes a profile with the same id
  const s = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
  const instances = path.join(ROOT, "instances");
  let dirs = [];
  try { dirs = fs.readdirSync(instances).filter((d) => MC_VERSION_RE.test(d) && fs.statSync(path.join(instances, d)).isDirectory()); } catch {}
  if (!dirs.includes(s.version)) dirs.unshift(s.version);
  const list = dirs.map((v) => ({ id: v, name: `${v} ${s.loader === "fabric" ? "Fabric" : "Vanilla"}`, version: v, loader: s.loader, created: Date.now() }));
  const migrated = { active: s.version, list };
  writeJson(PROFILES_FILE, migrated);
  return migrated;
}
function saveProfiles(data) { writeJson(PROFILES_FILE, data); }

function profileById(id) {
  return loadProfiles().list.find((p) => p.id === id) || null;
}
function activeProfile() {
  const data = loadProfiles();
  return data.list.find((p) => p.id === data.active) || data.list[0];
}
// Minecraft version for a profile id (older code paths passed a bare version as the id)
function mcVersionOf(id) {
  const p = profileById(id);
  return p ? p.version : id;
}

function newProfileId(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "profile";
  const taken = new Set(loadProfiles().list.map((p) => p.id));
  let id = base;
  for (let i = 2; taken.has(id) || MC_VERSION_RE.test(id); i++) id = `${base}-${i}`;
  return id;
}

function createProfile({ name, version, loader }) {
  if (!MC_VERSION_RE.test(String(version))) throw new Error("Pick a Minecraft version");
  const data = loadProfiles();
  const profile = {
    id: newProfileId(name || version),
    name: String(name || `${version} ${loader === "vanilla" ? "Vanilla" : "Fabric"}`).slice(0, 32),
    version,
    loader: loader === "vanilla" ? "vanilla" : "fabric",
    created: Date.now(),
  };
  data.list.push(profile);
  saveProfiles(data);
  fs.mkdirSync(path.join(ROOT, "instances", profile.id, "mods"), { recursive: true });
  return profile;
}

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

const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";

// Where the java binary sits inside an extracted Temurin download on each OS
function javaBinIn(home) {
  if (IS_WIN) return path.join(home, "bin", "javaw.exe");
  if (IS_MAC) return path.join(home, "Contents", "Home", "bin", "java");
  return path.join(home, "bin", "java");
}

function untar(file, dir) {
  return new Promise((resolve, reject) => {
    require("child_process").execFile("tar", ["-xzf", file, "-C", dir], (err) => (err ? reject(err) : resolve()));
  });
}

async function ensureJava(major) {
  const dir = path.join(ROOT, "runtime", `java${major}`);
  const findExe = (d) => {
    if (!fs.existsSync(d)) return null;
    for (const entry of fs.readdirSync(d)) {
      const exe = javaBinIn(path.join(d, entry));
      if (fs.existsSync(exe)) return exe;
    }
    return null;
  };
  const existing = findExe(dir);
  if (existing) return existing;

  status(`Downloading Java ${major}...`, 0);
  fs.mkdirSync(dir, { recursive: true });
  const os = IS_WIN ? "windows" : IS_MAC ? "mac" : "linux";
  const archive = path.join(dir, IS_WIN ? "jre.zip" : "jre.tar.gz");
  const urlFor = (arch) => `https://api.adoptium.net/v3/binary/latest/${major}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;
  const arch = process.arch === "arm64" ? "aarch64" : "x64";
  try {
    await download(urlFor(arch), archive, (p) => status(`Downloading Java ${major}...`, p));
  } catch (e) {
    // Java 8 has no Apple Silicon build, so fall back to Intel Java (runs through Rosetta)
    if (arch === "x64") throw e;
    await download(urlFor("x64"), archive, (p) => status(`Downloading Java ${major}...`, p));
  }
  status(`Extracting Java ${major}...`, null);
  if (IS_WIN) await extract(archive, { dir });
  else await untar(archive, dir);
  fs.unlinkSync(archive);
  const exe = findExe(dir);
  if (!exe) throw new Error("The Java download didn't contain a Java program");
  if (!IS_WIN) fs.chmodSync(exe, 0o755);
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

/* Fracture in-game mod (Right Shift menu), shipped inside the launcher */

const FRACTURE_MOD_VERSIONS = ["1.21.11"];
const FRACTURE_MOD_FILE = "fracture-mod.jar";

function bundledFractureMod() {
  const packaged = path.join(process.resourcesPath || "", FRACTURE_MOD_FILE);
  if (fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, "..", "resources", FRACTURE_MOD_FILE);
  return fs.existsSync(dev) ? dev : null;
}

function ensureFractureMod(profile) {
  if (profile.loader !== "fabric" || !FRACTURE_MOD_VERSIONS.includes(profile.version)) return;
  const src = bundledFractureMod();
  if (!src) return;
  const dir = modsDir(profile.id);
  const dest = path.join(dir, FRACTURE_MOD_FILE);
  // Respect the user turning it off in the Installed tab
  if (fs.existsSync(`${dest}.disabled`)) return;
  // Always rewritten (it is tiny), which also repairs a copy that got marked hidden
  {
    // Write a fresh file instead of copying: a copy keeps Windows attributes like Hidden,
    // and Fabric skips hidden jars
    fs.rmSync(dest, { force: true });
    fs.writeFileSync(dest, fs.readFileSync(src));
    log("[fracture] installed the Fracture in-game menu (F9)");
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
  const facets = encodeURIComponent(JSON.stringify([["categories:fabric"], [`versions:${mcVersionOf(version)}`], ["project_type:mod"]]));
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
    // Mac keeps its native traffic-light buttons; Windows draws its own
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 28 } } : { frame: false }),
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

ipcMain.handle("profiles:list", () => loadProfiles());

ipcMain.handle("profiles:create", (_e, opts) => createProfile(opts || {}));

ipcMain.handle("profiles:update", (_e, id, changes) => {
  const data = loadProfiles();
  const p = data.list.find((x) => x.id === id);
  if (!p) throw new Error("Profile not found");
  if (typeof changes.name === "string" && changes.name.trim()) p.name = changes.name.trim().slice(0, 32);
  if (MC_VERSION_RE.test(String(changes.version || ""))) p.version = changes.version;
  if (changes.loader === "fabric" || changes.loader === "vanilla") p.loader = changes.loader;
  saveProfiles(data);
  return p;
});

ipcMain.handle("profiles:select", (_e, id) => {
  const data = loadProfiles();
  if (data.list.some((p) => p.id === id)) data.active = id;
  saveProfiles(data);
  return true;
});

// Copies mods, packs and settings into a brand-new profile
ipcMain.handle("profiles:duplicate", (_e, id) => {
  const src = profileById(id);
  if (!src) throw new Error("Profile not found");
  const copy = createProfile({ name: `${src.name} copy`, version: src.version, loader: src.loader });
  const from = path.join(ROOT, "instances", src.id);
  for (const sub of ["mods", "resourcepacks", "shaderpacks", "config"]) copyDir(path.join(from, sub), path.join(ROOT, "instances", copy.id, sub));
  for (const f of ["options.txt", "optionsshaders.txt", "servers.dat"]) {
    if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(ROOT, "instances", copy.id, f));
  }
  return copy;
});

ipcMain.handle("profiles:delete", (_e, id) => {
  const data = loadProfiles();
  if (data.list.length <= 1) throw new Error("You need at least one profile");
  data.list = data.list.filter((p) => p.id !== id);
  if (data.active === id) data.active = data.list[0].id;
  saveProfiles(data);
  // Worlds and screenshots live in the folder too, so it goes to the Recycle Bin rather than being erased
  const dir = path.join(ROOT, "instances", path.basename(id));
  if (fs.existsSync(dir)) shell.trashItem(dir).catch(() => {});
  return true;
});

ipcMain.handle("profiles:open", (_e, id) => shell.openPath(instanceDir(id)));

// Quick counts for the Profiles page (file counts only, no jar reading)
ipcMain.handle("profiles:stats", () => {
  const count = (dir, re) => { try { return fs.readdirSync(dir).filter((f) => re.test(f)).length; } catch { return 0; } };
  const out = {};
  for (const p of loadProfiles().list) {
    const base = path.join(ROOT, "instances", p.id);
    out[p.id] = {
      mods: count(path.join(base, "mods"), /.jar$/i),
      packs: count(path.join(base, "resourcepacks"), /.zip$/i),
      shaders: count(path.join(base, "shaderpacks"), /.zip$/i),
      lastPlayed: p.lastPlayed || null,
    };
  }
  return out;
});

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

// Multiplayer servers saved in every profile (ours first, then other launchers), deduped by address
ipcMain.handle("servers:saved", () => {
  const { readServersDat } = require("./nbt");
  const appData = app.getPath("appData");
  const files = [];
  for (const p of loadProfiles().list) files.push(path.join(ROOT, "instances", p.id, "servers.dat"));
  files.push(path.join(IS_MAC ? appData : appData, IS_MAC ? "minecraft" : ".minecraft", "servers.dat"));
  for (const d of subdirs(path.join(appData, "PrismLauncher", "instances"))) files.push(path.join(d, "minecraft", "servers.dat"), path.join(d, ".minecraft", "servers.dat"));
  for (const d of subdirs(path.join(appData, "ModrinthApp", "profiles"))) files.push(path.join(d, "servers.dat"));
  for (const d of subdirs(path.join(appData, ".dawn", "profiles"))) files.push(path.join(d, ".minecraft", "servers.dat"), path.join(d, "private-game-content", "servers.dat"));
  for (const d of subdirs(path.join(os.homedir(), ".lunarclient", "profiles"))) files.push(path.join(d, "servers.dat"));

  const seen = new Set();
  const out = [];
  for (const f of files) {
    let list;
    try { list = readServersDat(fs.readFileSync(f)); } catch { continue; }
    for (const s of list) {
      const key = s.ip.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
});

/* Self-update from GitHub releases */

const RELEASES_API = "https://api.github.com/repos/Dxtrenn/fracture-client/releases/latest";
let pendingUpdate = null;

function newerVersion(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// The installer for this computer among a release's files
function pickAsset(assets) {
  if (IS_WIN) return assets.find((a) => /\.exe$/i.test(a.name));
  if (IS_MAC) {
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    return assets.find((a) => a.name.endsWith(".dmg") && a.name.includes(`mac-${arch}`)) || assets.find((a) => a.name.endsWith(".dmg"));
  }
  return null;
}

ipcMain.handle("update:check", async () => {
  const current = app.getVersion();
  try {
    const rel = await getJson(RELEASES_API);
    const asset = pickAsset(rel.assets || []);
    if (!rel.tag_name || !asset || !newerVersion(rel.tag_name, current)) return { available: false, current };
    pendingUpdate = { version: rel.tag_name.replace(/^v/, ""), url: asset.browser_download_url, name: asset.name, notes: rel.body || "" };
    return { available: true, current, version: pendingUpdate.version, notes: pendingUpdate.notes };
  } catch {
    return { available: false, current };
  }
});

ipcMain.handle("update:install", async () => {
  if (!pendingUpdate) throw new Error("No update found");
  const dest = path.join(app.getPath("downloads"), pendingUpdate.name);
  status(`Downloading Fracture ${pendingUpdate.version}...`, 0);
  await download(pendingUpdate.url, dest, (p) => status(`Downloading Fracture ${pendingUpdate.version}...`, p));
  if (IS_WIN) {
    // Run the installer on its own and close the launcher so it can replace the files
    status("Starting the installer...", null);
    require("child_process").spawn(dest, [], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => app.quit(), 800);
  } else {
    status("Update downloaded. Drag Fracture Client into Applications to finish.", null);
    shell.openPath(dest);
  }
  return true;
});

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
          const meta = JSON.parse((await readEntry(zip, metaEntry)).toString("utf8").replace(/^ï»¿/, ""));
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

/* Modrinth browser: mods, modpacks, resource packs and shaders */

const MODRINTH_TYPES = { mod: "mod", modpack: "modpack", resourcepack: "resourcepack", shader: "shader" };
const MODRINTH_SORTS = new Set(["relevance", "downloads", "follows", "newest", "updated"]);

ipcMain.handle("modrinth:browse", async (_e, opts = {}) => {
  const type = MODRINTH_TYPES[opts.type] || "mod";
  const version = mcVersionOf(opts.profileId || activeProfile().id);
  const facets = [[`project_type:${type}`], [`versions:${version}`]];
  // Mods and modpacks must be Fabric; packs and shaders work with any loader
  if (type === "mod" || type === "modpack") facets.push(["categories:fabric"]);
  for (const c of opts.categories || []) facets.push([`categories:${c}`]);
  const sort = MODRINTH_SORTS.has(opts.sort) ? opts.sort : (opts.query ? "relevance" : "downloads");
  const limit = Math.min(50, Math.max(1, opts.limit || 20));
  const offset = Math.max(0, opts.offset || 0);
  const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(opts.query || "")}&facets=${encodeURIComponent(JSON.stringify(facets))}&index=${sort}&limit=${limit}&offset=${offset}`;
  const r = await getJson(url);
  return {
    total: r.total_hits,
    version,
    hits: r.hits.map((h) => ({
      id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url,
      downloads: h.downloads, follows: h.follows, author: h.author, updated: h.date_modified, type: h.project_type,
    })),
  };
});

let categoryCache = null;
ipcMain.handle("modrinth:categories", async (_e, type) => {
  if (!categoryCache) categoryCache = await getJson("https://api.modrinth.com/v2/tag/category");
  const t = MODRINTH_TYPES[type] || "mod";
  return categoryCache
    .filter((c) => c.project_type === t && c.header === "categories")
    .map((c) => c.name)
    .sort();
});

// Resource packs and shaders: newest file for this Minecraft version into the right folder
async function installPack(projectId, profileId, type) {
  const version = mcVersionOf(profileId);
  const q = encodeURIComponent(JSON.stringify([version]));
  const versions = await getJson(`https://api.modrinth.com/v2/project/${projectId}/version?game_versions=${q}`);
  if (!versions.length) throw new Error(`Nothing for ${version}`);
  const file = versions[0].files.find((f) => f.primary) || versions[0].files[0];
  const dir = instanceDir(profileId, type === "shader" ? "shaderpacks" : "resourcepacks");
  await download(file.url, path.join(dir, path.basename(file.filename)));
  log(`[modrinth] installed ${file.filename}`);
  return { file: file.filename };
}

// Modpacks become a new profile, imported from their .mrpack
async function installModpack(projectId, profileId) {
  const version = mcVersionOf(profileId);
  const q = encodeURIComponent(JSON.stringify([version]));
  let versions = await getJson(`https://api.modrinth.com/v2/project/${projectId}/version?loaders=%5B%22fabric%22%5D&game_versions=${q}`);
  if (!versions.length) versions = await getJson(`https://api.modrinth.com/v2/project/${projectId}/version?loaders=%5B%22fabric%22%5D`);
  if (!versions.length) throw new Error("No Fabric version of this modpack");
  const file = versions[0].files.find((f) => f.primary && f.filename.endsWith(".mrpack")) || versions[0].files.find((f) => f.filename.endsWith(".mrpack"));
  if (!file) throw new Error("This modpack has no .mrpack file");
  const tmp = path.join(os.tmpdir(), `fracture-${Date.now()}-${path.basename(file.filename)}`);
  status("Downloading modpack...", 0);
  await download(file.url, tmp, (p) => status("Downloading modpack...", p));
  try {
    return await importArchive(tmp, profileId);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

ipcMain.handle("modrinth:installType", async (_e, projectId, profileId, type) => {
  if (type === "modpack") return installModpack(projectId, profileId);
  if (type === "resourcepack" || type === "shader") return installPack(projectId, profileId, type);
  await installModrinth(projectId, profileId);
  return {};
});

// Installs the newest Fabric build of a project for this version, plus its required dependencies
async function installModrinth(projectId, version, seen = new Set()) {
  if (seen.has(projectId)) return;
  seen.add(projectId);
  const dir = modsDir(version);
  const manifestPath = path.join(dir, ".fractur-mods.json");
  const q = encodeURIComponent(JSON.stringify([mcVersionOf(version)]));
  const versions = await getJson(`https://api.modrinth.com/v2/project/${projectId}/version?loaders=%5B%22fabric%22%5D&game_versions=${q}`);
  if (!versions.length) throw new Error(`No Fabric build for ${mcVersionOf(version)}`);
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

ipcMain.handle("import:run", (_e, gameDir, version, modsOnly, name) => {
  const profile = createProfile({ name: name || `Imported ${version}`, version, loader: "fabric" });
  return { profileId: profile.id, version, name: profile.name, ...importGameDir(gameDir, profile.id, modsOnly) };
});

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

// Imported packs and folders always become a new profile, so they never mix with an existing setup
async function importArchive(file, fallbackProfileId) {
  const fallbackVersion = mcVersionOf(fallbackProfileId || activeProfile().id);
  const fileName = path.basename(file).replace(/.(mrpack|zip)$/i, "");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fracture-import-"));
  try {
    await extract(file, { dir: tmp });
    const index = readJson(path.join(tmp, "modrinth.index.json"), null);
    if (index) {
      // Modrinth pack: files are listed with download URLs, extras live in overrides/
      const version = (index.dependencies && index.dependencies.minecraft) || fallbackVersion;
      const profile = createProfile({ name: index.name || fileName, version, loader: "fabric" });
      const target = instanceDir(profile.id);
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
      return { profileId: profile.id, version, name: profile.name, mods: countJars(target), resourcepacks: 0 };
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
    const profile = createProfile({ name: fileName, version, loader: "fabric" });
    return { profileId: profile.id, version, name: profile.name, ...importGameDir(gameDir, profile.id) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

ipcMain.handle("import:file", async (_e, fallbackProfileId) => {
  const r = await dialog.showOpenDialog(win, {
    title: "Import profile",
    filters: [{ name: "Profiles", extensions: ["mrpack", "zip"] }],
    properties: ["openFile"],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return importArchive(r.filePaths[0], fallbackProfileId);
});

ipcMain.handle("import:folder", async (_e, fallbackProfileId) => {
  const r = await dialog.showOpenDialog(win, { title: "Import profile folder", properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  const gameDir = findGameDir(r.filePaths[0]);
  if (!gameDir) throw new Error("Couldn't find mods or resource packs in that folder");
  const profile = createProfile({ name: path.basename(r.filePaths[0]), version: mcVersionOf(fallbackProfileId || activeProfile().id), loader: "fabric" });
  return { profileId: profile.id, version: profile.version, name: profile.name, ...importGameDir(gameDir, profile.id) };
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

// Several games can run at once (any profile, even the same one twice)
let gamesRunning = 0;

ipcMain.handle("launch", async (_e, { server, profileId } = {}) => {
  try {
    const s = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
    const profile = (profileId && profileById(profileId)) || activeProfile();
    {
      const data = loadProfiles();
      const entry = data.list.find((p) => p.id === profile.id);
      if (entry) { entry.lastPlayed = Date.now(); saveProfiles(data); }
    }
    s.version = profile.version;
    s.loader = profile.loader;
    status("Signing in...", null);
    const authorization = await freshAccount();
    const javaPath = await ensureJava(javaMajorFor(s.version));

    const useFabric = s.loader === "fabric";
    let custom;
    if (useFabric) {
      custom = await ensureFabric(s.version);
      if (s.pvpMods) await ensureMods(profile.id);
      if (s.fractureMod !== false) ensureFractureMod(profile);
    }

    const instanceDir = path.join(ROOT, "instances", profile.id);
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
      // Detached so the game keeps running if the launcher is closed or restarted
      // cwd per profile so each game writes its own logs (two games at once would share one log otherwise)
      overrides: { gameDirectory: instanceDir, cwd: instanceDir, detached: true },
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
      gamesRunning = Math.max(0, gamesRunning - 1);
      if (win.isDestroyed()) return;
      win.webContents.send("game-closed", { running: gamesRunning });
      if (code !== 0 && code !== null) {
        const fixes = analyzeCrash(output);
        lastCrash = { version: profile.id, fixes };
        status(`Game crashed (code ${code})`, null);
        if (s.closeOnLaunch) win.show();
        win.webContents.send("game-crashed", { fixes });
        return;
      }
      status(gamesRunning ? `${profile.name} closed · ${gamesRunning} still running` : `Game closed (code ${code})`, null);
      if (s.closeOnLaunch && gamesRunning === 0) app.quit();
    });

    status("Launching...", null);
    const proc = await launcher.launch(opts);
    if (!proc) throw new Error("Launch failed, check the console for details");
    gamesRunning++;
    status(gamesRunning > 1 ? `Playing ${gamesRunning} games` : `Playing ${profile.name}`, null);
    win.webContents.send("game-started", { running: gamesRunning });
    if (s.closeOnLaunch) win.hide();
    return { running: gamesRunning };
  } catch (e) {
    status(`Error: ${e.message}`, null);
    throw e;
  }
});
