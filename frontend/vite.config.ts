import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    allowedHosts: [".trycloudflare.com", "localhost", "127.0.0.1"]
  }
});
