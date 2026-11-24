// In-memory progress for the "Export mods" page.
//
// The ZIP + VikingFile upload happens inside a single POST /mods/export-upload
// request, which can run for many minutes for a multi-GB mods folder. The page
// polls GET /mods/export-progress while that request is in flight so it can
// show the phase (measuring / zipping / uploading / verifying) and real byte
// progress instead of a spinner. State is intentionally process-local: a panel
// restart aborts the upload and starting fresh is the only meaningful state
// after that.

const IDLE_PROGRESS = Object.freeze({
  active: false,
  phase: "idle",
  percent: 0,
  processedBytes: 0,
  totalBytes: 0,
  error: null,
  cached: null,
  url: null,
  serverName: null,
  startedAt: null,
  updatedAt: null,
});

const progressByKey = new Map();

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
}

function clampBytes(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function modsExportProgressKey({ serverName, modsDir } = {}) {
  return String(serverName || modsDir || "default");
}

export function startModsExportProgress(key, patch = {}) {
  const now = Date.now();
  const state = {
    ...IDLE_PROGRESS,
    ...patch,
    active: true,
    phase: patch.phase || "measuring",
    percent: clampPercent(patch.percent),
    processedBytes: clampBytes(patch.processedBytes) ?? 0,
    totalBytes: clampBytes(patch.totalBytes) ?? 0,
    error: null,
    cached: null,
    url: null,
    startedAt: now,
    updatedAt: now,
  };
  progressByKey.set(key, state);
  return state;
}

export function updateModsExportProgress(key, patch = {}) {
  const current = progressByKey.get(key) || IDLE_PROGRESS;
  const next = {
    ...current,
    ...patch,
    percent:
      patch.percent === undefined
        ? current.percent
        : clampPercent(patch.percent),
    processedBytes:
      patch.processedBytes === undefined
        ? current.processedBytes
        : clampBytes(patch.processedBytes),
    totalBytes:
      patch.totalBytes === undefined
        ? current.totalBytes
        : clampBytes(patch.totalBytes),
    updatedAt: Date.now(),
  };
  // An error/terminal phase is not "active" even if a caller forgot the flag.
  if (next.phase === "done" || next.phase === "error") next.active = false;
  progressByKey.set(key, next);
  return next;
}

export function finishModsExportProgress(key, patch = {}) {
  return updateModsExportProgress(key, {
    ...patch,
    active: false,
    phase: patch.phase || "done",
  });
}

export function getModsExportProgress(key) {
  return progressByKey.get(key) || IDLE_PROGRESS;
}
