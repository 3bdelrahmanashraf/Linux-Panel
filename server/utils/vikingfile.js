import crypto from "crypto";
import fs from "fs";
import http from "http";
import https from "https";
import os from "os";
import path from "path";
import archiver from "archiver";
import { createLogger } from "./logger.js";
import { getSetting, setSetting } from "../database/init.js";
import { measureModsDir } from "./modsExport.js";

// VikingFile (https://vikingfile.com) host for the mods export ZIP, so the
// /mods download button points at a public file host instead of the panel's
// own address (which is only reachable from the operator's LAN / machine).
//
// VikingFile's "legacy" upload API is the one implemented here:
//   GET  https://vikingfile.com/api/get-server  -> { server: "<upload url>" }
//   POST <upload url>  multipart/form-data: file, user (hash, empty = anon),
//        optional path -> { name, size, hash, url }
// The returned `url` is the public download link (https://vikingfile.com/f/…).

const log = createLogger("VikingFile");

const GET_SERVER_URL = "https://vikingfile.com/api/get-server";
const UPLOAD_TIMEOUT_MS = 3 * 60 * 60 * 1000;

// Optional VikingFile account hash. Empty (or unset) uploads anonymously,
// which is what the site does for logged-out uploads.
export const VIKINGFILE_USER_HASH_SETTING = "vikingfileUserHash";
// Cache so a repeat /mods click reuses the previous upload instead of pushing
// the whole (multi-hundred-MB) ZIP again. Invalidated when the folder changes,
// when the cached link is old, or when VikingFile reports the file is gone
// (anonymous uploads are removed after a while). The liveness check matters:
// a stale cached URL used to be handed out forever, which is why the panel's
// "Upload to VikingFile" button could return a link that opened "File not
// found" instead of re-uploading.
export const VIKINGFILE_MODS_URL_SETTING = "vikingfileModsExportUrl";
export const VIKINGFILE_MODS_FINGERPRINT_SETTING =
  "vikingfileModsExportFingerprint";
export const VIKINGFILE_MODS_UPLOADED_AT_SETTING =
  "vikingfileModsExportUploadedAt";

// Anonymous VikingFile uploads do not have a documented lifetime. Keep the
// cache comfortably shorter than the longest observed retention; the HEAD
// probe below still catches a file that disappears sooner.
const MODS_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const LINK_CHECK_TIMEOUT_MS = 15 * 1000;

export async function getVikingfileUserHash() {
  const value = await getSetting(VIKINGFILE_USER_HASH_SETTING);
  return typeof value === "string" ? value.trim() : "";
}

async function resolveUploadServer() {
  const res = await fetch(GET_SERVER_URL, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`get-server returned HTTP ${res.status}`);
  }
  const data = await res.json();
  const server = typeof data?.server === "string" ? data.server.trim() : "";
  if (!/^https?:\/\//i.test(server)) {
    throw new Error("get-server returned no upload server");
  }
  return server;
}

