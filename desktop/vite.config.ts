import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Built into dist/app/ because the backend Worker serves dist/ and the app lives at /app/.
// In dev, API calls go to a local `wrangler dev` (port 8787) through the proxy below.
export default defineConfig({
  base: "/app/",
  plugins: [svelte()],
  build: { outDir: "dist/app", emptyOutDir: true },
  server: {
    fs: { allow: [".."] }, // design/tokens.css lives one level up
    proxy: Object.fromEntries(
      ["/sync", "/tasks", "/projects", "/sections", "/deps", "/capture", "/health"].map((p) => [p, "http://127.0.0.1:8787"]),
    ),
  },
  test: { include: ["test/**/*.test.ts"] },
});
