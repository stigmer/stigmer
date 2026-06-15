import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { SearchResultSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { InkStigmerProvider } from "../provider.js";
import { AgentPicker } from "../components/AgentPicker.js";
import { SessionPicker } from "../components/SessionPicker.js";

const KEY = { enter: "\r" } as const;

// Allow the hooks' async fetch + a re-render to settle.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60));
}

function agentResult(id: string, slug: string, description: string) {
  return create(SearchResultSchema, { id, qualifiedSlug: slug, description });
}

function session(id: string, subject: string, agentInstanceId: string) {
  return create(SessionSchema, {
    metadata: { id },
    spec: { subject, agentInstanceId },
  });
}

// Minimal Stigmer stub exposing only the methods the picker hooks call.
function fakeClient(overrides: Record<string, unknown>): Stigmer {
  return overrides as unknown as Stigmer;
}

describe("AgentPicker", () => {
  it("renders search results and returns the chosen agent on Enter", async () => {
    const results = [
      agentResult("agt_1", "acme/alpha", "first"),
      agentResult("agt_2", "acme/beta", "second"),
    ];
    const client = fakeClient({
      agent: { list: vi.fn(async () => ({ entries: results, totalPages: 1, totalCount: 2 })) },
    });
    const onSelect = vi.fn();

    const { lastFrame, stdin } = render(
      <InkStigmerProvider client={client}>
        <AgentPicker org="acme" onSelect={onSelect} onCancel={vi.fn()} />
      </InkStigmerProvider>,
    );

    await settle();
    expect(lastFrame() ?? "").toContain("acme/alpha");
    expect(lastFrame() ?? "").toContain("first");

    stdin.write(KEY.enter);
    await settle();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("agt_1");
  });

  it("seeds the search box from initialQuery", async () => {
    const list = vi.fn(async () => ({ entries: [], totalPages: 0, totalCount: 0 }));
    const client = fakeClient({ agent: { list } });

    const { lastFrame } = render(
      <InkStigmerProvider client={client}>
        <AgentPicker org="acme" initialQuery="deploy" onSelect={vi.fn()} onCancel={vi.fn()} />
      </InkStigmerProvider>,
    );

    await settle();
    // The picker pre-fills the input with the unresolved query the user
    // already typed; useAgentSearch then re-searches it (debounced).
    expect(lastFrame() ?? "").toContain("deploy");
  });
});

describe("SessionPicker", () => {
  it("client-side filters the session list and returns the chosen session", async () => {
    const sessions = [
      session("ses_1", "deploy staging", "ai_1"),
      session("ses_2", "review PR", "ai_2"),
      session("ses_3", "deploy prod", "ai_3"),
    ];
    const client = fakeClient({
      session: { list: vi.fn(async () => ({ entries: sessions })) },
    });
    const onSelect = vi.fn();

    const { lastFrame, stdin } = render(
      <InkStigmerProvider client={client}>
        <SessionPicker initialQuery="deploy" onSelect={onSelect} onCancel={vi.fn()} />
      </InkStigmerProvider>,
    );

    await settle();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("deploy staging");
    expect(frame).toContain("deploy prod");
    expect(frame).not.toContain("review PR");

    stdin.write(KEY.enter);
    await settle();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].metadata.id).toBe("ses_1");
  });
});
