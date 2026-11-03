/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** true only in the static/hosted build (vite.hosted.config.ts) */
  readonly VITE_HOSTED?: boolean | string;
}
