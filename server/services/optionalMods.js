import fs from "fs";
import path from "path";
import { getSetting, setSetting } from "../database/init.js";
import { sanitizeIniValue } from "../utils/sanitize.js";

// Mods a client can join WITHOUT having installed. Project Zomboid has no
// native "optional mod" flag: the client's ConnectToServerState.CheckMods()
// hard-disconnects the moment any ID in the server's advertised Mods= list is
// absent on disk. The only workable approach without patching the game is to
// keep optional IDs out of the server INI entirely. The server therefore does
// not load them, but clients that have them can still use them locally, and
// clients that do not can join normally.
//
// This list is only a suggested starting point for a brand-new profile. Once
// the operator saves the page, the per-server value below wins.
export const DEFAULT_OPTIONAL_MOD_IDS = [
  // Client-only / UI / animation mods from the operator's 355-mod list.
  "ZombieBuddy",
  "ConditionOnDash",
  "YouDriveISleep",
  "IconsInventory",
  "PZVoxelStudioViewpoint",
  "Viewpoint",
  "VVA_transparentWindows",
  "PZ_Map",
  "PZ_Pulse",
  "SurvivorBriefing",
  "TakeAnyAmount",
  "TacHold",
  "TacHold Pistol",
  "81deloreanDMC12BTTF",
  "82firebirdKITT",
  // Installed leftovers that used to be required by the old server config.
  "CausaMortis",
  "GeneralMod",
  "MapAllKnownFix",
  "FishWindowFix",
  "SafeUserLogin",
  "rvinteriormanager",
];

// Per-server object: { "<server id>": ["ModId", ...] }. Kept as one setting
// so switching the active server never leaks one server's exclusions into
// another's INI.
export const OPTIONAL_MODS_SETTING_KEY = "optionalModsByServer";

const MAX_OPTIONAL_MODS = 1000;
const MAX_MOD_ID_LENGTH = 200;
const SCAN_CACHE_TTL_MS = 60_000;

// Directories that hold a mod's payload rather than another mod.info. Pruning
// them keeps the recursive scan to a few hundred directory reads instead of
// walking the ~8 GB / 159k-file mods tree.
const CONTENT_DIR_NAMES = new Set([
  "media",
  "textures",
  "models",
  "anims",
  "animation",
  "sound",
  "ui",
  "lua",
  "scripts",
  "java",
  "clothing",
  "vehicles",
  "vehicle",
  "shaders",
  "maps",
  "actiongroups",
  "zombie",
  "animals",
]);

/**
 * Sanitise the operator-supplied optional IDs. Mod IDs are the letter-based
 * `id=` values from mod.info (spaces and apostrophes are legal), so this only
 * strips the INI delimiters and control characters.
 */
export function normalizeOptionalModIds(values) {
  const ids = [];
  const seen = new Set();
  const rejected = [];
  const input = Array.isArray(values) ? values : [];
  for (const raw of input) {
    if (typeof raw !== "string") {
      rejected.push(String(raw));
      continue;
    }
    const id = sanitizeIniValue(raw).trim();
    if (!id || id.length >= MAX_MOD_ID_LENGTH) {
      rejected.push(raw);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_OPTIONAL_MODS) break;
  }
  return { ids, rejected };
}

export async function readOptionalModIds(serverId) {
  const stored = await getSetting(OPTIONAL_MODS_SETTING_KEY);
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    const value = stored[String(serverId)];
    if (Array.isArray(value)) return normalizeOptionalModIds(value).ids;
  }
  // Legacy/global array (pre per-server storage) is honoured once, then the
  // next save migrates it to the object shape below.
  if (Array.isArray(stored)) return normalizeOptionalModIds(stored).ids;
  return [...DEFAULT_OPTIONAL_MOD_IDS];
}

export async function saveOptionalModIds(serverId, values) {
  const { ids, rejected } = normalizeOptionalModIds(values);
  const stored = await getSetting(OPTIONAL_MODS_SETTING_KEY);
  const byServer =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? { ...stored }
      : {};
  byServer[String(serverId)] = ids;
  await setSetting(OPTIONAL_MODS_SETTING_KEY, byServer);
  return { ids, rejected };
}

export function getModsFromIniContent(content) {
  const match = String(content || "").match(/^[ \t]*Mods[ \t]*=[ \t]*(.*)$/m);
  if (!match) return [];
  return match[1]
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Remove the optional IDs from a Mods= line. Pure so the route's INI lock
 * section stays tiny and this can be unit-tested without Express or disk.
 */
export function applyOptionalModsToIniContent(content, optionalValues) {
  const optional = new Set(normalizeOptionalModIds(optionalValues).ids);
  const text = String(content || "");
  const match = text.match(/^[ \t]*Mods[ \t]*=[ \t]*(.*)$/m);
  if (!match) {
    return {
      content: text,
      changed: false,
      removed: [],
      required: [],
      missingModsLine: true,
    };
  }

  const current = match[1]
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);
  const removed = current.filter((id) => optional.has(id));
  const required = current.filter((id) => !optional.has(id));
  if (removed.length === 0) {
    return { content: text, changed: false, removed: [], required };
  }

  const line = `Mods=${required
    .map((id) => sanitizeIniValue(id))
    .filter(Boolean)
    .join(";")}`;
  // Function replacement: a mod ID containing "$" must not be interpreted as
  // a replacement pattern by String.replace().
  const nextContent = text.replace(
    /^[ \t]*Mods[ \t]*=.*$/m,
    () => line,
  );
  return { content: nextContent, changed: true, removed, required };
}