function multipartField(boundary, name, value) {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`,
    "utf8",
  );
}

function safeMultipartFilename(filename) {
  return String(filename || "file.zip").replace(/[\r\n"]/g, "_");
}

function reportUploadProgress(onProgress, sentBytes, totalBytes) {
  if (typeof onProgress !== "function") return;
  const percent =
    totalBytes > 0
      ? Math.min(100, Math.max(0, (sentBytes / totalBytes) * 100))
      : 0;
  try {
    onProgress({ processedBytes: sentBytes, totalBytes, percent });
  } catch {
    // A UI progress callback must never abort a real upload.
  }
}

// Uploads a single local file to VikingFile and returns the public link.
//
// This deliberately uses node:http(s) with an explicit multipart body rather
// than FormData + fetch: it keeps the (potentially multi-GB) ZIP on disk while
// still reporting real bytes-sent progress to the caller. fetch() gives no
// upload-progress event, which is the reason the panel used to show only an
// indeterminate spinner for the whole transfer.
export async function uploadFileToVikingfile(
  filePath,
  { filename, remotePath, onProgress } = {},
) {
  const stat = await fs.promises.stat(filePath);
  const server = await resolveUploadServer();
  const userHash = await getVikingfileUserHash();
  const originalName = filename || path.basename(filePath);
  const boundary = `----ZomboidPanel${crypto.randomBytes(12).toString("hex")}`;

  const fields = [multipartField(boundary, "user", userHash)];
  if (remotePath) fields.push(multipartField(boundary, "path", remotePath));
  const fileHeader = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${safeMultipartFilename(originalName)}"\r\n` +
      "Content-Type: application/zip\r\n\r\n",
    "utf8",
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const preamble = Buffer.concat([...fields, fileHeader]);
  const contentLength = preamble.length + stat.size + footer.length;

  const uploadUrl = new URL(server);
  const transport = uploadUrl.protocol === "http:" ? http : https;

  return await new Promise((resolve, reject) => {
    let settled = false;
    let sentBytes = 0;
    let timer = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };

    const request = transport.request(
      uploadUrl,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": contentLength,
        },
      },
      (response) => {
        const chunks = [];
        let receivedBytes = 0;
        response.on("data", (chunk) => {
          chunks.push(chunk);
          receivedBytes += chunk.length;
          // A normal response is a tiny JSON object. Cap the buffer so a
          // captive portal / proxy HTML error page cannot exhaust memory.
          if (receivedBytes > 2 * 1024 * 1024) {
            response.destroy(new Error("upload returned an oversized response"));
          }
        });
        response.on("error", (error) => finish(error));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = response.statusCode || 0;
          if (status < 200 || status >= 300) {
            finish(
              new Error(`upload returned HTTP ${status}: ${text.slice(0, 200)}`),
            );
            return;
          }
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            finish(new Error(`upload returned non-JSON: ${text.slice(0, 200)}`));
            return;
          }
          const url = typeof json?.url === "string" ? json.url.trim() : "";
          if (!/^https?:\/\//i.test(url)) {
            finish(new Error("upload returned no url"));
            return;
          }
          reportUploadProgress(onProgress, contentLength, contentLength);
          finish(null, {
            url,
            hash: typeof json.hash === "string" ? json.hash : null,
            name: typeof json.name === "string" ? json.name : originalName,
            size: Number(json.size) || stat.size,
          });
        });
      },
    );

    timer = setTimeout(() => {
      request.destroy(new Error("VikingFile upload timed out"));
      finish(new Error("VikingFile upload timed out"));
    }, UPLOAD_TIMEOUT_MS);

    request.on("error", (error) => finish(error));

    request.write(preamble);
    sentBytes += preamble.length;
    reportUploadProgress(onProgress, sentBytes, contentLength);

    const stream = fs.createReadStream(filePath);
    stream.on("error", (error) => {
      stream.destroy();
      request.destroy();
      finish(error);
    });
    stream.on("data", (chunk) => {
      sentBytes += chunk.length;
      reportUploadProgress(onProgress, sentBytes, contentLength);
    });
    stream.on("end", () => {
      request.end(footer);
      sentBytes += footer.length;
      reportUploadProgress(onProgress, sentBytes, contentLength);
    });
    stream.pipe(request, { end: false });
  });
}

// HEAD is enough for VikingFile: a live /f/<hash> answers 200, a deleted or
// unknown one answers 404 ("File not found"). Network / proxy failures return
// null ("unknown") so an offline panel does not purge a link it cannot test.
export async function isVikingfileLinkAlive(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS),
    });
    if (response.status === 404 || response.status === 410) return false;
    return response.ok ? true : null;
  } catch {
    return null;
  }
}

// Zips a directory into a file on disk (archiver streams; the archive is never
// held in memory). Returns the archive size in bytes. `onProgress` receives
// archiver's filesystem byte counters so the export page can show a real ZIP
// progress bar instead of a spinner.
export function zipDirectoryToFile(dir, outPath, { manifest, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 6 } });

    output.on("close", () => {
      if (typeof onProgress === "function") {
        try {
          onProgress({
            phase: "zipping",
            processedBytes: archive.pointer(),
            totalBytes: archive.pointer(),
            percent: 100,
          });
        } catch {
          // Progress reporting is best-effort only.
        }
      }
      resolve(archive.pointer());
    });
    output.on("error", reject);
    archive.on("warning", (err) => log.warn(`zip warning: ${err.message}`));
    archive.on("error", reject);
    archive.on("progress", (progress) => {
      if (typeof onProgress !== "function") return;
      const processedBytes = Number(progress?.fs?.processedBytes) || 0;
      const totalBytes = Number(progress?.fs?.totalBytes) || 0;
      try {
        onProgress({
          phase: "zipping",
          processedBytes,
          totalBytes,
          percent:
            totalBytes > 0
              ? Math.min(99, Math.max(0, (processedBytes / totalBytes) * 100))
              : 0,
        });
      } catch {
        // Progress reporting is best-effort only.
      }
    });

    archive.pipe(output);
    if (manifest) {
      archive.append(manifest, { name: "EXPORT-INFO.txt" });
    }
    archive.directory(dir, false);
    archive.finalize();
  });
}

// Stable-ish fingerprint of the mods folder, used to tell whether a cached
// upload still matches what is on disk.
export function modsFolderFingerprint(summary) {
  if (!summary) return "";
  return `${summary.count}:${summary.totalFiles}:${summary.totalBytes}`;
}

export function buildModsExportManifest({ serverName, summary } = {}) {
  const lines = [
    "Zomboid Panel mods export",
    `Generated: ${new Date().toISOString()}`,
  ];
  if (serverName) lines.push(`Server: ${serverName}`);
  if (summary) {
    lines.push(`Mods: ${summary.count}`);
    lines.push(`Files: ${summary.totalFiles}`);
    lines.push(`Size: ${summary.totalBytes} bytes`);
  }
  lines.push("");
  lines.push("Unzip the contents into your Zomboid 'mods' folder.");
  return lines.join("\n");
}

