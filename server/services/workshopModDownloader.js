import { spawn } from "child_process";
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import os from "os";

// Project Zomboid's Steam App ID. Workshop items live under
// <force_install_dir>/steamapps/workshop/content/108600/<workshopId>.
const PZ_APP_ID = "108600";

// A Workshop download is normally a handful of seconds; five minutes is a
// generous ceiling that still bounds a stalled steamcmd instead of hanging a
// request (or the whole add-mod action) forever.
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Live download progress ────────────────────────────────────────────────
// A Workshop download runs synchronously inside POST /add-mod-advanced, so the
// UI has no streaming channel to it. Instead the downloader records progress in
// this in-process registry (fed from steamcmd's stdout) and the Mods page polls
// GET /download-progress while its add request is still in flight, which is
// what drives the per-item progress bar. No change to the add route's contract.
const downloadProgress = new Map(); // workshopId -> entry
const DOWNLOAD_PROGRESS_TTL_MS = 10 * 60 * 1000;

function updateDownloadProgress(workshopId, patch) {
  const key = String(workshopId);
  const prev = downloadProgress.get(key) || {
    active: false,
    phase: "idle",
    percent: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    error: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  downloadProgress.set(key, next);
  return next;
}

// Finished entries are kept briefly so a poll that started just before the
// request resolved can still read the final state, then dropped so a
// long-lived panel process cannot accumulate ids forever.
function pruneDownloadProgress(now = Date.now()) {
  for (const [key, entry] of downloadProgress) {
    if (!entry.active && now - entry.updatedAt > DOWNLOAD_PROGRESS_TTL_MS) {
      downloadProgress.delete(key);
    }
  }
}

export function getDownloadProgress(workshopId) {
  pruneDownloadProgress();
  const entry = downloadProgress.get(String(workshopId));
  return entry ? { ...entry } : null;
}

export function getAllDownloadProgress() {
  pruneDownloadProgress();
  const out = {};
  for (const [key, entry] of downloadProgress) out[key] = { ...entry };
  return out;
}

// The folder the game actually loads local mods from for a server whose data
// folder ("cachedir") is <zomboidDataPath>. The game reads Mods= by mod.info
// id= from here; on a No-Steam server the Steam workshop folders are NOT
// scanned, which is exactly why a Workshop mod has to be mirrored here.
export function zomboidModsDir(zomboidDataPath) {
  return zomboidDataPath ? path.join(zomboidDataPath, "mods") : null;
}

export function workshopContentDir(installPath, workshopId) {
  return path.join(
    installPath,
    "steamapps",
    "workshop",
    "content",
    PZ_APP_ID,
    String(workshopId),
  );
}

// Where steamcmd stages an item's bytes while it downloads. Steam moves the
// finished tree into workshopContentDir() only at the very end, so this is the
// only place on disk that grows during a download -- which is what the live
// progress poller measures (steamcmd itself prints no percentage in pipe mode).
export function workshopDownloadStagingDir(installPath, workshopId) {
  return path.join(
    installPath,
    "steamapps",
    "workshop",
    "downloads",
    PZ_APP_ID,
    String(workshopId),
  );
}

// Recursive byte count, bounded so a pathological tree cannot stall the poller.
function dirSizeBytes(root) {
  let total = 0;
  let seen = 0;
  const stack = [root];
  while (stack.length && seen < 20000) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (seen >= 20000) break;
      seen++;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          // Vanished mid-walk -- ignore.
        }
      }
    }
  }
  return total;
}

// Expected download size in bytes, from Steam's public
// ISteamRemoteStorage/GetPublishedFileDetails (no API key required). Used as
// the denominator for the progress bar because steamcmd itself does not report
// byte counts for Workshop items until it finishes. Cached for a day; returns
// 0 when Steam cannot be reached so callers fall back to an indeterminate bar.
const workshopSizeCache = new Map(); // workshopId -> { size, at }
const WORKSHOP_SIZE_TTL_MS = 24 * 60 * 60 * 1000;

