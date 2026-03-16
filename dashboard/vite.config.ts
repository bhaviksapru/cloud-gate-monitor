import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  define: {
    __COGNITO_DOMAIN__:    JSON.stringify(process.env.VITE_COGNITO_DOMAIN    ?? ""),
    __COGNITO_CLIENT_ID__: JSON.stringify(process.env.VITE_COGNITO_CLIENT_ID ?? ""),
    __API_BASE_URL__:      JSON.stringify(process.env.VITE_API_BASE_URL      ?? ""),
    __CF_DOMAIN__:         JSON.stringify(process.env.VITE_CF_DOMAIN         ?? ""),
  },
});
