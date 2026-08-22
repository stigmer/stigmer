// The in-session consent surface (DD-005 D4): verbatim fact, one-click
// Confirm/Reject, and lifecycle honesty — the frozen tool result never
// shows stale action buttons over a record that was already decided,
// deleted, or unreachable.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { MemorySchema, type Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import { StigmerError } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { MemoryProposalCardBody } from "../MemoryProposalCard";

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

const FACT = "Prefers concise answers with code examples.";

function makeMemory(state: MemoryLifecycleState, content = FACT): Memory {
  return create(MemorySchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Memory",
    metadata: { id: "mem_1", name: "mem_1", slug: "mem-1", org: "test-org" },
    spec: {
      content,
      provenance: { agentId: "agt_1", sessionId: "ses_1" },
    },
    status: { lifecycleState: state },
  });
}

function renderCard(client: unknown) {
  return render(<MemoryProposalCardBody memoryId="mem_1" fact={FACT} />, {
    wrapper: wrapper(client),
  });
}

/** Waits for the record fetch to settle and the named action to arm. */
async function waitForAction(name: string): Promise<HTMLElement> {
  let button: HTMLElement | null = null;
  await waitFor(() => {
    button = screen.getByRole("button", { name });
    expect(button.hasAttribute("disabled")).toBe(false);
  });
  return button!;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("MemoryProposalCardBody", () => {
  it("renders the verbatim fact with Confirm/Reject while the record is proposed", async () => {
    const client = {
      memory: {
        get: vi.fn().mockResolvedValue(
          makeMemory(MemoryLifecycleState.lifecycle_state_proposed),
        ),
      },
    };

    renderCard(client);

    // The exact stored text — never paraphrased (DD-005 D6).
    expect(screen.getByText(FACT)).toBeTruthy();
    await waitForAction(`Confirm memory: ${FACT}`);
    expect(screen.getByRole("button", { name: `Reject memory: ${FACT}` })).toBeTruthy();
    // Provenance renders beside the fact (DD-005 D6: origin builds trust).
    expect(screen.getByText(/Proposed by agent agt_1/)).toBeTruthy();
  });

  it("confirms in one click and settles into the confirmed state line", async () => {
    const confirm = vi
      .fn()
      .mockResolvedValue(makeMemory(MemoryLifecycleState.lifecycle_state_confirmed));
    const client = {
      memory: {
        get: vi.fn().mockResolvedValue(
          makeMemory(MemoryLifecycleState.lifecycle_state_proposed),
        ),
        confirm,
      },
    };

    renderCard(client);
    const user = userEvent.setup();
    const confirmButton = await waitForAction(`Confirm memory: ${FACT}`);

    await user.click(confirmButton);

    expect(confirm).toHaveBeenCalledWith("mem_1");
    await waitFor(() =>
      expect(
        screen.getByText("Confirmed — recalled in your future sessions."),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("rejects in ONE click — no confirmation dialog (the T04 Cursor lesson)", async () => {
    const reject = vi
      .fn()
      .mockResolvedValue(makeMemory(MemoryLifecycleState.lifecycle_state_rejected));
    const client = {
      memory: {
        get: vi.fn().mockResolvedValue(
          makeMemory(MemoryLifecycleState.lifecycle_state_proposed),
        ),
        reject,
      },
    };

    renderCard(client);
    const user = userEvent.setup();
    const rejectButton = await waitForAction(`Reject memory: ${FACT}`);

    await user.click(rejectButton);

    expect(reject).toHaveBeenCalledWith("mem_1");
    await waitFor(() =>
      expect(screen.getByText("Rejected — not stored.")).toBeTruthy(),
    );
  });

  it("shows the decided state instead of stale actions when another surface decided it", async () => {
    // The tool result is frozen; the record was confirmed from the
    // memory page (or another device) — the reloaded chip must say so.
    const client = {
      memory: {
        get: vi.fn().mockResolvedValue(
          makeMemory(MemoryLifecycleState.lifecycle_state_confirmed),
        ),
      },
    };

    renderCard(client);

    await waitFor(() =>
      expect(
        screen.getByText("Confirmed — recalled in your future sessions."),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the live record's text when the fact was edited before deciding", async () => {
    const edited = "Prefers concise answers, with Go examples.";
    const client = {
      memory: {
        get: vi.fn().mockResolvedValue(
          makeMemory(MemoryLifecycleState.lifecycle_state_proposed, edited),
        ),
      },
    };

    renderCard(client);

    await waitFor(() => expect(screen.getByText(edited)).toBeTruthy());
    expect(screen.queryByText(FACT)).toBeNull();
  });

  it("reads 'no longer stored' for a deleted record — a state, never an error", async () => {
    const client = {
      memory: {
        get: vi
          .fn()
          .mockRejectedValue(new StigmerError("not-found", "memory not found", 5)),
      },
    };

    renderCard(client);

    await waitFor(() =>
      expect(screen.getByText("No longer stored.")).toBeTruthy(),
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the frozen fact visible when the state fetch fails, pointing at the memory page", async () => {
    const client = {
      memory: {
        get: vi
          .fn()
          .mockRejectedValue(new StigmerError("unavailable", "server down", 14)),
      },
    };

    renderCard(client);

    await waitFor(() =>
      expect(screen.getByText(/review it in Settings → Memory/)).toBeTruthy(),
    );
    // The fact is frozen in the tool result — it never disappears.
    expect(screen.getByText(FACT)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("surfaces a failed decision inline and keeps the actions available", async () => {
    const client = {
      memory: {
        get: vi.fn().mockResolvedValue(
          makeMemory(MemoryLifecycleState.lifecycle_state_proposed),
        ),
        confirm: vi
          .fn()
          .mockRejectedValue(new StigmerError("unavailable", "server down", 14)),
      },
    };

    renderCard(client);
    const user = userEvent.setup();
    const confirmButton = await waitForAction(`Confirm memory: ${FACT}`);

    await user.click(confirmButton);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(
      screen
        .getByRole("button", { name: `Confirm memory: ${FACT}` })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});
