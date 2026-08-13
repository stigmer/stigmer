import React, { type ReactElement } from "react";
import { render } from "ink-testing-library";
import type { Stigmer } from "@stigmer/sdk";
import { InkStigmerProvider } from "../provider.js";

/**
 * Builds a minimal Stigmer stub exposing only the methods a test's hooks call.
 * Anything not overridden is absent, so a test that touches an unstubbed method
 * fails loudly rather than silently no-op'ing.
 */
export function fakeClient(overrides: Record<string, unknown> = {}): Stigmer {
  return overrides as unknown as Stigmer;
}

/**
 * Renders a tree under an {@link InkStigmerProvider} so hooks that read the
 * Stigmer client (e.g. `useFileChangeContent` → `useStigmer`, which throws
 * without a provider) work. Returns the `ink-testing-library` handle.
 *
 * The explicit return type is load-bearing: ink-testing-library does not
 * export its `Instance` type, and its stdout/stderr classes carry private
 * members — under `declaration: true` an inferred return type here fails
 * declaration emit with TS4094 (`ReturnType<typeof render>` stays a named
 * reference the emitter never has to expand).
 */
export function renderWithClient(
  node: ReactElement,
  client: Stigmer = fakeClient(),
): ReturnType<typeof render> {
  return render(<InkStigmerProvider client={client}>{node}</InkStigmerProvider>);
}
