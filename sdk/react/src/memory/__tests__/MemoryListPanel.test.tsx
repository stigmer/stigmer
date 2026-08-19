import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { MemorySchema, type Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import { MemoryListSchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { MemoryListPanel } from "../MemoryListPanel";

function Providers({
  client,
  children,
}: {
  client: unknown;
  children: ReactNode;
}) {
  return (
    <FetchCacheContext.Provider value={null}>
      <StigmerContext.Provider value={client as never}>
        {children}
      </StigmerContext.Provider>
    </FetchCacheContext.Provider>
  );
}

function makeMemory(
  id: string,
  state: MemoryLifecycleState,
  content: string,
  provenance?: { agentId: string; sessionId: string },
): Memory {
  return create(MemorySchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Memory",
    metadata: { id, name: id, slug: id, org: "test-org" },
    spec: { content, provenance },
    status: { lifecycleState: state },
  });
}

const PROPOSED = makeMemory(
  "mem_proposed",
  MemoryLifecycleState.lifecycle_state_proposed,
  "Prefers terse answers.",
  { agentId: "agt_1", sessionId: "ses_1" },
);
const CONFIRMED = makeMemory(
  "mem_confirmed",
  MemoryLifecycleState.lifecycle_state_confirmed,
  "Deploys to us-east-1.",
);
const REJECTED = makeMemory(
  "mem_rejected",
  MemoryLifecycleState.lifecycle_state_rejected,
  "Not actually true.",
);

function makeClient(memories: Memory[] = [PROPOSED, CONFIRMED, REJECTED]) {
  return {
    memory: {
      list: vi
        .fn()
        .mockResolvedValue(
          create(MemoryListSchema, { totalCount: memories.length, items: memories }),
        ),
      confirm: vi.fn().mockResolvedValue(CONFIRMED),
      reject: vi.fn().mockResolvedValue(REJECTED),
      delete: vi.fn().mockResolvedValue(PROPOSED),
      update: vi.fn().mockResolvedValue(CONFIRMED),
    },
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("MemoryListPanel", () => {
  it("groups pending proposals first, then remembered, then rejected", async () => {
    const client = makeClient();
    render(
      <Providers client={client}>
        <MemoryListPanel org="test-org" />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Prefers terse answers.")).toBeTruthy(),
    );

    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "Pending proposals",
      "Remembered",
      "Rejected",
    ]);
  });

  it("shows the stored text verbatim with its provenance", async () => {
    const client = makeClient([PROPOSED]);
    render(
      <Providers client={client}>
        <MemoryListPanel org="test-org" />
      </Providers>,
    );

    // The review surface never paraphrases: what is confirmed is what
    // future prompts inject, byte for byte (DD-005 D6).
    await waitFor(() =>
      expect(screen.getByText("Prefers terse answers.")).toBeTruthy(),
    );
    expect(
      screen.getByText(/Proposed by agent agt_1 in session ses_1/),
    ).toBeTruthy();
  });

  it("confirms a proposal and refetches", async () => {
    const client = makeClient([PROPOSED]);
    const user = userEvent.setup();
    render(
      <Providers client={client}>
        <MemoryListPanel org="test-org" />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Prefers terse answers.")).toBeTruthy(),
    );
    await user.click(
      screen.getByRole("button", { name: /Confirm memory: Prefers terse answers./ }),
    );

    await waitFor(() => expect(client.memory.confirm).toHaveBeenCalledWith("mem_proposed"));
    await waitFor(() => expect(client.memory.list).toHaveBeenCalledTimes(2));
  });

  it("rejects with a single click — no confirmation dialog", async () => {
    const client = makeClient([PROPOSED]);
    const user = userEvent.setup();
    render(
      <Providers client={client}>
        <MemoryListPanel org="test-org" />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Prefers terse answers.")).toBeTruthy(),
    );
    await user.click(
      screen.getByRole("button", { name: /Reject memory: Prefers terse answers./ }),
    );

    // One click, straight to the RPC (DD-005 D4): expensive review
    // teaches users to ignore the queue.
    await waitFor(() => expect(client.memory.reject).toHaveBeenCalledWith("mem_proposed"));
  });

  it("requires inline confirmation before deleting", async () => {
    const client = makeClient([CONFIRMED]);
    const user = userEvent.setup();
    render(
      <Providers client={client}>
        <MemoryListPanel org="test-org" />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Deploys to us-east-1.")).toBeTruthy(),
    );
    await user.click(
      screen.getByRole("button", { name: /Delete memory: Deploys to us-east-1./ }),
    );

    // Nothing deleted yet — the row transformed into the inline confirm.
    expect(client.memory.delete).not.toHaveBeenCalled();
    expect(screen.getByText(/Forget this permanently\?/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(client.memory.delete).toHaveBeenCalledWith("mem_confirmed"),
    );
  });

  it("edits a confirmed fact through the wipe-safe update mapper", async () => {
    const client = makeClient([CONFIRMED]);
    const user = userEvent.setup();
    render(
      <Providers client={client}>
        <MemoryListPanel org="test-org" />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Deploys to us-east-1.")).toBeTruthy(),
    );
    await user.click(
      screen.getByRole("button", { name: /Edit memory: Deploys to us-east-1./ }),
    );

    const textarea = screen.getByRole("textbox", { name: "Edit memory text" });
    expect((textarea as HTMLTextAreaElement).value).toBe("Deploys to us-east-1.");

    await user.clear(textarea);
    await user.type(textarea, "Deploys to eu-west-1.");
    await user.click(screen.getByRole("button", { name: "Save memory text" }));

    await waitFor(() =>
      expect(client.memory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "mem_confirmed",
          org: "test-org",
          content: "Deploys to eu-west-1.",
        }),
      ),
    );
  });

  it("offers no edit action on proposals — decide first, then edit", async () => {
    const client = makeClient([PROPOSED]);
    render(
      <Providers client={client}>
        <MemoryListPanel org="test-org" />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText("Prefers terse answers.")).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: /Edit memory/ })).toBeNull();
  });

  it("renders the empty state when nothing is remembered", async () => {
    const client = makeClient([]);
    render(
      <Providers client={client}>
        <MemoryListPanel org="test-org" />
      </Providers>,
    );

    await waitFor(() =>
      expect(screen.getByText(/Nothing remembered yet/)).toBeTruthy(),
    );
  });

  it("surfaces list errors as an alert", async () => {
    const client = {
      memory: { list: vi.fn().mockRejectedValue(new Error("boom")) },
    };
    render(
      <Providers client={client}>
        <MemoryListPanel org="test-org" />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });
});