export async function getWorkshopItemSize(workshopId, { timeoutMs = 8000 } = {}) {
  const key = String(workshopId);
  const cached = workshopSizeCache.get(key);
  if (cached && Date.now() - cached.at < WORKSHOP_SIZE_TTL_MS) return cached.size;
  try {
    const params = new URLSearchParams();
    params.set("itemcount", "1");
    params.set("publishedfileids[0]", key);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(
      "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
      { method: "POST", body: params, signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return 0;
    const data = await res.json();
    const item = data?.response?.publishedfiledetails?.[0];
    const size = Number(item?.file_size) || 0;
    workshopSizeCache.set(key, { size, at: Date.now() });
    return size;
  } catch {
    return 0;
  }
}

function candidateSteamCmdPaths() {
  const candidates = [];
  if (process.env.STEAMCMD_PATH) candidates.push(process.env.STEAMCMD_PATH);
  candidates.push(
    "/home/steam/steamcmd/steamcmd.sh",
    "/home/steam/steamcmd/steamcmd",
    "/usr/games/steamcmd",
    "/usr/bin/steamcmd",
    "/usr/local/bin/steamcmd",
    path.join(os.homedir(), "steamcmd", "steamcmd.sh"),
    path.join(os.homedir(), "steamcmd", "steamcmd"),
  );
  return candidates;
}

function resolveSteamCmd() {
  for (const candidate of candidateSteamCmdPaths()) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // Unreadable candidate -- try the next one.
    }
  }
  return null;
}

function dirHasEntries(dir) {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

// A folder is a "mod folder" when it carries a mod.info at its root or in one
// of its direct subfolders. Build 42 nests the real mod.info under common/ or
// a version folder such as 42/, so a fixed allowlist of subfolder names would
// miss mods; any direct subfolder counts.
function looksLikeModFolder(dir) {
  try {
    if (fs.existsSync(path.join(dir, "mod.info"))) return true;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        fs.existsSync(path.join(dir, entry.name, "mod.info"))
      ) {
        return true;
      }
    }
  } catch {
    // Unreadable -- treat as not a mod folder.
  }
  return false;
}

// True when a steamcmd content folder holds loadable mod content: a mod.info
// (root or one folder deep, matching B42's layout) somewhere under the item
// root or its mods/ folder. `dirHasEntries` alone is not enough -- an aborted
// download leaves the folder non-empty (media files, no mod.info), which used
// to skip the re-download and leave the mod impossible to mirror or activate.
function dirHasUsableWorkshopContent(contentDir) {
  if (!dirHasEntries(contentDir)) return false;
  if (looksLikeModFolder(contentDir)) return true;
  const modsDir = path.join(contentDir, "mods");
  if (fs.existsSync(modsDir)) {
    if (looksLikeModFolder(modsDir)) return true;
    try {
      for (const entry of fs.readdirSync(modsDir, { withFileTypes: true })) {
        if (
          entry.isDirectory() &&
          looksLikeModFolder(path.join(modsDir, entry.name))
        ) {
          return true;
        }
      }
    } catch {
      // Unreadable -- treat as unusable so steamcmd gets a chance to repair.
    }
  }
  // Map-only / asset items legitimately ship no mod.info; do not re-download
  // those on every add.
  if (
    fs.existsSync(path.join(contentDir, "media", "maps")) ||
    fs.existsSync(path.join(modsDir, "media", "maps"))
  ) {
    return true;
  }
  return false;
}

// Parse every id= line from the mod.info files a mod folder ships (root and
// each direct subfolder).
function readModIdsFromFolder(dir) {
  const ids = new Set();
  const readInfo = (infoPath) => {
    let content;
    try {
      content = fs.readFileSync(infoPath, "utf8");
    } catch {
      return;
    }
    if (!content) return;
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      if (line.substring(0, idx).trim().toLowerCase() !== "id") continue;
      const value = line.substring(idx + 1).trim();
      if (value) ids.add(value);
    }
  };

  try {
    readInfo(path.join(dir, "mod.info"));
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        readInfo(path.join(dir, entry.name, "mod.info"));
      }
    }
  } catch {
    // Unreadable -- return whatever was collected.
  }
  return [...ids];
}

