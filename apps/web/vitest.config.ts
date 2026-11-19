import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) },
      {
        find: "server-only",
        replacement: fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
      },
    ],
  },
  test: { environment: "node" },
});
