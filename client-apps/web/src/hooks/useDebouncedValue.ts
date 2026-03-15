"use client";

import { useEffect, useState } from "react";

/**
 * Returns a debounced version of the input value. The returned value only
 * updates after the input has been stable for {@link delayMs} milliseconds.
 *
 * Useful for search inputs where you want to avoid firing a query on every
 * keystroke. Debounce the value, not the query function — TanStack Query
 * deduplicates requests by key, so if the debounced value hasn't changed no
 * new request fires.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
