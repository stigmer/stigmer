// Scratch, never committed: the suite's config on a port no peer session uses.
import config from "./playwright.config.ts";
const PORT = 4193;
export default {
  ...config,
  use: { ...config.use, baseURL: `http://localhost:${PORT}` },
  webServer: { ...config.webServer, command: `npx vite build && npx vite preview --strictPort --port ${PORT}`, url: `http://localhost:${PORT}` },
};
