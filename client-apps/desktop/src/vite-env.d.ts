/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STIGMER_API_URL?: string;
  readonly VITE_STIGMER_CONSOLE_URL?: string;
  readonly VITE_STIGMER_FORCE_AUTH?: string;
  readonly VITE_STIGMER_TEMPORAL_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
