import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

await rm(join(projectRoot, "dist"), { force: true, recursive: true });

await build({
  absWorkingDir: projectRoot,
  banner: {
    js: "#!/usr/bin/env node",
  },
  bundle: true,
  entryPoints: ["src/cli.ts"],
  format: "esm",
  outfile: "dist/vinea.mjs",
  platform: "node",
});
