/// <reference types="vite/client" />

import type { JimengDesktopApi } from "../preload/index.js";

declare global {
  interface Window {
    jimengDesktop: JimengDesktopApi;
  }
}

export {};
