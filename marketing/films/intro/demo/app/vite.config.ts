import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The film records against a stable origin (the capture drive's URL);
// strictPort makes a port collision loud instead of a silent drift.
export default defineConfig({
  plugins: [react()],
  server: { port: 4173, strictPort: true },
});
