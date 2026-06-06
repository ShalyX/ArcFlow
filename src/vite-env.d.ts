/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARCFLOW_SPLITTER_ADDRESS?: `0x${string}`;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
