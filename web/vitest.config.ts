import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    // Expose afterEach etc. globally so Testing Library's auto-cleanup
    // between tests can register itself.
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Scope discovery to the source dirs. A bare `**` also reaches the pnpm
    // hardlink mirror (`.pnpm-store/v11/projects/**`, linked in via
    // node_modules), which runs every test a second time outside jsdom.
    include: ["{app,components,lib}/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/.pnpm-store/**"],
  },
});
