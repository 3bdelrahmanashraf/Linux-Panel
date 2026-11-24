import { describe, expect, it } from "vitest";
import {
  finishModsExportProgress,
  getModsExportProgress,
  modsExportProgressKey,
  startModsExportProgress,
  updateModsExportProgress,
} from "../utils/modsExportProgress.js";

describe("modsExportProgress", () => {
  it("derives a stable key from the server name or mods directory", () => {
    expect(modsExportProgressKey({ serverName: "Youtoob" })).toBe("Youtoob");
    expect(modsExportProgressKey({ modsDir: "/data/mods" })).toBe(
      "/data/mods",
    );
    expect(modsExportProgressKey({})).toBe("default");
  });

  it("clamps percentages and byte counters into a sane range", () => {
    const key = "progress-clamp";
    startModsExportProgress(key, {
      phase: "zipping",
      percent: 140,
      processedBytes: -1,
      totalBytes: 100,
    });
    let current = getModsExportProgress(key);
    expect(current.percent).toBe(100);
    expect(current.processedBytes).toBe(0);
    expect(current.active).toBe(true);

    updateModsExportProgress(key, { percent: -20, processedBytes: 40 });
    current = getModsExportProgress(key);
    expect(current.percent).toBe(0);
    expect(current.processedBytes).toBe(40);

    finishModsExportProgress(key, { phase: "error", error: "boom" });
    current = getModsExportProgress(key);
    expect(current.active).toBe(false);
    expect(current.phase).toBe("error");
    expect(current.error).toBe("boom");
  });

  it("returns an idle snapshot for an unknown server", () => {
    const current = getModsExportProgress("never-started");
    expect(current.active).toBe(false);
    expect(current.phase).toBe("idle");
    expect(current.percent).toBe(0);
  });
});
