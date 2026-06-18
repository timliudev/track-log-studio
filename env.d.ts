/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Compile-time build identity injected via Vite `define` (see vite.config.ts).
declare const __BUILD_SHA__: string
declare const __BUILD_DATE__: string
