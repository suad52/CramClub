import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // @ovr/shared ships TypeScript source, so bundle it into the server build.
  noExternal: ["@ovr/shared"],
});
