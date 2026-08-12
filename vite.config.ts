import { defineConfig } from "vite";

// One server, one dream. The player fetches its world from /dream/, which
// `bun run lord build <slug>` writes into public/dream/.
export default defineConfig({
  server: {
    // Fail loudly when a production server already owns 8080. Without an explicit
    // host Linux can run Vite on ::1 and Bun on 0.0.0.0 at the same time, making
    // `localhost` randomly serve two different builds.
    host: "127.0.0.1",
    port: 8080,
    strictPort: true,
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
