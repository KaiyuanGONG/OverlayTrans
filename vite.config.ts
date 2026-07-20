import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
// @ts-expect-error Local ESM build plugin intentionally has no declaration file.
import { createFrontendLicensePlugin } from "./scripts/lib/frontend-license-report.mjs";

// https://vitejs.dev/config/
export default defineConfig(async () => {
  const root = __dirname;
  const reportPath = process.env.OVERLAYTRANS_FRONTEND_LICENSE_OUTPUT
    ?? path.resolve(root, "src-tauri/licenses/FRONTEND_THIRD_PARTY_LICENSES.txt");

  return {
    plugins: [
      react(),
      createFrontendLicensePlugin({
        root,
        lockPath: path.resolve(root, "package-lock.json"),
        outputPath: reportPath,
      }),
    ],

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 5173,
      strictPort: true,
      watch: {
        // 3. tell vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
