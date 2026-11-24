import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  applyOptionalModsToIniContent,
  clearInstalledModsCache,
  getModsFromIniContent,
  normalizeOptionalModIds,
  scanInstalledMods,
} from "../services/optionalMods.js";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pz-optional-mods-"));
  tempDirs.push(dir);
  return dir;
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

afterEach(() => {
  clearInstalledModsCache();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("normalizeOptionalModIds", () => {
  it("sanitises INI delimiters, trims, and de-duplicates", () => {
    expect(
      normalizeOptionalModIds([
        " Viewpoint ",
        "Viewpoint",
        "Bad;Id",
        "Bad=Id",
        "",
        null,
        42,
      ]),
    ).toEqual({
      ids: ["Viewpoint", "BadId"],
      rejected: ["", "null", "42"],
    });
  });

  it("returns an empty list for non-array input", () => {
    expect(normalizeOptionalModIds(undefined)).toEqual({
      ids: [],
      rejected: [],
    });
  });
});

describe("applyOptionalModsToIniContent", () => {
  const ini = [
    "PublicName=Youtoob",
    "Mods=Alpha;Viewpoint;Beta;ZombieBuddy",
    "WorkshopItems=123456",
    "",
  ].join("\n");

  it("removes only the optional IDs and leaves every other line alone", () => {
    const result = applyOptionalModsToIniContent(ini, [
      "Viewpoint",
      "ZombieBuddy",
    ]);
    expect(result.changed).toBe(true);
    expect(result.removed).toEqual(["Viewpoint", "ZombieBuddy"]);
    expect(result.required).toEqual(["Alpha", "Beta"]);
    expect(result.content).toBe(
      [
        "PublicName=Youtoob",
        "Mods=Alpha;Beta",
        "WorkshopItems=123456",
        "",
      ].join("\n"),
    );
  });

  it("does not rewrite when no optional ID is present", () => {
    const result = applyOptionalModsToIniContent(ini, ["NotThere"]);
    expect(result.changed).toBe(false);
    expect(result.removed).toEqual([]);
    expect(result.required).toEqual(["Alpha", "Viewpoint", "Beta", "ZombieBuddy"]);
    expect(result.content).toBe(ini);
  });

  it("tolerates whitespace around the Mods key", () => {
    const spaced = "Mods = Alpha ; Viewpoint\n";
    const result = applyOptionalModsToIniContent(spaced, ["Viewpoint"]);
    expect(result.changed).toBe(true);
    expect(result.content).toBe("Mods=Alpha\n");
  });

  it("reports a missing Mods= line instead of inventing one", () => {
    const result = applyOptionalModsToIniContent("PublicName=Youtoob\n", [
      "Viewpoint",
    ]);
    expect(result.missingModsLine).toBe(true);
    expect(result.changed).toBe(false);
  });
});

describe("getModsFromIniContent", () => {
  it("reads the current Mods list", () => {
    expect(getModsFromIniContent("Mods=Alpha; Beta\n")).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(getModsFromIniContent("PublicName=x\n")).toEqual([]);
  });
});

describe("scanInstalledMods", () => {
  it("finds root, common/versioned, and nested mod.info ids", () => {
    const modsDir = makeTempDir();
    writeFile(
      path.join(modsDir, "Root Mod", "mod.info"),
      "id=RootMod\nname=Root Mod\n",
    );
    writeFile(
      path.join(modsDir, "Common Mod", "common", "mod.info"),
      "id=CommonMod\nname=Common Mod\n",
    );
    writeFile(
      path.join(modsDir, "Versioned", "42.13", "mod.info"),
      "id=Versioned\nname=Versioned\nversionMin=42.13\n",
    );
    writeFile(
      path.join(modsDir, "Legacy", "LEGACY", "42.12", "mod.info"),
      "id=Legacy\nname=Legacy\n",
    );
    fs.mkdirSync(path.join(modsDir, "Root Mod", "media", "lua", "server"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(modsDir, "Common Mod", "common", "media", "lua", "client"), {
      recursive: true,
    });

    const mods = scanInstalledMods(modsDir, { useCache: false });
    const byId = Object.fromEntries(mods.map((mod) => [mod.id, mod]));

    expect(Object.keys(byId).sort()).toEqual([
      "CommonMod",
      "Legacy",
      "RootMod",
      "Versioned",
    ]);
    expect(byId.RootMod.hasServerContent).toBe(true);
    expect(byId.RootMod.clientOnly).toBe(false);
    expect(byId.CommonMod.hasClientContent).toBe(true);
    expect(byId.CommonMod.clientOnly).toBe(true);
    expect(byId.Versioned.folder).toBe("Versioned");
  });

  it("merges duplicate ids and unions their content flags", () => {
    const modsDir = makeTempDir();
    writeFile(
      path.join(modsDir, "Dup", "mod.info"),
      "id=Dup\nname=Dup Root\n",
    );
    writeFile(
      path.join(modsDir, "Dup", "42.13", "mod.info"),
      "id=Dup\nname=Dup Version\n",
    );
    fs.mkdirSync(path.join(modsDir, "Dup", "42.13", "media", "lua", "server"), {
      recursive: true,
    });

    const mods = scanInstalledMods(modsDir, { useCache: false });
    expect(mods).toHaveLength(1);
    expect(mods[0].name).toBe("Dup Root");
    expect(mods[0].hasServerContent).toBe(true);
  });
});