function readModInfoFile(modInfoPath) {
  let content;
  try {
    content = fs.readFileSync(modInfoPath, "utf-8").replace(/\r\n/g, "\n");
  } catch {
    return { ids: [], meta: {}, requires: [] };
  }
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);

  const ids = [];
  const meta = {};
  const requires = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.substring(0, idx).trim().toLowerCase();
    const value = line.substring(idx + 1).trim();
    if (!key) continue;
    if (key === "id") {
      if (value) ids.push(value);
    } else if (key === "require") {
      for (const part of value.split(/[,;]/)) {
        const dependency = part.trim().replace(/^\\+/, "");
        if (dependency) requires.push(dependency);
      }
    } else if (!(key in meta)) {
      // First occurrence wins for display fields (name/poster/...).
      meta[key] = value;
    }
  }
  return { ids, meta, requires };
}

function collectModInfoPaths(modDir) {
  const found = [];
  const stack = [{ dir: modDir, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "mod.info")) {
      found.push(path.join(dir, "mod.info"));
    }
    if (depth >= 3) continue;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name.toLowerCase();
      if (CONTENT_DIR_NAMES.has(name) || name.startsWith(".")) continue;
      stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return found;
}

function hasAny(root, relativePaths) {
  return relativePaths.some((relativePath) => fs.existsSync(path.join(root, relativePath)));
}

function contentFlagsForRoot(root) {
  const server = hasAny(root, [
    "media/lua/server",
    "media/java/server",
    "media/scripts",
    "media/maps",
    "media/vehicle",
    "media/vehicles",
    "media/clothing",
    "media/actiongroups",
  ]);
  const client = hasAny(root, [
    "media/lua/client",
    "media/java/client",
    "media/lua/shared",
    "media/shared",
    "media/ui",
    "media/textures",
    "media/models",
    "media/anims",
    "media/animation",
    "media/sound",
    "media/shaders",
    "media/clothing",
    "media/actiongroups",
  ]);
  const shared = hasAny(root, ["media/lua/shared", "media/shared"]);
  return {
    hasServerContent: server,
    hasClientContent: client,
    hasSharedContent: shared,
    clientOnly: client && !server,
    noContent: !client && !server,
  };
}

const scanCache = new Map(); // modsDir -> { mtimeMs, at, value }

/**
 * Installed mods under <zomboid data>/mods, keyed by mod.info id (not folder).
 * The on-disk folder name is only a display hint; PZ loads by id.
 */
export function scanInstalledMods(modsDir, { useCache = true } = {}) {
  if (!modsDir) return [];
  let stat;
  try {
    stat = fs.statSync(modsDir);
  } catch {
    return [];
  }
  const cached = scanCache.get(modsDir);
  if (
    useCache &&
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    Date.now() - cached.at < SCAN_CACHE_TTL_MS
  ) {
    return cached.value;
  }

  let topLevel;
  try {
    topLevel = fs.readdirSync(modsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const byId = new Map();
  for (const entry of topLevel) {
    if (!entry.isDirectory()) continue;
    const modDir = path.join(modsDir, entry.name);
    const modInfoPaths = collectModInfoPaths(modDir);
    if (modInfoPaths.length === 0) continue;

    // Root first, then numeric version folders newest-first. Duplicate ids are
    // merged below, but this gives the display name a stable preference.
    modInfoPaths.sort((left, right) => {
      const leftRel = path.relative(modDir, path.dirname(left));
      const rightRel = path.relative(modDir, path.dirname(right));
      const leftDepth = leftRel === "" ? 0 : leftRel.split(path.sep).length;
      const rightDepth = rightRel === "" ? 0 : rightRel.split(path.sep).length;
      if (leftDepth !== rightDepth) return leftDepth - rightDepth;
      return rightRel.localeCompare(leftRel, undefined, { numeric: true });
    });

    for (const modInfoPath of modInfoPaths) {
      const { ids, meta, requires } = readModInfoFile(modInfoPath);
      if (ids.length === 0) continue;
      const contentRoot = path.dirname(modInfoPath);
      const flags = contentFlagsForRoot(contentRoot);
      for (const id of ids) {
        const existing = byId.get(id);
        if (existing) {
          existing.requires = [...new Set([...existing.requires, ...requires])];
          existing.hasServerContent ||= flags.hasServerContent;
          existing.hasClientContent ||= flags.hasClientContent;
          existing.hasSharedContent ||= flags.hasSharedContent;
          existing.clientOnly = existing.hasClientContent && !existing.hasServerContent;
          existing.noContent = !existing.hasClientContent && !existing.hasServerContent;
          continue;
        }
        byId.set(id, {
          id,
          name: meta.name || id,
          folder: entry.name,
          modInfoPath: path.relative(modsDir, modInfoPath),
          versionMin: meta.versionmin || null,
          versionMax: meta.versionmax || null,
          requires,
          ...flags,
        });
      }
    }
  }

  const value = [...byId.values()].sort((left, right) => {
    const byName = left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return byName || left.id.localeCompare(right.id);
  });
  scanCache.set(modsDir, { mtimeMs: stat.mtimeMs, at: Date.now(), value });
  return value;
}

export function clearInstalledModsCache() {
  scanCache.clear();
}
