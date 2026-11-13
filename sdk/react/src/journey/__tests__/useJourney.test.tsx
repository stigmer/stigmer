/**
 * Pins the journey's one answer: each step done only on the server's word
 * (an agent listed; a provider serving a model, or a run that completed; a
 * run that completed, never one that failed; a journey agent with a second
 * version; a person signed in from the builder's own app, an app user on
 * the organization's access list, on a server that signs people in), in
 * the journey's order, the first not done
 * the current one; the version read made only for journey agents, newest
 * first, stopping at the first agent changed since it was made, so a
 * plugin's or another agent's versions never tick "Make it yours"; nothing
 * read without the host's opt-in or for a person the server refuses
 * `can_edit` (the organization's admins; a member gets no journey); "pending" until every read is in and "off" when one
 * fails; and whether anything ran at all, failed runs included, for a
 * surface's layout. Step 5's read is a lower bar: on a server that trusts
 * every caller it is not made, and refused or failed it leaves the step open
 * and every other step drawn. Step 6 reads the same list: done when a
 * person who signed in to Stigmer itself (a direct or federated account),
 * other than the viewer, is on it, named ("Sam joined", "Sam and 2 others
 * joined"); app users, service accounts and unresolved entries never count,
 * and it keeps step 5's rules: never on a trusting server, open when a read
 * is refused or fails. The run summary and what serves a model are
 * stubbed (their own suites pin them); the permission, the server's posture,
 * the access list, the agent list and the versions are answered by a client,
 * as the server would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { useJourney } from "../useJourney";

const state = vi.hoisted(() => ({
  ran: false as boolean | undefined,
  failed: 0,
  ranError: null as Error | null,
  served: false,
}));

vi.mock("../../dashboard/useRunSummary.js", () => ({
  RunSummaryTimeWindow: { ALL_TIME: 4 },
  // The all-time summary: `ran` completed runs, `failed` failed ones (phases 3 and 4).
  useRunSummary: (options: { org: string | null }) => ({
    summary: options.org && state.ran !== undefined ? { activeCount: 0, phaseCounts: { 3: state.ran ? 1 : 0, 4: state.failed } } : null,
    error: options.org ? state.ranError : null,
  }),
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
/** Whether the viewer may read the access list (`can_view_access`). */
let viewAccess = true;
/** Whether the server signs its callers in. */
let signsIn = true;
/** The organization's access list: people, service accounts and app users. */
let access: { kind: string; id: string; name: string; mode: number }[] = [];
let accessError: Error | null = null;
/** The viewer's own account id, as whoAmI answers it; null makes whoAmI fail. */
let me: string | null = "ida_owner";

const APP_USER = IdentityAccountProvisioningMode.app_user;
const SERVICE_ACCOUNT = IdentityAccountProvisioningMode.service_account;
const PERSON = IdentityAccountProvisioningMode.direct;
const FEDERATED = IdentityAccountProvisioningMode.federated;
const UNRESOLVED = IdentityAccountProvisioningMode.identity_account_provisioning_mode_unspecified;

