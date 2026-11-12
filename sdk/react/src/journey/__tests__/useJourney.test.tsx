/**
 * Pins the journey's one answer: each step done only on the server's word
 * (an agent listed; a provider serving a model; a run ever made; a journey
 * agent with a second version), in the journey's order, the first not done
 * the current one; the version read made only for journey agents, newest
 * first, stopping at the first agent changed since it was made, so a
 * plugin's or another agent's versions never tick "Make it yours"; nothing
 * read without the host's opt-in or for a person the server refuses
 * `can_create_agent`; "pending" until every read is in and "off" when one
 * fails. Whether anything ran and what serves a model are stubbed (their
 * own suites pin them); the permission, the agent list and the versions
 * are answered by a client, as the server would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { useJourney } from "../useJourney";

const state = vi.hoisted(() => ({
  ran: false as boolean | undefined,
  ranError: null as Error | null,
  served: false,
}));

vi.mock("../../dashboard/useEverRan.js", () => ({
  useEverRan: (org: string | null) => (org ? { ran: state.ran, error: state.ranError } : { ran: undefined, error: null }),
}));

vi.mock("../../models/useModelReadiness.js", () => ({
  useModelReadiness: (org: string | null) => ({
    providers: org ? (state.served ? [{ provider: "anthropic", availability: { state: "served" } }] : []) : null,
    error: null,
  }),
}));

/** One agent as the server lists it, with how many versions its history holds. */
interface Listed {
  readonly slug: string;
  readonly name: string;
  readonly versions: number;
}

let listed: Listed[] = [];
let allowed: "yes" | "no" | "asking" = "yes";

function client() {
  return {
    grant: {
      checkMyPermission: vi.fn(async (_input: { relation: string; resource?: { kind: string; id: string } }) => {
        if (allowed === "asking") return new Promise<never>(() => {});
        return { isAuthorized: allowed === "yes" };
      }),
    },
    agent: {
      list: vi.fn(async (input: { org: string }) => ({
        entries: listed.map((agent) => ({ metadata: { org: input.org, slug: agent.slug, name: agent.name } })),
        nextPageToken: "",
      })),
      listVersions: vi.fn(async (input: { slug: string }) => ({
        entries: Array.from({ length: Math.min(listed.find((agent) => agent.slug === input.slug)?.versions ?? 0, 2) }, (_, n) => ({ versionHash: `h${n}` })),
        nextPageToken: "",
      })),
    },
  };
}

function renderJourney(enabled = true, org = "org_acme") {
  const stigmer = client();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FetchCacheContext.Provider value={null}>
      <StigmerContext.Provider value={stigmer as never}>{children}</StigmerContext.Provider>
    </FetchCacheContext.Provider>
  );
  const hook = renderHook(() => useJourney(org, { enabled }), { wrapper });
  return { ...hook, stigmer };
}

beforeEach(() => {
  state.ran = false;
  state.ranError = null;
  state.served = false;
  listed = [];
  allowed = "yes";
});
afterEach(cleanup);

describe("useJourney", () => {
  it("reads nothing without the host's opt-in", () => {
    const { result, stigmer } = renderJourney(false);

    expect(result.current.status).toBe("off");
    expect(stigmer.grant.checkMyPermission).not.toHaveBeenCalled();
    expect(stigmer.agent.list).not.toHaveBeenCalled();
  });

  it("CON-01 reads no step for a person the server refuses can_create_agent", async () => {
    allowed = "no";
    const { result, stigmer } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("off"));
    expect(stigmer.grant.checkMyPermission.mock.calls[0]?.[0]).toMatchObject({
      relation: "can_create_agent",
      resource: { kind: "organization", id: "org_acme" },
    });
    expect(stigmer.agent.list).not.toHaveBeenCalled();
  });

  it("is pending while the server is asked, so nothing is drawn and taken back", () => {
    allowed = "asking";
    const { result } = renderJourney();

    expect(result.current.status).toBe("pending");
    expect(result.current.steps).toEqual([]);
  });

  it("starts a new organization on its first step, in the journey's order", async () => {
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.steps.map((step) => step.title)).toEqual([
      "Say what it should do",
      "Add a model key",
      "Watch it work",
      "Make it yours",
      "Put it in your app",
      "Bring others in",
    ]);
    expect(result.current.done).toBe(0);
    expect(result.current.current?.id).toBe("describe");
    expect(result.current.steps.map((step) => step.state)).toEqual(["current", "todo", "todo", "todo", "todo", "todo"]);
    expect(result.current.agent).toBeUndefined();
  });

  it("marks each step done on the server's word, with what happened, and names the journey's agent", async () => {
    listed = [{ slug: "variance-reporter", name: "Variance Reporter", versions: 1 }];
    state.served = true;
    state.ran = true;
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.done).toBe(3);
    expect(result.current.steps.slice(0, 3).map((step) => step.line)).toEqual([
      "Variance Reporter is made",
      "Anthropic is connected",
      "It ran and handed back its work",
    ]);
    expect(result.current.current?.id).toBe("make-yours");
    expect(result.current.agent).toEqual({ ref: { org: "org_acme", slug: "variance-reporter" }, name: "Variance Reporter" });
  });

  it("ticks Make it yours on a journey agent's second version, reading only journey agents, newest first, until one", async () => {
    listed = [
      { slug: "triage-bot", name: "Triage Bot", versions: 5 },
      { slug: "ticket-replier", name: "Ticket Replier", versions: 1 },
      { slug: "variance-reporter", name: "Variance Reporter", versions: 2 },
      { slug: "your-agent", name: "Your agent", versions: 2 },
    ];
    state.served = true;
    state.ran = true;
    const { result, stigmer } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(stigmer.agent.listVersions.mock.calls.map(([input]) => (input as { slug: string }).slug)).toEqual([
      "ticket-replier",
      "variance-reporter",
    ]);
    expect(result.current.steps[3]).toMatchObject({ state: "done", line: "Variance Reporter has your changes" });
    expect(result.current.done).toBe(4);
    expect(result.current.current?.id).toBe("in-app");
    expect(result.current.agent?.name).toBe("Variance Reporter");
  });

  it("never ticks Make it yours for an agent the journey did not make, however many versions it has", async () => {
    listed = [{ slug: "triage-bot", name: "Triage Bot", versions: 9 }];
    state.served = true;
    state.ran = true;
    const { result, stigmer } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(stigmer.agent.listVersions).not.toHaveBeenCalled();
    expect(result.current.steps[0]).toMatchObject({ state: "done", line: "Your first agent is made" });
    expect(result.current.current?.id).toBe("make-yours");
    expect(result.current.agent).toBeUndefined();
  });

  it("never marks steps 5 and 6 done: no read answers them yet", async () => {
    listed = [{ slug: "variance-reporter", name: "Variance Reporter", versions: 2 }];
    state.served = true;
    state.ran = true;
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.steps.slice(4).map((step) => step.state)).toEqual(["current", "todo"]);
  });

  it("answers off when a read fails, claiming no step it could not see", async () => {
    state.ranError = new Error("unavailable");
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("off"));
  });
});
