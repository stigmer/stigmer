"use client";

import { useEffect, useState } from "react";

/**
 * Object URL over a locally-held `File`, alive for the lifetime of the
 * mounted component (no fetch — the bytes are already in memory).
 *
 * The URL is created in an effect, not a memo: StrictMode double-invokes
 * memos and would leak the first URL without a revoke. The effect cleanup
 * revokes on unmount and on file change. Returns `null` until the effect
 * runs (first paint) — callers render a fallback for that frame.
 *
 * Deliberately display-oriented: the SDK's other `createObjectURL` calls
 * (`useExportResource`, `useExportCSV`) are fire-and-forget download
 * helpers with an immediate revoke, a different lifecycle from this one.
 */
export function useObjectUrl(file: File): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return url;
}
