import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { zipDirectoryToFile } from "../utils/vikingfile.js";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pz-viking-zip-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("zipDirectoryToFile", () => {
  it("reports archive progress and finishes at 100 percent", async () => {
    const root = makeTempDir();
    const modsDir = path.join(root, "mods");
    fs.mkdirSync(path.join(modsDir, "TestMod"), { recursive: true });
    fs.writeFileSync(path.join(modsDir, "TestMod", "mod.info"), "name=Test\n");
    fs.writeFileSync(
      path.join(modsDir, "TestMod", "payload.bin"),
      Buffer.alloc(256 * 1024, 7),
    );
    const outPath = path.join(root, "export.zip");
    const updates = [];

    const bytes = await zipDirectoryToFile(modsDir, outPath, {
      manifest: "server=Test\n",
      onProgress: (update) => updates.push(update),
    });

    expect(bytes).toBeGreaterThan(0);
    expect(fs.statSync(outPath).size).toBe(bytes);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.at(-1)).toMatchObject({
      phase: "zipping",
      percent: 100,
    });
    // The manifest must actually be inside the archive.
    expect(fs.readFileSync(outPath).includes(Buffer.from("EXPORT-INFO.txt"))).toBe(
      true,
    );
  });
});
