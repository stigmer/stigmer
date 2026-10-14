import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { InkStigmerProvider } from "../provider.js";
import { AgentPicker } from "../components/AgentPicker.js";
import { SessionPicker } from "../components/SessionPicker.js";
import { fakeClient } from "./test-support.js";

const KEY = { enter: "\r" } as const;

// Allow the hooks' async fetch + a re-render to settle.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 60));
}

// An agent as its organization's list answers it; the picker shows it as
// search would, by its qualified slug and description.
function agent(id: string, qualifiedSlug: string, description: string) {
  const [org, slug] = qualifiedSlug.split("/");
  return create(AgentSchema, { metadata: { id, org, slug }, spec: { description } });
}

function session(id: string, subject: string, agentSlug: string) {
  return create(SessionSchema, {
    metadata: { id },
    spec: { subject, agentRef: { org: "org_acme", slug: agentSlug, kind: 40 } },
  });
}

describe("AgentPicker", () => {
  it("renders search results and returns the chosen agent on Enter", async () => {
    const results = [
      agent("agt_1", "acme/alpha", "first"),
      agent("agt_2", "acme/beta", "second"),
    ];
    const client = fakeClient({
      agent: { list: vi.fn(async () => ({ entries: results, nextPageToken: "" })) },
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

  it("offers the built-in assistant first when asked, and picks it without an agent", async () => {
    const results = [agent("agt_1", "acme/alpha", "first")];
    const client = fakeClient({
      agent: { list: vi.fn(async () => ({ entries: results, nextPageToken: "" })) },
    });
    const onSelect = vi.fn();
    const onSelectBuiltInAssistant = vi.fn();

    const { lastFrame, stdin } = render(
      <InkStigmerProvider client={client}>
        <AgentPicker
          org="acme"
          onSelect={onSelect}
          onSelectBuiltInAssistant={onSelectBuiltInAssistant}
          onCancel={vi.fn()}
        />
      </InkStigmerProvider>,
    );

    await settle();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Assistant (built-in)");
    // First row: above every agent the search found.
    expect(frame.indexOf("Assistant (built-in)")).toBeLessThan(frame.indexOf("acme/alpha"));

    stdin.write(KEY.enter);
    await settle();
    expect(onSelectBuiltInAssistant).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("offers agents only when no built-in handler is given", async () => {
    const client = fakeClient({
      agent: { list: vi.fn(async () => ({ entries: [], nextPageToken: "" })) },
    });
    const { lastFrame } = render(
      <InkStigmerProvider client={client}>
        <AgentPicker org="acme" onSelect={vi.fn()} onCancel={vi.fn()} />
      </InkStigmerProvider>,
    );
    await settle();
    expect(lastFrame() ?? "").not.toContain("Assistant (built-in)");
  });

  it("seeds the search box from initialQuery", async () => {
    const list = vi.fn(async () => ({ entries: [], nextPageToken: "" }));
    const query = vi.fn(async () => ({ entries: [], countsByKind: {}, nextPageToken: "" }));
    const client = fakeClient({ agent: { list }, search: { query } });

    const { lastFrame } = render(
      <InkStigmerProvider client={client}>
        <AgentPicker org="acme" initialQuery="deploy" onSelect={vi.fn()} onCancel={vi.fn()} />
      </InkStigmerProvider>,
    );

    await settle();
    // The picker pre-fills the input with the unresolved query the user
    // already typed; useAgentSearch then searches it (debounced).
    expect(lastFrame() ?? "").toContain("deploy");
  });
});

describe("SessionPicker", () => {
  it("client-side filters the session list and returns the chosen session", async () => {
    const sessions = [
      session("ses_1", "deploy staging", "deployer"),
      session("ses_2", "review PR", "reviewer"),
      session("ses_3", "deploy prod", "deployer"),
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
