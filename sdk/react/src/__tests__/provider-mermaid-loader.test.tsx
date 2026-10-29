// Tests for StigmerProvider's loadMermaid: the host's loader reaches the
// kit's diagrams as one function for the provider's lifetime, even when the
// host passes a new inline arrow every render, and calls the latest one; a
// provider without it hands the diagrams no loader; and a loader that
// arrives on a later render reaches a diagram already on screen, which
// draws through it.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { useContext } from "react";
import type { Stigmer } from "@stigmer/client";
import { StigmerProvider } from "../provider";
import { MermaidDiagram } from "../internal/MermaidDiagram";
import { MermaidLoaderContext, type MermaidLoader, type MermaidModule } from "../mermaid-loader-context";

afterEach(cleanup);

// A minimal client, as provider-theme-scope.test.tsx builds it: a null
// credential keeps the provider's registry fetch from touching the network.
function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

const seen: (MermaidLoader | null)[] = [];

function Probe() {
  seen.push(useContext(MermaidLoaderContext));
  return null;
}

const MERMAID = { initialize: vi.fn(), render: vi.fn() } as unknown as MermaidModule;

describe("StigmerProvider loadMermaid", () => {
  it("hands the diagrams no loader when the host passes none", () => {
    seen.length = 0;
    render(
      <StigmerProvider client={makeClient()}>
        <Probe />
      </StigmerProvider>,
    );

    expect(seen.at(-1)).toBeNull();
  });

  it("keeps one loader across renders that calls the host's latest", async () => {
    seen.length = 0;
    const client = makeClient();
    const firstHostLoader = vi.fn(() => Promise.resolve({ default: MERMAID }));
    const latestHostLoader = vi.fn(() => Promise.resolve({ default: MERMAID }));

    const { rerender } = render(
      <StigmerProvider client={client} loadMermaid={firstHostLoader}>
        <Probe />
      </StigmerProvider>,
    );
    rerender(
      <StigmerProvider client={client} loadMermaid={latestHostLoader}>
        <Probe />
      </StigmerProvider>,
    );

    const loaders = new Set(seen);
    expect(loaders.size).toBe(1);
    const [loader] = loaders;
    await expect(loader!()).resolves.toEqual({ default: MERMAID });
    expect(latestHostLoader).toHaveBeenCalledTimes(1);
    expect(firstHostLoader).not.toHaveBeenCalled();
  });

  it("draws a mounted diagram through a loader that arrives on a later render", async () => {
    const client = makeClient();
    const drawing = {
      initialize: vi.fn(),
      render: vi.fn().mockResolvedValue({ svg: "<svg data-testid='drawn'></svg>" }),
    } as unknown as MermaidModule;
    const hostLoader = vi.fn(() => Promise.resolve({ default: drawing }));

    const { rerender, container } = render(
      <StigmerProvider client={client}>
        <MermaidDiagram chart={"flowchart LR\n  A --> B"} />
      </StigmerProvider>,
    );
    rerender(
      <StigmerProvider client={client} loadMermaid={hostLoader}>
        <MermaidDiagram chart={"flowchart LR\n  A --> B"} />
      </StigmerProvider>,
    );

    await waitFor(() => expect(container.querySelector("[data-testid='drawn']")).not.toBeNull());
    expect(hostLoader).toHaveBeenCalledTimes(1);
  });
});
