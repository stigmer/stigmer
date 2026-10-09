import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerError, type Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { PersonalKeyDisclosure } from "../PersonalKeyDisclosure";

// ---------------------------------------------------------------------------
// The disclosure before a conversation's message: it names, sorted, the
// keys a run of the agent reads from the person's My vault —
// the keys the agent declares (`spec.env`), minus its servers' OAuth
// variables (their sign-in fills those), and none for an agent of another
// organization than the conversation's. Given the conversation's pinned
// version it names what that version declares (read by id and hash), the
// current spec when the agent holds no such version, and nothing while the
// version loads or cannot be read. It says nothing for an agent that
// declares no keys or cannot be read. A disclosure, so there is no control.
// ---------------------------------------------------------------------------

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
  it("names the keys the agent declares, leaving out a server's OAuth variable", async () => {
    const getByReference = agentOf(
      { LINEAR_API_KEY: {}, GITHUB_TOKEN: {}, CAL_TOKEN: {} },
      ORG,
      [{ mcpServerRef: { org: ORG, slug: "calendar" } }],
    );
    const getServer = vi.fn().mockResolvedValue({ spec: { auth: { targetEnvVar: "CAL_TOKEN" } } });
    render(<PersonalKeyDisclosure agentRef={REF} runOrg={ORG} />, {
      wrapper: wrapperFor({ getByReference, getServer }),
    });

    await waitFor(() =>
      expect(screen.getByTestId(LINE).textContent).toBe(
        "This agent can read these keys from your My vault: GITHUB_TOKEN, LINEAR_API_KEY",
      ),
    );
    expect(getByReference).toHaveBeenCalledWith({ org: ORG, slug: "pr-reviewer" });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says nothing for an agent of another organization, which reads none of the person's keys", async () => {
    const getByReference = agentOf({ GITHUB_TOKEN: {} }, "org_globex");
    render(<PersonalKeyDisclosure agentRef={{ org: "org_globex", slug: "pr-reviewer" }} runOrg={ORG} />, {
      wrapper: wrapperFor({ getByReference }),
    });

    await waitFor(() => expect(getByReference).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId(LINE)).toBeNull();
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
        "This agent can read these keys from your My vault: GITHUB_TOKEN",
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
        "This agent can read these keys from your My vault: GITHUB_TOKEN",
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

  it("says nothing for an agent that declares no keys", async () => {
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
