import { describe, expect, it } from "vitest";
import { discoverFlows, flowStepHeadings, parseFlowHeader } from "../src/flows/discover.js";
import { useTempDirs, writeTree } from "./helpers/tmp.js";

const makeDir = useTempDirs();

const FLOW = (title: string, url = "http://localhost:4173") => `---\nurl: ${url}\n---\n\n# ${title}\n\n## Step one\nDo it.\n`;

describe("parseFlowHeader", () => {
  it("reads url, title and a tags list from the frontmatter", () => {
    const text = "---\nurl: http://localhost:4173\ntags: [checkout, smoke]\n---\n\n# Check out with a card\n\n## Pay\nClick Pay.\n";
    expect(parseFlowHeader(text)).toEqual({ url: "http://localhost:4173", tags: ["checkout", "smoke"], title: "Check out with a card" });
  });

  it("reads tags written as a YAML block list", () => {
    expect(parseFlowHeader("---\ntags:\n  - a\n  - b\n---\n# T\n").tags).toEqual(["a", "b"]);
  });

  it("splits tags written as a comma-separated string", () => {
    expect(parseFlowHeader("---\ntags: a, b ,c\n---\n# T\n").tags).toEqual(["a", "b", "c"]);
  });

  it("drops empty entries from a comma-separated tag string", () => {
    expect(parseFlowHeader("---\ntags: a,, ,b\n---\n# T\n").tags).toEqual(["a", "b"]);
  });

  it("keeps only the string entries of a tags list", () => {
    expect(parseFlowHeader("---\ntags: [a, 3, true, b]\n---\n# T\n").tags).toEqual(["a", "b"]);
  });

  it("returns empty tags when there are none", () => {
    expect(parseFlowHeader("---\nurl: http://x\n---\n# T\n").tags).toEqual([]);
  });

  it("reads the title of a flow that has no frontmatter", () => {
    expect(parseFlowHeader("# Browse the shop\n\n## Open\nOpen it.\n")).toEqual({ tags: [], title: "Browse the shop" });
  });

  it("leaves the title undefined when there is no heading", () => {
    expect(parseFlowHeader("---\nurl: http://x\n---\n\n## Only a step\nGo.\n").title).toBeUndefined();
  });

  it("ignores a # line that sits inside a step", () => {
    expect(parseFlowHeader("## Step\n# not the title\n").title).toBeUndefined();
  });

  it("does not take a ## step heading for the title", () => {
    expect(parseFlowHeader("## Step one\nGo.\n").title).toBeUndefined();
  });

  it("handles CRLF line endings", () => {
    const header = parseFlowHeader("---\r\nurl: http://x\r\ntags: [a]\r\n---\r\n# Title\r\n\r\n## S\r\nGo\r\n");
    expect(header).toEqual({ url: "http://x", tags: ["a"], title: "Title" });
  });

  it("ignores a url that is not a string", () => {
    expect(parseFlowHeader("---\nurl: [a, b]\n---\n# T\n").url).toBeUndefined();
  });

  it("tolerates malformed frontmatter and still finds the title", () => {
    expect(parseFlowHeader("---\nurl: [unclosed\n  : :\n---\n# Still titled\n")).toEqual({ tags: [], title: "Still titled" });
  });

  it("tolerates empty frontmatter", () => {
    expect(parseFlowHeader("---\n\n---\n# T\n")).toEqual({ tags: [], title: "T" });
  });

  it("returns an empty header for empty text", () => {
    expect(parseFlowHeader("")).toEqual({ tags: [] });
  });

  it("trims the title", () => {
    expect(parseFlowHeader("#    Spaced title   \n").title).toBe("Spaced title");
  });
});

describe("flowStepHeadings", () => {
  it("lists the ## headings in order", () => {
    expect(flowStepHeadings("# Title\n\n## First\nx\n\n## Second  \ny\n")).toEqual(["First", "Second"]);
  });

  it("ignores the title and deeper headings", () => {
    expect(flowStepHeadings("# Title\n### Deep\n## Real\n")).toEqual(["Real"]);
  });

  it("returns an empty list when there are no steps", () => {
    expect(flowStepHeadings("# Title only\n")).toEqual([]);
  });
});

