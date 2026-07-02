/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STIGMER_API_URL?: string;
  readonly VITE_STIGMER_CONSOLE_URL?: string;
  readonly VITE_STIGMER_FORCE_AUTH?: string;
  readonly VITE_STIGMER_TEMPORAL_ADDRESS?: string;
  /**
   * Dev-only absolute path to the in-repo runner entry (`dist/main.js`).
   * Written to `.env.development.local` by `setup-runner-dev.sh` so the desktop
   * app reads the live runner instead of Tauri's drift-prone staged copy. Unset
   * in packaged builds.
   */
  readonly VITE_STIGMER_RUNNER_ENTRY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
