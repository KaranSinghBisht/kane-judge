// Bundles the CLI and hook entry points into one dependency-free ESM file,
// so the Claude Code plugin works straight from a git clone (no npm install).
import { build } from "esbuild";
import { chmod } from "node:fs/promises";

const outfile = "dist/kane-gate.mjs";

await build({
  entryPoints: ["src/cli/main.ts"],
  outfile,
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
      "import { createRequire as __kgCreateRequire } from 'node:module';",
      "const require = __kgCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
await chmod(outfile, 0o755);
process.stdout.write(`built ${outfile}\n`);
