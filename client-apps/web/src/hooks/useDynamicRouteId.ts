"use client";

import { useParams } from "next/navigation";
import { useState, useEffect } from "react";

const PLACEHOLDER = "__placeholder__";

/**
 * Resolves a dynamic route parameter, handling the {@link PLACEHOLDER} sentinel
 * that Next.js static export (`output: "export"`) bakes into pre-rendered HTML.
 *
 * When the Go SPA handler serves a `__placeholder__` page for a real ID,
 * `useParams()` may return `"__placeholder__"` during hydration instead of the
 * actual ID from the browser URL. This hook detects that case and extracts the
 * real segment value from `window.location.pathname`.
 *
 * Returns `""` while the real ID is being resolved, which integrates with
 * query hooks that use `enabled: !!id` to prevent premature API calls.
 *
 * For client-side navigation (Link clicks), `useParams()` returns the correct
 * value immediately, so this hook passes it through with no delay.
 */
export function useDynamicRouteId(paramName: string = "id"): string {
  const params = useParams<Record<string, string>>();
  const routerValue = params[paramName] ?? "";

  const [id, setId] = useState(() =>
    routerValue === PLACEHOLDER ? "" : routerValue,
  );

  useEffect(() => {
    if (routerValue === PLACEHOLDER) {
      const segments = window.location.pathname.split("/").filter(Boolean);
      const urlValue = segments[segments.length - 1];
      if (urlValue && urlValue !== PLACEHOLDER) {
        setId(urlValue);
      }
    } else if (routerValue !== id) {
      setId(routerValue);
    }
  }, [routerValue, id]);

  return id;
}