describe("discoverFlows", () => {
  it("finds flows recursively and names them by their path inside the flows directory", async () => {
    const root = await makeDir();
    await writeTree(root, {
      "kane/flows/checkout_test.md": FLOW("Checkout"),
      "kane/flows/admin/users_test.md": FLOW("Users"),
      "kane/flows/admin/deep/audit_test.md": FLOW("Audit"),
    });
    const flows = await discoverFlows(root, "kane/flows");
    expect(flows.map((f) => f.name)).toEqual(["admin/deep/audit", "admin/users", "checkout"]);
  });

  it("reports project-relative posix file paths", async () => {
    const root = await makeDir();
    await writeTree(root, { "kane/flows/admin/users_test.md": FLOW("Users") });
    expect((await discoverFlows(root, "kane/flows")).map((f) => f.file)).toEqual(["kane/flows/admin/users_test.md"]);
  });

  it("reads each flow's title, url and tags", async () => {
    const root = await makeDir();
    await writeTree(root, { "flows/checkout_test.md": "---\nurl: http://localhost:9\ntags: [pay]\n---\n# Pay for it\n\n## Pay\nGo.\n" });
    expect(await discoverFlows(root, "flows")).toEqual([
      { name: "checkout", file: "flows/checkout_test.md", url: "http://localhost:9", tags: ["pay"], title: "Pay for it" },
    ]);
  });

  it("returns flows sorted by path", async () => {
    const root = await makeDir();
    await writeTree(root, { "f/b_test.md": FLOW("B"), "f/a_test.md": FLOW("A"), "f/c_test.md": FLOW("C") });
    expect((await discoverFlows(root, "f")).map((f) => f.name)).toEqual(["a", "b", "c"]);
  });

  it("skips Kane output directories, however deep", async () => {
    const root = await makeDir();
    await writeTree(root, {
      "f/real_test.md": FLOW("Real"),
      "f/output-20261117/copy_test.md": FLOW("Copy"),
      "f/sub/helper-output-3/copy_test.md": FLOW("Copy"),
      "f/sub/output-x/nested/copy_test.md": FLOW("Copy"),
    });
    expect((await discoverFlows(root, "f")).map((f) => f.name)).toEqual(["real"]);
  });

  it("skips node_modules and dot directories", async () => {
    const root = await makeDir();
    await writeTree(root, {
      "f/real_test.md": FLOW("Real"),
      "f/node_modules/pkg/x_test.md": FLOW("X"),
      "f/.hidden/y_test.md": FLOW("Y"),
    });
    expect((await discoverFlows(root, "f")).map((f) => f.name)).toEqual(["real"]);
  });

  it("only picks up files that end in _test.md", async () => {
    const root = await makeDir();
    await writeTree(root, {
      "f/ok_test.md": FLOW("Ok"),
      "f/README.md": "# Readme\n",
      "f/notes.md": "# Notes\n",
      "f/old_test.md.bak": FLOW("Old"),
      "f/checkout_test.txt": FLOW("Txt"),
    });
    expect((await discoverFlows(root, "f")).map((f) => f.name)).toEqual(["ok"]);
  });

  it("returns an empty list when the flows directory does not exist", async () => {
    expect(await discoverFlows(await makeDir(), "kane/flows")).toEqual([]);
  });

  it("does not look outside the flows directory", async () => {
    const root = await makeDir();
    await writeTree(root, { "f/in_test.md": FLOW("In"), "elsewhere/out_test.md": FLOW("Out") });
    expect((await discoverFlows(root, "f")).map((f) => f.name)).toEqual(["in"]);
  });

  it("still lists a flow whose frontmatter is malformed", async () => {
    const root = await makeDir();
    await writeTree(root, { "f/bad_test.md": "---\nurl: [unclosed\n---\n# Bad\n" });
    expect(await discoverFlows(root, "f")).toEqual([{ name: "bad", file: "f/bad_test.md", tags: [], title: "Bad" }]);
  });
});