function modsExportFilename(serverName) {
  const safeName = String(serverName || "server").replace(/[^A-Za-z0-9._-]+/g, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `mods-${safeName}-${stamp}.zip`;
}

// Zip the mods folder, upload it, and return the public link. Reuses the last
// upload when the folder hasn't changed. Throws if the upload fails, so
// callers can decide on a fallback.
export async function ensureModsExportUpload({
  modsDir,
  serverName,
  summary,
  force = false,
  onProgress,
} = {}) {
  const resolvedSummary = summary || measureModsDir(modsDir);
  const fingerprint = modsFolderFingerprint(resolvedSummary);
  const report = (patch) => {
    if (typeof onProgress !== "function") return;
    try {
      onProgress(patch);
    } catch {
      // Progress reporting must never fail the export.
    }
  };

  if (!force && fingerprint) {
    const [cachedUrl, cachedFingerprint, cachedUploadedAt] = await Promise.all([
      getSetting(VIKINGFILE_MODS_URL_SETTING),
      getSetting(VIKINGFILE_MODS_FINGERPRINT_SETTING),
      getSetting(VIKINGFILE_MODS_UPLOADED_AT_SETTING),
    ]);
    const uploadedAt = Number(cachedUploadedAt);
    const cacheFresh =
      !Number.isFinite(uploadedAt) ||
      Date.now() - uploadedAt < MODS_CACHE_MAX_AGE_MS;
    if (
      typeof cachedUrl === "string" &&
      /^https?:\/\//i.test(cachedUrl) &&
      cachedFingerprint === fingerprint &&
      cacheFresh
    ) {
      const alive = await isVikingfileLinkAlive(cachedUrl);
      if (alive !== false) {
        report({
          phase: "done",
          percent: 100,
          cached: true,
          url: cachedUrl,
          processedBytes: resolvedSummary.totalBytes,
          totalBytes: resolvedSummary.totalBytes,
        });
        return {
          url: cachedUrl,
          cached: true,
          summary: resolvedSummary,
        };
      }
      log.warn(
        `Cached VikingFile export is no longer available (${cachedUrl}); re-uploading`,
      );
    }
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `pz-mods-export-${process.pid}-${Date.now()}.zip`,
  );
  try {
    report({
      phase: "zipping",
      percent: 0,
      processedBytes: 0,
      totalBytes: resolvedSummary.totalBytes,
      cached: false,
      error: null,
    });
    await zipDirectoryToFile(modsDir, tmpFile, {
      manifest: buildModsExportManifest({ serverName, summary: resolvedSummary }),
      onProgress: (patch) => {
        // archiver's `fs.totalBytes` is the size of the entries it has already
        // queued, not the whole directory, so its own ratio sits at ~99% for
        // almost the entire archive. Use the preview's measured total instead;
        // that is the number the page also shows next to the bar.
        const totalBytes = resolvedSummary.totalBytes;
        const processedBytes = Number(patch.processedBytes) || 0;
        report({
          ...patch,
          totalBytes,
          percent:
            totalBytes > 0
              ? Math.min(99, Math.max(0, (processedBytes / totalBytes) * 100))
              : 0,
          cached: false,
          error: null,
        });
      },
    });
    report({
      phase: "uploading",
      percent: 0,
      processedBytes: 0,
      totalBytes: null,
      cached: false,
      error: null,
    });
    const uploaded = await uploadFileToVikingfile(tmpFile, {
      filename: modsExportFilename(serverName),
      onProgress: (patch) =>
        report({
          phase: "uploading",
          ...patch,
          cached: false,
          error: null,
        }),
    });
    report({
      phase: "verifying",
      percent: 100,
      processedBytes: null,
      totalBytes: null,
      cached: false,
      error: null,
    });
    const alive = await isVikingfileLinkAlive(uploaded.url);
    if (alive === false) {
      throw new Error(
        "VikingFile accepted the upload but its public link already reports the file as missing",
      );
    }
    await Promise.all([
      setSetting(VIKINGFILE_MODS_URL_SETTING, uploaded.url),
      setSetting(VIKINGFILE_MODS_FINGERPRINT_SETTING, fingerprint),
      setSetting(VIKINGFILE_MODS_UPLOADED_AT_SETTING, String(Date.now())),
    ]);
    report({
      phase: "done",
      percent: 100,
      cached: false,
      url: uploaded.url,
      error: null,
    });
    return {
      url: uploaded.url,
      hash: uploaded.hash,
      size: uploaded.size,
      cached: false,
      summary: resolvedSummary,
    };
  } finally {
    await fs.promises.rm(tmpFile, { force: true }).catch(() => {});
  }
}