// Run steamcmd to fetch one Workshop item into the server install's own
// steamapps/workshop folder. Anonymous login is enough for public items (which
// is what PZ Workshop mods are); a private item would need Steam credentials
// the panel does not store.
export function runSteamCmdDownload({
  workshopId,
  installPath,
  timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  log = console,
}) {
  return new Promise((resolve) => {
    const steamcmd = resolveSteamCmd();
    if (!steamcmd) {
      const error =
        "steamcmd was not found on this host, so Workshop mods cannot be downloaded automatically.";
      updateDownloadProgress(workshopId, { active: false, phase: "error", error });
      resolve({ ok: false, error });
      return;
    }

    updateDownloadProgress(workshopId, {
      active: true,
      phase: "starting",
      percent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      error: null,
      startedAt: Date.now(),
    });

    // Percentage denominator + numerator. steamcmd does not print byte counts
    // for Workshop items (its "progress: N (a / b)" lines only cover app
    // updates), so the expected total comes from Steam's public details API and
    // the running count from the staging folder steamcmd fills on disk. If the
    // total is unknown the poller still reports bytes, and the UI shows an
    // indeterminate bar.
    let expectedBytes = 0;
    let sizeTimer = null;
    getWorkshopItemSize(workshopId).then((size) => {
      if (size > 0) {
        expectedBytes = size;
        updateDownloadProgress(workshopId, { totalBytes: size });
      }
    });

    const stagingDir = workshopDownloadStagingDir(installPath, workshopId);
    const finalContentDir = workshopContentDir(installPath, workshopId);
    sizeTimer = setInterval(() => {
      if (settled) return;
      const downloaded = Math.max(
        dirSizeBytes(stagingDir),
        dirSizeBytes(finalContentDir),
      );
      if (downloaded <= 0) return;
      const total =
        expectedBytes ||
        Number(downloadProgress.get(String(workshopId))?.totalBytes) ||
        0;
      updateDownloadProgress(workshopId, {
        active: true,
        phase: "downloading",
        downloadedBytes: downloaded,
        totalBytes: total,
        percent:
          total > 0
            ? Math.max(0, Math.min(99, Math.round((downloaded / total) * 100)))
            : 0,
        error: null,
      });
    }, 500);

    const args = [
      "+force_install_dir",
      installPath,
      "+login",
      "anonymous",
      "+workshop_download_item",
      PZ_APP_ID,
      String(workshopId),
      "+quit",
    ];

    let output = "";
    let settled = false;
    let child;
    try {
      child = spawn(steamcmd, args, {
        cwd: path.dirname(steamcmd),
        env: { ...process.env, HOME: os.homedir() },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      if (sizeTimer) clearInterval(sizeTimer);
      updateDownloadProgress(workshopId, {
        active: false,
        phase: "error",
        error: `Could not start steamcmd: ${error.message}`,
      });
      resolve({
        ok: false,
        error: `Could not start steamcmd: ${error.message}`,
      });
      return;
    }

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (sizeTimer) clearInterval(sizeTimer);
      if (result && result.ok) {
        updateDownloadProgress(workshopId, {
          active: false,
          phase: "downloaded",
          percent: 100,
          error: null,
        });
      } else {
        updateDownloadProgress(workshopId, {
          active: false,
          phase: "error",
          error: (result && result.error) || "Workshop download failed",
        });
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      finish({
        ok: false,
        error: `The Workshop download timed out after ${Math.round(
          timeoutMs / 1000,
        )}s.`,
      });
    }, timeoutMs);

    const onData = (chunk) => {
      const text = chunk.toString();
      output += text;
      if (output.length > 20000) output = output.slice(-20000);
      // SteamCMD prints carriage-return progress lines such as:
      //   Update state (0x61) downloading, progress: 45.67 (1234567 / 2706026)
      const progressRe = /progress:\s*([\d.]+)\s*\((\d+)\s*\/\s*(\d+)\)/g;
      let match;
      let last = null;
      while ((match = progressRe.exec(text)) !== null) last = match;
      if (last) {
        const percent = Math.max(0, Math.min(100, Number(last[1])));
        updateDownloadProgress(workshopId, {
          active: true,
          phase: "downloading",
          percent: Number.isFinite(percent) ? percent : 0,
          downloadedBytes: Number(last[2]) || 0,
          totalBytes: Number(last[3]) || 0,
          error: null,
        });
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (error) => {
      finish({ ok: false, error: `steamcmd failed: ${error.message}` });
    });
    child.on("close", () => {
      const contentDir = workshopContentDir(installPath, workshopId);
      if (!dirHasEntries(contentDir)) {
        const reason =
          output
            .split(/\r?\n/)
            .filter((line) => /error|fail|denied|denied/i.test(line))
            .slice(-3)
            .join(" ")
            .trim() ||
          "steamcmd did not report a downloaded item. It may be private, removed, or Steam may be unreachable.";
        log?.warn?.(
          `Workshop download for ${workshopId} produced no files: ${reason}`,
        );
        finish({ ok: false, error: reason });
        return;
      }
      finish({ ok: true, output });
    });
  });
}

// Build 42 only recognises a mod that carries a `common/` folder or a
// version folder (e.g. `42/`): a mod that ships only a legacy root `media/`
// folder is silently skipped by the game ("required mod ... not found"), so
// its content never loads. Many still-maintained Workshop items are packaged
// the old (Build 41) way. Give those a Build 42 layout by mirroring the
// content into `common/media` and the manifest into `common/mod.info`, while
// leaving the original root `media/` untouched so nothing else breaks.
function isVersionFolderName(name) {
  return /^\d+(\.\d+)*$/.test(name);
}

function ensureBuild42Layout(modDir) {
  try {
    const mediaDir = path.join(modDir, "media");
    if (!fs.existsSync(mediaDir)) return false;
    if (fs.existsSync(path.join(modDir, "common"))) return false;
    const hasVersionFolder = fs
      .readdirSync(modDir, { withFileTypes: true })
      .some((entry) => entry.isDirectory() && isVersionFolderName(entry.name));
    if (hasVersionFolder) return false;

    const commonDir = path.join(modDir, "common");
    fs.mkdirSync(commonDir, { recursive: true });
    fs.cpSync(mediaDir, path.join(commonDir, "media"), {
      recursive: true,
      force: true,
    });
    const infoPath = path.join(modDir, "mod.info");
    if (fs.existsSync(infoPath)) {
      fs.copyFileSync(infoPath, path.join(commonDir, "mod.info"));
    }
    return true;
  } catch {
    // Best effort: an unexpected filesystem error must not fail the install.
    return false;
  }
}

async function copyModFoldersIntoMods(srcBase, destRoot) {
  const copied = [];
  const modIds = [];

  const copyOne = async (from, name) => {
    const to = path.join(destRoot, name);
    await fsp.rm(to, { recursive: true, force: true });
    await fsp.cp(from, to, { recursive: true, force: true });
    ensureBuild42Layout(to);
    copied.push(name);
    modIds.push(...readModIdsFromFolder(to));
  };

  // Case 1: srcBase itself is a single mod folder (root-level mod.info).
  if (fs.existsSync(path.join(srcBase, "mod.info"))) {
    await copyOne(srcBase, path.basename(srcBase));
    return { copied, modIds: [...new Set(modIds)] };
  }

  // Case 2: srcBase holds one folder per mod.
  for (const entry of await fsp.readdir(srcBase, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const from = path.join(srcBase, entry.name);
    if (!looksLikeModFolder(from)) continue;
    await copyOne(from, entry.name);
  }

  return { copied, modIds: [...new Set(modIds)] };
}

// Ensure a Workshop item is present in <zomboidDataPath>/mods, downloading it
// first if needed. Returns the copied folder names and every mod id found in
// them so the caller can write them into Mods=.
export async function installWorkshopItemIntoZomboidMods({
  workshopId,
  installPath,
  zomboidDataPath,
  timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  log = console,
}) {
  if (!/^\d{1,15}$/.test(String(workshopId))) {
    return { ok: false, error: "Invalid Workshop ID", copied: [], modIds: [] };
  }

  updateDownloadProgress(workshopId, {
    active: true,
    phase: "checking",
    percent: 0,
    error: null,
    startedAt: Date.now(),
  });

  const fail = (error) => {
    updateDownloadProgress(workshopId, { active: false, phase: "error", error });
    return { ok: false, error, copied: [], modIds: [] };
  };

  const destRoot = zomboidModsDir(zomboidDataPath);
  if (!destRoot) {
    return fail("The server's data folder is not configured");
  }
  if (!installPath) {
    return fail("The server install folder is not configured");
  }

  const contentDir = workshopContentDir(installPath, workshopId);
  // Re-download when the folder is empty OR non-empty but not actually
  // loadable. A partial/aborted download leaves the folder with media files
  // but no mod.info; the old `dirHasEntries` check then skipped steamcmd and
  // the mod could neither be mirrored nor activated, even though its Workshop
  // ID landed in the INI.
  if (!dirHasUsableWorkshopContent(contentDir)) {
    updateDownloadProgress(workshopId, { phase: "downloading" });
    const download = await runSteamCmdDownload({
      workshopId,
      installPath,
      timeoutMs,
      log,
    });
    if (!download.ok) {
      return fail(download.error);
    }
  }

  // Prefer the item's mods/ subfolder; fall back to the item root for items
  // that ship a single root-level mod.
  let srcBase = path.join(contentDir, "mods");
  if (!fs.existsSync(srcBase)) srcBase = contentDir;

  updateDownloadProgress(workshopId, {
    active: true,
    phase: "installing",
    percent: 100,
  });
  await fsp.mkdir(destRoot, { recursive: true });
  const { copied, modIds } = await copyModFoldersIntoMods(srcBase, destRoot);

  if (copied.length === 0) {
    return fail(
      "The downloaded item has no mod folder to install (it may be a map or asset-only item).",
    );
  }

  log?.info?.(
    `Installed Workshop mod ${workshopId} into ${destRoot} (${copied.join(
      ", ",
    )})`,
  );
  updateDownloadProgress(workshopId, {
    active: false,
    phase: "done",
    percent: 100,
    error: null,
  });
  return { ok: true, contentDir, copied, modIds };
}