function client() {
  return {
    grant: {
      checkMyPermission: vi.fn(async (input: { relation: string; resource?: { kind: string; id: string } }) => {
        if (input.relation === "can_view_access") return { isAuthorized: viewAccess };
        if (allowed === "asking") return new Promise<never>(() => {});
        return { isAuthorized: allowed === "yes" };
      }),
      listResourceAccessByPrincipal: vi.fn(async () => {
        if (accessError) throw accessError;
        return {
          entries: access.map((entry) => ({
            principal: { kind: "identity_account", id: entry.id, name: entry.name, email: "", identityOrigin: { provisioningMode: entry.mode } },
            roles: [],
          })),
        };
      }),
    },
    platform: {
      getServerInfo: vi.fn(async () => ({ authenticationRequired: signsIn, version: "0.1.3" })),
    },
    identityAccount: {
      whoAmI: vi.fn(async () => {
        if (me === null) throw new Error("unavailable");
        return { metadata: { id: me } };
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
  state.failed = 0;
  state.ranError = null;
  state.served = false;
  listed = [];
  allowed = "yes";
  viewAccess = true;
  signsIn = true;
  access = [];
  accessError = null;
  me = "ida_owner";
});
afterEach(cleanup);

describe("useJourney", () => {
  it("reads nothing without the host's opt-in", () => {
    const { result, stigmer } = renderJourney(false);

    expect(result.current.status).toBe("off");
    expect(stigmer.grant.checkMyPermission).not.toHaveBeenCalled();
    expect(stigmer.agent.list).not.toHaveBeenCalled();
  });

  it("CON-01 reads no step for a person who is no admin of the organization (can_edit), a member who may make agents included", async () => {
    allowed = "no";
    const { result, stigmer } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("off"));
    expect(stigmer.grant.checkMyPermission.mock.calls[0]?.[0]).toMatchObject({
      relation: "can_edit",
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
      "It ran its first job",
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

  it("counts the key step done once something has run, though no provider reads as serving (a key in the runners' environment)", async () => {
    listed = [{ slug: "variance-reporter", name: "Variance Reporter", versions: 1 }];
    state.ran = true;
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.steps[1]).toMatchObject({ state: "done", line: "A model answered its first job" });
    expect(result.current.current?.id).toBe("make-yours");
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

  it("leaves Put it in your app open while nobody has signed in from the builder's app, people and service accounts not counted", async () => {
    listed = [{ slug: "variance-reporter", name: "Variance Reporter", versions: 2 }];
    state.served = true;
    state.ran = true;
    access = [
      { kind: "identity_account", id: "ida_owner", name: "Suresh", mode: PERSON },
      { kind: "identity_account", id: "ida_backend", name: "app-backend", mode: SERVICE_ACCOUNT },
    ];
    const { result, stigmer } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.steps.slice(4).map((step) => step.state)).toEqual(["current", "todo"]);
    expect(result.current.steps[4]?.line).toBe("Give your users the chat, from the agent's In your app tab.");
    expect(stigmer.grant.checkMyPermission.mock.calls.map((call) => call[0].relation)).toContain("can_view_access");
  });

  it("ticks Put it in your app on the first person signed in from the builder's app, by name; Bring others in stays open", async () => {
    listed = [{ slug: "variance-reporter", name: "Variance Reporter", versions: 2 }];
    state.served = true;
    state.ran = true;
    access = [
      { kind: "identity_account", id: "ida_owner", name: "Suresh", mode: PERSON },
      { kind: "identity_account", id: "ida_dana", name: "Dana Lee", mode: APP_USER },
    ];
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.steps[4]).toMatchObject({ state: "done", line: "Dana Lee signed in from your app" });
    expect(result.current.steps[5]?.state).toBe("current");
    expect(result.current.done).toBe(5);
  });

  it("never reads the access list on a server that trusts every caller: nobody signs in there", async () => {
    signsIn = false;
    access = [{ kind: "identity_account", id: "ida_dana", name: "Dana Lee", mode: APP_USER }];
    const { result, stigmer } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.steps[4]?.state).not.toBe("done");
    expect(stigmer.grant.listResourceAccessByPrincipal).not.toHaveBeenCalled();
  });

  it("CON-01 leaves Put it in your app open without can_view_access, reading no list and drawing every other step", async () => {
    viewAccess = false;
    listed = [{ slug: "variance-reporter", name: "Variance Reporter", versions: 1 }];
    access = [{ kind: "identity_account", id: "ida_dana", name: "Dana Lee", mode: APP_USER }];
    const { result, stigmer } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.steps[0]?.state).toBe("done");
    expect(result.current.steps[4]?.state).toBe("todo");
    expect(stigmer.grant.listResourceAccessByPrincipal).not.toHaveBeenCalled();
  });

  it("a failed access read leaves Put it in your app open and the journey drawn, never off", async () => {
    accessError = new Error("unavailable");
    listed = [{ slug: "variance-reporter", name: "Variance Reporter", versions: 1 }];
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.steps[0]?.state).toBe("done");
    expect(result.current.steps[4]?.state).toBe("todo");
  });

  it("ticks Bring others in once someone besides the viewer has joined, by name", async () => {
    access = [
      { kind: "identity_account", id: "ida_owner", name: "Dana Lee", mode: PERSON },
      { kind: "identity_account", id: "ida_sam", name: "Sam Ortiz", mode: PERSON },
    ];
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.steps[5]).toMatchObject({ state: "done", line: "Sam Ortiz joined" });
  });

  it("names two who joined, then the first and how many others", async () => {
    access = [
      { kind: "identity_account", id: "ida_owner", name: "Dana Lee", mode: PERSON },
      { kind: "identity_account", id: "ida_sam", name: "Sam", mode: PERSON },
      { kind: "identity_account", id: "ida_priya", name: "Priya", mode: FEDERATED },
    ];
    const two = renderJourney();
    await waitFor(() => expect(two.result.current.status).toBe("ready"));
    expect(two.result.current.steps[5]?.line).toBe("Sam and Priya joined");
    cleanup();

    access = [...access, { kind: "identity_account", id: "ida_lee", name: "Lee", mode: PERSON }];
    const three = renderJourney();
    await waitFor(() => expect(three.result.current.status).toBe("ready"));
    expect(three.result.current.steps[5]?.line).toBe("Sam and 2 others joined");
  });

  it("leaves Bring others in open with only the viewer, app users, service accounts and unresolved entries on the list", async () => {
    access = [
      { kind: "identity_account", id: "ida_owner", name: "Dana Lee", mode: PERSON },
      { kind: "identity_account", id: "ida_user", name: "A customer", mode: APP_USER },
      { kind: "identity_account", id: "ida_backend", name: "app-backend", mode: SERVICE_ACCOUNT },
      { kind: "identity_account", id: "ida_gone", name: "", mode: UNRESOLVED },
    ];
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.steps[5]).toMatchObject({ state: "todo", line: "Name your organization and invite your team." });
  });

  it("never ticks Bring others in on a server that trusts every caller, nor asks who the viewer is", async () => {
    signsIn = false;
    access = [{ kind: "identity_account", id: "ida_sam", name: "Sam", mode: PERSON }];
    const { result, stigmer } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.steps[5]?.state).not.toBe("done");
    expect(stigmer.identityAccount.whoAmI).not.toHaveBeenCalled();
  });

  it("leaves Bring others in open, the journey drawn, when the access read fails or the viewer cannot be read", async () => {
    accessError = new Error("unavailable");
    access = [{ kind: "identity_account", id: "ida_sam", name: "Sam", mode: PERSON }];
    const failedList = renderJourney();
    await waitFor(() => expect(failedList.result.current.status).toBe("ready"));
    expect(failedList.result.current.steps[5]?.state).not.toBe("done");
    cleanup();

    accessError = null;
    me = null;
    const failedMe = renderJourney();
    await waitFor(() => expect(failedMe.result.current.status).toBe("ready"));
    expect(failedMe.result.current.steps[5]?.state).not.toBe("done");
  });

  it("counts a run that failed as no job done: the key and watch steps stay open, though something ran", async () => {
    listed = [{ slug: "variance-reporter", name: "Variance Reporter", versions: 1 }];
    state.failed = 2;
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.steps.map((step) => step.state).slice(0, 3)).toEqual(["done", "current", "todo"]);
    expect(result.current.everRan).toBe(true);
  });

  it("answers off when a read fails, claiming no step it could not see", async () => {
    state.ranError = new Error("unavailable");
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("off"));
  });
});
