/**
 * A new person's first run, walked end to end over a fake server: signed in
 * to an organization with no model provider, they land on the launcher's
 * connect step, save the organization's Anthropic key through its form, the
 * launcher asks the server again and becomes the composer with Send free,
 * and the first message starts a conversation whose answer streams in. The
 * session-creating flow is a stand-in that hands back a session, and the
 * answer is the scenario catalogue's streaming conversation drawn by the
 * kit's own thread; the composer is a probe whose Send is enabled exactly
 * when the launcher holds nothing (the real composer's held Send is pinned
 * in SessionComposer-sendBlocked). The suite's title holds CON-02 on the UX
 * bar (test/ux-bar.json).
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { ResourceRef } from "@stigmer/client";
import type { SessionComposerProps } from "../../composer";
import { conversationOf, scenarios } from "../../test";
import { MessageThread } from "../../run/MessageThread";
import {
  ANTHROPIC_CONNECTED,
  ORG_ID,
  fakeClient,
  readinessWrapper,
  server,
  storedKey,
} from "../../models/__tests__/readiness-fixture";
import type { UseNewSessionFlowOptions } from "../useNewSessionFlow";

vi.mock("../../composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../composer")>();
  return {
    ...actual,
    // Send is free exactly when the launcher holds nothing.
    SessionComposer: ({ onSubmit, sendBlockedReason }: SessionComposerProps) => (
      <button
        type="button"
        aria-label="Send message"
        disabled={sendBlockedReason !== undefined}
        onClick={() => void onSubmit("Invoices are off by a cent. Can you fix the rounding?")}
      />
    ),
  };
});

vi.mock("../facets/SetupTab", () => ({ SetupTab: () => null }));

vi.mock("../useNewSessionFlow", () => ({
  useNewSessionFlow: (options: UseNewSessionFlowOptions) => ({
    harness: "stigmer" as const,
    setHarness: vi.fn(),
    modelId: undefined,
    setModelId: vi.fn(),
    clearModelPick: vi.fn(),
    agentRef: null,
    setAgentRef: vi.fn(),
    resolution: null,
    setResolution: vi.fn(),
    agentRunDefaults: undefined,
    pluginRefs: [] as ResourceRef[],
    setPluginRefs: vi.fn(),
    skillRefs: [] as ResourceRef[],
    setSkillRefs: vi.fn(),
    workspace: { entries: [], hasEntries: false, toInput: vi.fn(() => []), addGitRepo: vi.fn(), addLocalPath: vi.fn(), remove: vi.fn(), clear: vi.fn() },
    autoApproveAll: false,
    setAutoApproveAll: vi.fn(),
    offersEnvironment: false,
    environmentDefaults: undefined,
    isSubmitting: false,
    submitError: null,
    submitFailure: null,
    submit: async () => options.onSessionCreated("ses_first"),
  }),
}));

import { NewSessionViewer } from "../NewSessionViewer";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(cleanup);

/** The host's two screens: the launcher, then the conversation it started. */
function FirstRun() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  if (sessionId === null) return <NewSessionViewer org={ORG_ID} onSessionCreated={setSessionId} />;
  const conversation = conversationOf(scenarios.streaming);
  return (
    <div data-session={sessionId}>
      <MessageThread turns={conversation.turns} runs={conversation.runs} org={conversation.org} />
    </div>
  );
}

describe("CON-02 a new person is led from sign-in to a provider key and a first answer", () => {
  it("connects a provider from the launcher's first screen, then sends and reads the answer as it streams", async () => {
    const fake = server();
    const calls = fakeClient(fake);
    calls.setKey.mockImplementation(async (input: { provider: string }) => {
      fake.readiness = ANTHROPIC_CONNECTED;
      fake.keys = [storedKey(input.provider)];
      return storedKey(input.provider);
    });
    render(<FirstRun />, { wrapper: readinessWrapper(calls.client) });

    // The first screen is the step that gets them an answer: connect a provider.
    expect(await screen.findByRole("heading", { level: 1, name: "Connect a model provider to start" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    const card = screen.getByRole("article", { name: "Anthropic" });

    // An admin saves the organization's key right there.
    fireEvent.change(await within(card).findByLabelText("Anthropic API key"), { target: { value: "sk-ant-first" } });
    const readsBeforeSave = calls.getModelReadiness.mock.calls.length;
    fireEvent.click(within(card).getByRole("button", { name: "Connect Anthropic" }));

    // The launcher asks the server again and becomes the composer, Send free.
    const send = await screen.findByRole("button", { name: "Send message" });
    expect(calls.setKey.mock.calls[0][0]).toMatchObject({ org: ORG_ID, provider: "anthropic", apiKey: "sk-ant-first" });
    expect(calls.getModelReadiness.mock.calls.length).toBeGreaterThan(readsBeforeSave);
    expect(screen.queryByText("Connect a model provider to start")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "What would you like to work on?" })).toBeTruthy();
    expect(send).toHaveProperty("disabled", false);

    // The first message starts a conversation, and its answer streams in.
    fireEvent.click(send);
    expect(await screen.findByText("Invoices are off by a cent. Can you fix the rounding?")).toBeTruthy();
    expect(await screen.findByText(/Looking at how invoices are totalled/)).toBeTruthy();
  });
});
