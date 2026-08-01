import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", bin: "src/bin.ts" },
  format: ["esm"],
  dts: { entry: "src/index.ts" },
  sourcemap: true,
  clean: true,
  target: "es2022",
  // src/bin.ts starts with a `#!/usr/bin/env node` shebang; tsup preserves it
  // on the emitted dist/bin.js, which is what package.json#bin points at.
});
