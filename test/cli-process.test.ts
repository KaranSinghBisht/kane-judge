import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../src/shared/proc.js";
import { buildPack } from "./helpers/pack.js";
import { useTempDirs, writeTree } from "./helpers/tmp.js";

const makeDir = useTempDirs();
const cli = join(import.meta.dirname, "../dist/kane-judge.mjs");

// A real subprocess at the Kane boundary, not vi.mock. This checks argv,
// streams, evidence collection, policy invocation, persistence and exit codes.
// It does NOT claim to test Chrome or Kane's AI; recorded/live tests cover those.
async function harness(mode: "passed" | "failed" | "empty" | "partial" | "setup" = "passed") {
  const dir = await makeDir();
  const files: Record<string, string | Uint8Array> = {};
  const packed: Record<string, string> = {};
  for (const [name, claim] of [["01-cart", "c1"], ["02-pay", "c2"]]) {
    const text = `---\nurl: https://shop.example.app/\ntags: [judge, ${claim}]\n---\n# ${name}\n\n## Check\nVerify the page visibly shows ${name}.\n`;
    files[`flows/${name}_test.md`] = text;
    packed[`tests/${name}-12345678/test.md`] = text;
    packed[`tests/${name}-12345678/result.yaml`] = `status: ${mode === "failed" ? "failed" : "passed"}\nsteps:\n  - {kind: assert, status: ${mode === "failed" ? "failed" : "passed"}}\n`;
  }
  files["fixture.evidence"] = buildPack(packed);
  files["scan.json"] = JSON.stringify({ version: 1, mode: "judge", scannedAt: "2026-11-24T10:00:00Z", slug: "shop", name: "Shop", inputs: ["."], demoCandidates: [], repos: [], videos: [], injectionHints: [], pages: [] });
  const script = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2), mode=${JSON.stringify(mode)};
