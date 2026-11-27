/**
 * A composer opened for an agent (`initialAgentRef`, the agent page's
 * Start session) holds Send until that agent has been read, so a first
 * message can never start a conversation with the default assistant
 * instead (stigmer#3481). Pins: while the agent is being read, Send is
 * disabled and says why, and Enter sends nothing; once the agent is
 * ready, its ref reaches the parent and Send sends; a read that fails
 * releases Send, its error shown where the agent's setup shows it; a read
 * that answers after its effect re-ran (StrictMode runs a mount effect
 * twice) still releases Send; and a composer opened for no agent never
 * holds Send for one.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import type { Stigmer } from "@stigmer/client";
import { StigmerContext } from "@stigmer/react-core";
import { noMyVaultClient } from "../../__tests__/helpers/no-my-vault";
import { ModelRegistryContext } from "../../models/ModelRegistryContext";

vi.mock("../../portal-container", () => ({
  useStigmerPortalContainer: () => document.body,
}));

const mockAgentSetup = {
  state: { status: "idle", error: null } as Record<string, unknown>,
  resolveAgent: vi.fn(),
  submitEnvVars: vi.fn(),
  signInCompleted: vi.fn(),
  reset: vi.fn(),
};
vi.mock("../../agent/useAgentSetup", () => ({
  useAgentSetup: () => mockAgentSetup,
}));

import { SessionComposer } from "../SessionComposer";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

function client(): Stigmer {
  return {
    file: { uploadFile: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
    vault: noMyVaultClient(),
    plugin: { getByReference: vi.fn().mockRejectedValue(new Error("no backend in this test")) },
    baseUrl: "http://localhost:8080",
    getAuthCredential: vi.fn().mockResolvedValue("test-token"),
    config: { baseUrl: "http://localhost:8080", getAccessToken: vi.fn().mockResolvedValue("") },
  } as unknown as Stigmer;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    // StrictMode, as a host's development build runs it: the mount effect
    // runs twice, and the read the first run started must still release Send.
    <StrictMode>
      <StigmerContext.Provider value={client()}>
        <ModelRegistryContext.Provider value={{ models: [], isLoading: false, error: null, refetch: vi.fn() }}>{children}</ModelRegistryContext.Provider>
      </StigmerContext.Provider>
    </StrictMode>
  );
}

const AGENT_REF = { org: "acme", slug: "variance-reporter" };
const HOLD = "Loading the agent\u2026";

/** A read of the agent that answers when the test says. */
function deferredRead() {
  let settle!: (value: unknown) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  mockAgentSetup.resolveAgent.mockReturnValueOnce(promise);
  return { settle, fail };
}

function sendButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement;
}

/** The text Send is described by (its held reason), or "" when it has none. */
function sendDescription(): string {
  const ids = sendButton().getAttribute("aria-describedby");
  return ids === null ? "" : ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
}

function type(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
}

beforeEach(() => {
  mockAgentSetup.state = { status: "idle", error: null };
  mockAgentSetup.resolveAgent.mockReset();
});

afterEach(cleanup);

describe("SessionComposer — opened for an agent", () => {
  it("holds Send, saying why, until the agent is read; then the message is the agent's", async () => {
    const read = deferredRead();
    const onSubmit = vi.fn();
    const onAgentRefChange = vi.fn();
    render(
      <SessionComposer onSubmit={onSubmit} org="acme" agentRef={null} onAgentRefChange={onAgentRefChange} initialAgentRef={AGENT_REF} onSkillRefsChange={vi.fn()} skillRefs={[]} />,
      { wrapper },
    );
    await waitFor(() => expect(mockAgentSetup.resolveAgent).toHaveBeenCalledWith(AGENT_REF));

    type("Review this quarter's ledger.");
    expect(sendButton().disabled).toBe(true);
    expect(sendDescription()).toBe(HOLD);
    // A sighted person reads the same words under the box.
    expect(screen.getByText(HOLD).className).not.toContain("stg:sr-only");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => {
      read.settle({ status: "ready", agentRef: AGENT_REF, agentName: "Variance Reporter", resolution: {} });
    });
    expect(onAgentRefChange).toHaveBeenCalledWith(AGENT_REF);
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    expect(sendDescription()).toBe("");
    fireEvent.click(sendButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("releases Send when the read answers after its effect re-ran (an equal ref, StrictMode's second run)", async () => {
    const read = deferredRead();
    const props = { onSubmit: vi.fn(), org: "acme", agentRef: null, onAgentRefChange: vi.fn(), onSkillRefsChange: vi.fn(), skillRefs: [] };
    const { rerender } = render(<SessionComposer {...props} initialAgentRef={AGENT_REF} />, { wrapper });
    await waitFor(() => expect(mockAgentSetup.resolveAgent).toHaveBeenCalledTimes(1));
    // The same agent, a new object: the effect's cleanup runs before the read answers.
    rerender(<SessionComposer {...props} initialAgentRef={{ ...AGENT_REF }} />);
    type("Hello");
    expect(sendButton().disabled).toBe(true);

    await act(async () => {
      read.settle({ status: "ready", agentRef: AGENT_REF, agentName: "Variance Reporter", resolution: {} });
    });
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    expect(mockAgentSetup.resolveAgent).toHaveBeenCalledTimes(1);
  });

  it("releases Send when the agent cannot be read", async () => {
    const read = deferredRead();
    render(
      <SessionComposer onSubmit={vi.fn()} org="acme" agentRef={null} onAgentRefChange={vi.fn()} initialAgentRef={AGENT_REF} onSkillRefsChange={vi.fn()} skillRefs={[]} />,
      { wrapper },
    );
    await waitFor(() => expect(mockAgentSetup.resolveAgent).toHaveBeenCalled());
    type("Hello");
    expect(sendButton().disabled).toBe(true);

    await act(async () => {
      read.fail(new Error("agent not found"));
    });
    await waitFor(() => expect(sendButton().disabled).toBe(false));
  });

  it("never holds Send when opened for no agent", () => {
    render(
      <SessionComposer onSubmit={vi.fn()} org="acme" agentRef={null} onAgentRefChange={vi.fn()} onSkillRefsChange={vi.fn()} skillRefs={[]} />,
      { wrapper },
    );
    type("Hello");
    expect(sendButton().disabled).toBe(false);
    expect(sendDescription()).toBe("");
    expect(mockAgentSetup.resolveAgent).not.toHaveBeenCalled();
  });
});
