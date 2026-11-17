// Bundles the CLI into one dependency-free ESM file, so the Claude Code plugin
// works straight from a git clone (no npm install). The bundle is written to a
// temp file and renamed into place, so a running judge never reads half a file.
import { build } from "esbuild";
import { chmod, rename } from "node:fs/promises";

const outfile = "dist/kane-judge.mjs";
const tmpfile = `dist/.kane-judge.${process.pid}.tmp.mjs`;

await build({
  entryPoints: ["src/cli/main.ts"],
  outfile: tmpfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  minify: true,
  legalComments: "inline",
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __kjCreateRequire } from 'node:module';",
      "const require = __kjCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
await chmod(tmpfile, 0o755);
await rename(tmpfile, outfile);
process.stdout.write(`built ${outfile}\n`);
