"use client";

import { useMemo } from "react";
import { StigmerProvider, SessionComposer } from "@stigmer/react";
import { createDemoClient } from "@stigmer/react/demo";
import type { DemoScenario } from "@stigmer/react/demo";

const emptyScenario: DemoScenario = { fixtures: new Map() };

const noop = () => {};

/**
 * Self-contained SessionComposer demo for documentation pages.
 *
 * Renders the composer inside a StigmerProvider backed by a demo client
 * so no live backend is required. Uses an empty scenario — the minimal
 * composer (textarea + model selector + send button) fires no RPCs.
 */
export function SessionComposerDemo() {
  const client = useMemo(() => createDemoClient(emptyScenario), []);

  return (
    <div className="not-prose mx-auto max-w-2xl">
      <StigmerProvider client={client}>
        <SessionComposer
          onSubmit={noop}
          placeholder="Ask anything..."
          showModelSelector
          enableAttachments={false}
          initialRows={3}
          autoFocus={false}
        />
      </StigmerProvider>
    </div>
  );
}
