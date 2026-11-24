import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getSetting, setSetting } from "../database/init.js";

// Shared helpers for the "export mods" feature, used by:
//   - routes/mods.js        GET /export-preview (folder sizes) and
//                           GET /export-download (the ZIP stream).
//   - services/discordBot.js the /mods command, which posts a summary of the
//                           same folder (count, total size, mod names) and a
//                           download button for it.
//   - services/auth.js      the share-token bypass the download button's link
//                           relies on, so a plain Discord click (no panel
//                           login, no Authorization header) can fetch the ZIP.
// Kept in one place so the numbers the Discord embed quotes and the numbers
// the panel previews can never drift apart.

// Bound the walk so a pathological tree cannot hang a request. Shared by the
// ZIP preview and the Discord summary.
const MAX_ENTRIES = 200000;

const SHARE_TOKEN_SETTING = "modsExportShareToken";

export function measureModFolder(root) {
  let files = 0;
  let bytes = 0;
  const stack = [root];
  let entriesSeen = 0;
  while (stack.length && entriesSeen < MAX_ENTRIES) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entriesSeen >= MAX_ENTRIES) break;
      entriesSeen++;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        files++;
        try {
          bytes += fs.statSync(full).size;
        } catch {
          // Deleted mid-walk -- skip it.
        }
      }
    }
  }
  return { files, bytes };
}

// Every top-level folder inside <data>/mods, with its file count and byte
// total, sorted by name so the preview and the Discord summary list the same
// order.
export function measureModsDir(modsDir) {
  const folders = [];
  let totalFiles = 0;
  let totalBytes = 0;
  let entries;
  try {
    entries = fs.readdirSync(modsDir, { withFileTypes: true });
  } catch {
    return { count: 0, totalFiles: 0, totalBytes: 0, folders };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const { files, bytes } = measureModFolder(path.join(modsDir, entry.name));
    totalFiles += files;
    totalBytes += bytes;
    folders.push({ name: entry.name, files, bytes });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  return { count: folders.length, totalFiles, totalBytes, folders };
}

// Human-readable size for Discord messages / UI ("1.24 GB", "18.4 MB").
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(n) / Math.log(1024)),
  );
  const value = n / 1024 ** i;
  const rounded =
    i === 0
      ? String(Math.round(value))
      : value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2);
  return `${rounded} ${units[i]}`;
}

// The token baked into the /mods download link. Generated on first use and
// persisted so the link in an old Discord message keeps working across
// restarts. Regenerating it (deleting the setting) revokes every link that
// was handed out.
export async function getModsExportShareToken() {
  const stored = await getSetting(SHARE_TOKEN_SETTING);
  if (typeof stored === "string" && /^[A-Za-z0-9_-]{16,}$/.test(stored)) {
    return stored;
  }
  const token = crypto.randomBytes(24).toString("base64url");
  await setSetting(SHARE_TOKEN_SETTING, token);
  return token;
}

// Constant-time compare so a caller can't learn the token byte by byte from
// response timing. Hashed first so the two buffers are always the same
// length (timingSafeEqual throws on a length mismatch).
export async function matchesModsExportShareToken(candidate) {
  if (typeof candidate !== "string" || candidate.length < 8) return false;
  const expected = await getSetting(SHARE_TOKEN_SETTING);
  if (typeof expected !== "string" || expected.length === 0) return false;
  const a = crypto.createHash("sha256").update(candidate).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
