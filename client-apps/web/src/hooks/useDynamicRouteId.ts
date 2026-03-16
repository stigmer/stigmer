"use client";

import { useParams } from "next/navigation";
import { useSyncExternalStore } from "react";

const PLACEHOLDER = "__placeholder__";

function subscribeToUrl(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

function getLastPathSegment(): string {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

function getServerSnapshot(): string {
  return "";
}

/**
 * Resolves a dynamic route parameter, handling the {@link PLACEHOLDER} sentinel
 * that Next.js static export (`output: "export"`) bakes into pre-rendered HTML.
 *
 * When the Go SPA handler serves a `__placeholder__` page for a real ID,
 * `useParams()` may return `"__placeholder__"` during hydration instead of the
 * actual ID from the browser URL. This hook detects that case and extracts the
 * real segment value from `window.location.pathname` via `useSyncExternalStore`.
 *
 * Returns `""` during SSR/static generation, which integrates with query hooks
 * that use `enabled: !!id` to prevent premature API calls.
 *
 * For client-side navigation (Link clicks), `useParams()` returns the correct
 * value immediately, so this hook passes it through with no delay.
 */
export function useDynamicRouteId(paramName: string = "id"): string {
  const params = useParams<Record<string, string>>();
  const routerValue = params[paramName] ?? "";

  const urlSegment = useSyncExternalStore(
    subscribeToUrl,
    getLastPathSegment,
    getServerSnapshot,
  );

  if (routerValue === PLACEHOLDER) {
    return urlSegment !== PLACEHOLDER ? urlSegment : "";
  }
  return routerValue;
}
