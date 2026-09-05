/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin, or "" in local dev so requests go through the Vite proxy. */
  readonly VITE_API_BASE_URL?: string;
  /** "true" serves every request from src/api/mocks.ts instead of the network. */
  readonly VITE_USE_MOCKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
