import { defineConfig } from "vite";

// One server, one dream. The player fetches its world from /dream/, which
// `bun run lord build <slug>` writes into public/dream/.
export default defineConfig({
  server: {
    port: 8080,
    open: true,
    proxy: {
      "/api": "http://127.0.0.1:8081",
    },
  },
  build: {
    // Pixel art: no inlining of the atlas, it must stay a real PNG the loader fetches.
    assetsInlineLimit: 0,
    target: "es2022",
  },
});
