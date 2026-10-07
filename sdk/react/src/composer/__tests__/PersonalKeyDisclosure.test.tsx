/**
 * The disclosure before a conversation's message: it names, sorted, the
 * keys a run of the agent takes from the person's own credentials (each
 * requirement of the agent or its MCP servers that the person's
 * credential serving the declarer holds). Given the conversation's pinned
 * version it reads what that version declares (by id and hash), the
 * current spec when the agent holds no such version, and nothing while
 * the version loads or cannot be read. It says nothing for an agent that
 * takes none of the person's keys or cannot be read. A disclosure, so
 * there is no control.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerError, type Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { storedCredential } from "../../credential/__tests__/credential-world";
import { PersonalKeyDisclosure } from "../PersonalKeyDisclosure";

afterEach(cleanup);

const ORG = "org_acme";
const REF = { org: ORG, slug: "pr-reviewer" };

interface Fakes {
  readonly getByReference: ReturnType<typeof vi.fn>;
  readonly getVersion?: ReturnType<typeof vi.fn>;
  readonly getServer?: ReturnType<typeof vi.fn>;
}

function wrapperFor(fakes: Fakes) {
  const client = {
    agent: {
      getByReference: fakes.getByReference,
      getVersion: fakes.getVersion ?? vi.fn(),
    },
    mcpServer: { getByReference: fakes.getServer ?? vi.fn() },
    // The person's own credential serving the agent holds every key the
    // tests' agents declare; one serving the calendar server holds its key.
    credential: {
      list: vi.fn().mockResolvedValue({
        items: [
          storedCredential({
            id: "mine",
            org: ORG,
            owner: "person",
            fields: ["GITHUB_TOKEN", "LINEAR_API_KEY", "SLACK_TOKEN"],
            serves: [{ kind: "agent", org: ORG, slug: "pr-reviewer" }],
          }),
          storedCredential({
            id: "mine-cal",
            org: ORG,
            owner: "person",
            fields: ["CAL_TOKEN"],
            serves: [{ kind: "mcp_server", org: ORG, slug: "calendar" }],
          }),
        ],
        totalCount: 2,
      }),
    },
  } as unknown as Stigmer;
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

function agentOf(env: Record<string, object>, org = ORG, mcpServerUsages: object[] = []) {
  return vi.fn().mockResolvedValue({
    metadata: { id: "agt_1", org, slug: "pr-reviewer" },
    spec: { env, mcpServerUsages },
  });
}

const LINE = "personal-key-disclosure";

describe("PersonalKeyDisclosure", () => {
  it("names the person's keys the run takes, the agent's own and its servers', and none of the organization's", async () => {
    const getByReference = agentOf(
      { LINEAR_API_KEY: {}, GITHUB_TOKEN: {}, ORG_ONLY: {} },
      ORG,
      [{ mcpServerRef: { org: ORG, slug: "calendar" } }],
    );
    const getServer = vi.fn().mockResolvedValue({
      metadata: { id: "mcp_calendar", org: ORG, slug: "calendar" },
      spec: { env: { CAL_TOKEN: {} } },
    });
    render(<PersonalKeyDisclosure agentRef={REF} runOrg={ORG} />, {
      wrapper: wrapperFor({ getByReference, getServer }),
    });

    await waitFor(() =>
      expect(screen.getByTestId(LINE).textContent).toBe(
        "This agent's runs use these keys of yours: CAL_TOKEN, GITHUB_TOKEN, LINEAR_API_KEY",
      ),
    );
    expect(getByReference).toHaveBeenCalledWith({ org: ORG, slug: "pr-reviewer" });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names what the pinned version declares, not the agent's current spec", async () => {
    const getByReference = agentOf({ GITHUB_TOKEN: {}, SLACK_TOKEN: {} });
    const getVersion = vi.fn().mockResolvedValue({
      versionHash: "h_old",
      specSnapshot: { env: { GITHUB_TOKEN: {} } },
    });
    render(<PersonalKeyDisclosure agentRef={REF} runOrg={ORG} versionHash="h_old" />, {
      wrapper: wrapperFor({ getByReference, getVersion }),
    });

    await waitFor(() =>
      expect(screen.getByTestId(LINE).textContent).toBe(
        "This agent's runs use these keys of yours: GITHUB_TOKEN",
      ),
    );
    expect(getVersion).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agt_1", versionHash: "h_old" }),
    );
  });

  it("names the current spec's keys when the agent holds no such version", async () => {
    const getByReference = agentOf({ GITHUB_TOKEN: {} });
    const getVersion = vi
      .fn()
      .mockRejectedValue(new StigmerError("not-found", "no such version", 5));
    render(<PersonalKeyDisclosure agentRef={REF} runOrg={ORG} versionHash="h_unrecorded" />, {
      wrapper: wrapperFor({ getByReference, getVersion }),
    });

    await waitFor(() =>
      expect(screen.getByTestId(LINE).textContent).toBe(
        "This agent's runs use these keys of yours: GITHUB_TOKEN",
      ),
    );
  });

  it("says nothing while the pinned version loads, or when it cannot be read", async () => {
    const getByReference = agentOf({ GITHUB_TOKEN: {} });
    const pending = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<PersonalKeyDisclosure agentRef={REF} runOrg={ORG} versionHash="h_old" />, {
      wrapper: wrapperFor({ getByReference, getVersion: pending }),
    });
    await waitFor(() => expect(pending).toHaveBeenCalled());
    expect(screen.queryByTestId(LINE)).toBeNull();
    cleanup();

    const failing = vi.fn().mockRejectedValue(new StigmerError("permission-denied", "denied", 7));
    render(<PersonalKeyDisclosure agentRef={REF} runOrg={ORG} versionHash="h_old" />, {
      wrapper: wrapperFor({ getByReference, getVersion: failing }),
    });
    await waitFor(() => expect(failing).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId(LINE)).toBeNull();
  });

  it("reads no version for a conversation not yet started", async () => {
    const getByReference = agentOf({ GITHUB_TOKEN: {} });
    const getVersion = vi.fn();
    render(<PersonalKeyDisclosure agentRef={REF} runOrg={ORG} />, {
      wrapper: wrapperFor({ getByReference, getVersion }),
    });

    await waitFor(() => expect(screen.getByTestId(LINE)).toBeTruthy());
    expect(getVersion).not.toHaveBeenCalled();
  });

  it("says nothing for an agent that takes none of the person's keys", async () => {
    const getByReference = agentOf({});
    render(<PersonalKeyDisclosure agentRef={REF} runOrg={ORG} />, {
      wrapper: wrapperFor({ getByReference }),
    });

    await waitFor(() => expect(getByReference).toHaveBeenCalled());
    expect(screen.queryByTestId(LINE)).toBeNull();
  });

  it("says nothing when the agent cannot be read", async () => {
    const getByReference = vi.fn().mockRejectedValue(new Error("denied"));
    render(<PersonalKeyDisclosure agentRef={REF} runOrg={ORG} />, {
      wrapper: wrapperFor({ getByReference }),
    });

    await waitFor(() => expect(getByReference).toHaveBeenCalled());
    expect(screen.queryByTestId(LINE)).toBeNull();
  });
});
