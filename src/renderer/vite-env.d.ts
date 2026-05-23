/// <reference types="vite/client" />

import type { RecourseApi } from '../preload'

declare global {
  interface Window {
    recourse?: RecourseApi
  }
}
