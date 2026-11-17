import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ZipReader } from "../src/evidence/zip.js";
import { buildPack, writePack } from "./helpers/pack.js";
import { must, useTempDirs } from "./helpers/tmp.js";

const makeDir = useTempDirs();

const FILES = {
  "tests/t-1/test.md": "# Flow\n",
  "tests/t-1/steps/0002-abc/failure.yaml": "error: nope\n",
  "unicode.txt": "héllo wörld ✓",
};

describe("ZipReader", () => {
  it("lists every entry name without extracting anything", () => {
    const zip = ZipReader.fromBytes(buildPack(FILES));
    expect([...zip.names].sort()).toEqual(["tests/t-1/steps/0002-abc/failure.yaml", "tests/t-1/test.md", "unicode.txt"]);
  });

  it("reports whether an entry exists", () => {
    const zip = ZipReader.fromBytes(buildPack(FILES));
    expect(zip.has("tests/t-1/test.md")).toBe(true);
    expect(zip.has("tests/t-1/missing.md")).toBe(false);
  });

  it("matches entry names exactly, not by prefix", () => {
    expect(ZipReader.fromBytes(buildPack(FILES)).has("tests/t-1")).toBe(false);
  });

  it("reads an entry as UTF-8 text", () => {
    expect(ZipReader.fromBytes(buildPack(FILES)).readText("unicode.txt")).toBe("héllo wörld ✓");
  });

  it("returns undefined text for a missing entry", () => {
    expect(ZipReader.fromBytes(buildPack(FILES)).readText("nope.txt")).toBeUndefined();
  });

  it("reads only the entries it is asked for", () => {
    const bytes = ZipReader.fromBytes(buildPack(FILES)).readBytes(["tests/t-1/test.md"]);
    expect([...bytes.keys()]).toEqual(["tests/t-1/test.md"]);
  });

  it("returns binary entries unchanged", () => {
    const binary = Uint8Array.from([0, 255, 128, 7, 0, 1]);
    const zip = ZipReader.fromBytes(buildPack({ "img.png": binary }));
    expect(must(zip.readBytes(["img.png"]).get("img.png"))).toEqual(binary);
  });

  it("returns an empty map when no names are requested", () => {
    expect(ZipReader.fromBytes(buildPack(FILES)).readBytes([]).size).toBe(0);
  });

  it("leaves unknown names out of the result", () => {
    expect(ZipReader.fromBytes(buildPack(FILES)).readBytes(["unknown"]).size).toBe(0);
  });

  it("reads several entries in one call", () => {
    const bytes = ZipReader.fromBytes(buildPack(FILES)).readBytes(["unicode.txt", "tests/t-1/test.md"]);
    expect(bytes.size).toBe(2);
  });

  it("handles an archive with no entries", () => {
    expect(ZipReader.fromBytes(buildPack({})).names).toEqual([]);
  });

  it("rejects bytes that are not a zip archive", () => {
    expect(() => ZipReader.fromBytes(Uint8Array.from([1, 2, 3, 4, 5]))).toThrow();
  });

  it("opens a pack from disk", async () => {
    const path = await writePack(await makeDir(), FILES);
    expect((await ZipReader.open(path)).readText("tests/t-1/test.md")).toBe("# Flow\n");
  });

  it("rejects a pack that does not exist", async () => {
    await expect(ZipReader.open(join(await makeDir(), "gone.evidence"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a file on disk that is not a zip", async () => {
    const path = join(await makeDir(), "bogus.evidence");
    await writeFile(path, "definitely not a zip");
    await expect(ZipReader.open(path)).rejects.toThrow();
  });
});
