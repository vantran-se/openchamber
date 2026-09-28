import { browserRandomId, type BrowserCrypto } from "@/lib/browserRandomId"

/** Identifies a page without requiring `crypto.randomUUID` support. */
export function createRunLauncherId(cryptoSource: BrowserCrypto | undefined): string {
  return browserRandomId(cryptoSource) ?? `launcher-${Date.now().toString(36)}`
}

/**
 * Identifies this page. A run launched here records it with its auto-fusion
 * config, and only this page starts that fusion, exactly once. Another client
 * or a reload shows "Fuse now" in the overview instead of racing to start a
 * second fusion.
 */
export const RUN_LAUNCHER_ID = createRunLauncherId(globalThis.crypto)
