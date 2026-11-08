// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv, type Plugin } from "vite";

const serverEnvPlugin: Plugin = {
  name: "contraza-server-env",
  config(_config, { mode }) {
    const env = loadEnv(mode, process.cwd(), "");
    const serverKeys = [
      "GEMINI_API_KEY",
      "FIREBASE_PROJECT_ID",
      "FIREBASE_SERVICE_ACCOUNT_PATH",
      "FIREBASE_CLIENT_EMAIL",
      "FIREBASE_PRIVATE_KEY",
    ] as const;

    for (const key of serverKeys) {
      if (!process.env[key] && env[key]) process.env[key] = env[key];
    }
  },
};

export default defineConfig({
  plugins: [serverEnvPlugin],
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
