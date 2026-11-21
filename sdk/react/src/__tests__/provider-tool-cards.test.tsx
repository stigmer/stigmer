// Tests for StigmerProvider's toolCards: the host's map reaches the rows as
// one map while its entries stay the same, even when the host passes a new
// inline object every render, and changes as soon as a name or a card comes,
// goes or changes; a provider without it hands the rows no map.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useContext } from "react";
import type { Stigmer } from "@stigmer/client";
import { StigmerProvider } from "../provider";
import { ToolCardsContext, type ToolCardProps, type ToolCards } from "../run/tool-cards-context";

afterEach(cleanup);

// A minimal client, as provider-mermaid-loader.test.tsx builds it.
function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

const seen: (ToolCards | null)[] = [];

function Probe() {
  seen.push(useContext(ToolCardsContext));
  return null;
}

function InvoiceCard({ call }: ToolCardProps) {
  return <p>{call.tool}</p>;
}

function RefundCard({ call }: ToolCardProps) {
  return <p>{call.tool}</p>;
}

describe("StigmerProvider toolCards", () => {
  it("hands the rows no map when the host passes none", () => {
    seen.length = 0;
    render(
      <StigmerProvider client={makeClient()}>
        <Probe />
      </StigmerProvider>,
    );

    expect(seen.at(-1)).toBeNull();
  });

  it("keeps one map across renders of an inline object with the same entries", () => {
    seen.length = 0;
    const client = makeClient();
    const { rerender } = render(
      <StigmerProvider client={client} toolCards={{ mcp__billing__create_invoice: InvoiceCard }}>
        <Probe />
      </StigmerProvider>,
    );
    rerender(
      <StigmerProvider client={client} toolCards={{ mcp__billing__create_invoice: InvoiceCard }}>
        <Probe />
      </StigmerProvider>,
    );

    expect(new Set(seen).size).toBe(1);
    expect(seen.at(-1)?.["mcp__billing__create_invoice"]).toBe(InvoiceCard);
  });

  it("changes the map when a card changes, a name comes, or the map goes", () => {
    seen.length = 0;
    const client = makeClient();
    const tree = (cards: ToolCards | undefined) => (
      <StigmerProvider client={client} {...(cards === undefined ? {} : { toolCards: cards })}>
        <Probe />
      </StigmerProvider>
    );
    const { rerender } = render(tree({ mcp__billing__create_invoice: InvoiceCard }));
    rerender(tree({ mcp__billing__create_invoice: RefundCard }));
    expect(seen.at(-1)?.["mcp__billing__create_invoice"]).toBe(RefundCard);

    rerender(tree({ mcp__billing__create_invoice: RefundCard, mcp__billing__refund: RefundCard }));
    expect(Object.keys(seen.at(-1) ?? {})).toEqual(["mcp__billing__create_invoice", "mcp__billing__refund"]);

    rerender(tree(undefined));
    expect(seen.at(-1)).toBeNull();
  });
});