fs.appendFileSync('invocations.jsonl',JSON.stringify(args)+'\\n');
const emit=v=>process.stdout.write(JSON.stringify(v)+'\\n');
if(args[0]==='evidence') {
 const sha=createHash('sha256').update(fs.readFileSync(args[2])).digest('hex');
 emit({verdicts:[{policy:{id:'kane-judge-claims'},pack:{sha256:sha},result:mode==='failed'?'fail':'pass',gates:['no-failed-flows','no-unjudged-flows','no-skipped-flows','every-passed-flow-has-checks'].map(id=>({id,status:'pass'})),failed_gates:mode==='failed'?['no-failed-flows']:[],warnings:[],errored_gates:[]}]});
 process.exit(mode==='failed'?1:0);
}
if(mode==='setup')process.exit(2);
const members=args.filter(a=>a.endsWith('_test.md'));
fs.mkdirSync('.testmuai/evidence',{recursive:true});fs.copyFileSync('fixture.evidence','.testmuai/evidence/contract.evidence');
emit({type:'testrun_start',execution_id:'contract'});
for(const file of mode==='empty'?[]:mode==='partial'?members.slice(0,1):members){
 const name=path.basename(file).replace('_test.md',''),status=mode==='failed'?'failed':'passed',log=path.resolve(name+'.ndjson');
 fs.writeFileSync(log,JSON.stringify({type:'test_md_step_start',step_index:0,heading:'Check'})+'\\n'+JSON.stringify({type:'test_md_step_end',step_index:0,status})+'\\n');
 emit({type:'testrun_member_end',path:file,test_id:name+'-12345678',log_path:log,status});
}
emit({type:'testrun_done',overall_status:mode==='failed'?'failed':'passed'});
process.exit(mode==='failed'?1:0);
`;
  files["kane-cli"] = script;
  await writeTree(dir, files);
  await chmod(join(dir, "kane-cli"), 0o755);
  const call = (...args: string[]) => runCommand(process.execPath, [cli, ...args], { cwd: dir, timeoutMs: 15_000, killGraceMs: 100, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, KANE_JUDGE_NO_HOOK: "1" } });
  return { dir, call };
}

describe("bundled CLI process contract", () => {
  it("runs every flow, turns healing off, calls the verdict engine and persists evidence", async () => {
    const h = await harness();
    const result = await h.call("run", h.dir, "--gate");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Gate: PASS");
    const calls = (await readFile(join(h.dir, "invocations.jsonl"), "utf8")).trim().split("\n").map(l => JSON.parse(l) as string[]);
    expect(calls[0]).toContain("--no-adaptive-heal");
    expect(calls[0]?.at(calls[0].indexOf("--parallel") + 1)).toBe("1");
    expect(calls[1]?.slice(0, 2)).toEqual(["evidence", "verdict"]);
    const r = JSON.parse(await readFile(join(h.dir, "kane-results.json"), "utf8"));
    expect(Object.keys(r.flows)).toEqual(["01-cart", "02-pay"]);
    expect(r.flows["01-cart"].asserts).toEqual({ total: 1, passed: 1 });
    expect(r.runs[0].packSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns exit 1 on a completed failed gate", async () => {
    const h = await harness("failed");
    const r = await h.call("run", h.dir, "--gate");
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("Gate: FAIL");
  });

  it.each(["empty", "partial"] as const)("refuses a %s runner response rather than claiming a complete gate", async mode => {
    const h = await harness(mode);
    const r = await h.call("run", h.dir, "--gate");
    expect(r.exitCode).not.toBe(0);
  });

  it("does not run a subset when --only includes a typo", async () => {
    const h = await harness();
    const r = await h.call("run", h.dir, "--only", "01-cart,typo");
    expect(r.exitCode).toBe(2);
    await expect(readFile(join(h.dir, "invocations.jsonl"))).rejects.toThrow();
  });

  it("does not call a subset of flows a gate", async () => {
    const h = await harness();
    const r = await h.call("run", h.dir, "--gate", "--only", "01-cart");
    expect(r.exitCode).toBe(2);
    await expect(readFile(join(h.dir, "invocations.jsonl"))).rejects.toThrow();
  });

  it("refuses duplicate file names across subfolders before Kane can merge them", async () => {
    const h = await harness();
    await writeTree(h.dir, { "flows/nested/01-cart_test.md": await readFile(join(h.dir, "flows/01-cart_test.md"), "utf8") });
    expect((await h.call("run", h.dir, "--gate")).exitCode).toBe(2);
    await expect(readFile(join(h.dir, "invocations.jsonl"))).rejects.toThrow();
  });

  it("returns setup failure rather than a product verdict on exit 2", async () => {
    const h = await harness("setup");
    expect((await h.call("run", h.dir, "--gate")).exitCode).toBe(2);
    const r = JSON.parse(await readFile(join(h.dir, "kane-results.json"), "utf8"));
    expect(r.runs[0].outcome).toBe("error");
    expect(r.flows).toEqual({});
  });

  it("does not spend a Kane run or reset history when results are corrupt", async () => {
    const h = await harness();
    await writeTree(h.dir, { "kane-results.json": "{truncated" });
    expect((await h.call("run", h.dir)).exitCode).toBe(2);
    expect(await readFile(join(h.dir, "kane-results.json"), "utf8")).toBe("{truncated");
    await expect(readFile(join(h.dir, "invocations.jsonl"))).rejects.toThrow();
  });

  it("refuses a concurrent run without replacing its ownership marker", async () => {
    const h = await harness();
    const marker = JSON.stringify({ pid: process.pid, startedAt: Date.now() });
    await writeTree(h.dir, { ".kane-judge/running.json": marker });
    expect((await h.call("run", h.dir)).exitCode).toBe(2);
    expect(await readFile(join(h.dir, ".kane-judge/running.json"), "utf8")).toBe(marker);
    await expect(readFile(join(h.dir, "invocations.jsonl"))).rejects.toThrow();
  });
});
