import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findInjectionHints } from "../src/scan/injection.js";
import { isDemoHost, parseRepo } from "../src/scan/links.js";
import { readmeDemoLinks } from "../src/scan/readme-links.js";
import { displayPath } from "../src/shared/fs.js";

const ROOT = join(import.meta.dirname, "..");

describe("subfolder submissions (monorepos, example apps)", () => {
  it("reads the branch and folder from a /tree/ URL", () => {
    expect(parseRepo("https://github.com/acme/mono/tree/main/apps/shop")).toEqual({
      owner: "acme",
      repo: "mono",
      url: "https://github.com/acme/mono/tree/main/apps/shop",
      ref: "main",
      path: "apps/shop",
    });
  });

  it("uses the folder that holds a /blob/ file, and decodes encoded names", () => {
    expect(parseRepo("https://github.com/acme/mono/blob/dev/apps/my%20shop/README.md")).toMatchObject({ ref: "dev", path: "apps/my shop", url: "https://github.com/acme/mono/tree/dev/apps/my%20shop" });
  });

  it("treats a bare branch URL, or any other GitHub page of a repo, as the repo root", () => {
    expect(parseRepo("https://github.com/acme/mono/tree/main")).toEqual({ owner: "acme", repo: "mono", url: "https://github.com/acme/mono", ref: "main" });
    expect(parseRepo("https://github.com/acme/mono/issues/5")).toEqual({ owner: "acme", repo: "mono", url: "https://github.com/acme/mono" });
  });

  it("never lets a URL walk out of the repo", () => {
    expect(parseRepo("https://github.com/acme/mono/tree/main/apps/%2e%2e/%2e%2e/secret")?.path).toBeUndefined();
    expect(parseRepo("https://github.com/acme/mono/tree/main/a%2Fb")?.path).toBeUndefined();
  });
});

describe("finding the live demo in a README", () => {
  const readme = [
    "# Shop",
    "![build](https://img.shields.io/badge/build-passing-green.svg) ![shot](https://shop.example.dev/shot.png)",
    "Docs: https://docs.example.dev/guide and the API reference at https://api.example.dev.",
    "**Live demo:** https://shop.example.dev (or run it locally and open http://localhost:4173).",
    "A preview build also lives at https://shop-preview.vercel.app/",
    "Watch the video: https://youtu.be/abc and star https://github.com/acme/shop",
  ].join("\n");

  it("prefers the link its own line calls the demo, then known demo hosts, and ignores docs, badges and images", () => {
    expect(readmeDemoLinks(readme)).toEqual(["https://shop.example.dev", "http://localhost:4173", "https://shop-preview.vercel.app/"]);
  });

  it("finds nothing in a README without a demo", () => {
    expect(readmeDemoLinks("# Tool\nInstall with npm. Docs: https://docs.example.dev")).toEqual([]);
  });

  it("knows the usual demo hosts", () => {
    expect(isDemoHost("https://x.vercel.app/a")).toBe(true);
    expect(isDemoHost("https://example.com")).toBe(false);
    expect(isDemoHost("not a url")).toBe(false);
  });
});

describe("Kane Judge's own README", () => {
  it("doesn't trip its own prompt-injection detector", () => {
    expect(findInjectionHints({ README: readFileSync(join(ROOT, "README.md"), "utf8") })).toEqual([]);
  });

  it("while the sample submission's hidden comment still does", () => {
    const sample = readFileSync(join(ROOT, "examples", "inkwell-shop", "README.md"), "utf8");
    expect(findInjectionHints({ README: sample }).join("\n")).toContain("hidden HTML comment");
  });
});

describe("displayPath", () => {
  it("is relative inside the working folder and absolute outside it", () => {
    expect(displayPath("/work/event/projects/shop", "/work/event")).toBe("projects/shop");
    expect(displayPath("/work/event", "/work/event")).toBe(".");
    expect(displayPath("/elsewhere/projects/shop", "/work/event")).toBe("/elsewhere/projects/shop");
  });
});
