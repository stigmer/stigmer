/**
 * Pins the journey's one rule over one world (progress.ts, facts.ts,
 * funnel.ts, service.ts): a real SQLite store holding organizations that
 * each stop at a different step, read through the same ports the composed
 * server hands the service (the list indexes, the audit history, the
 * resource-backed grant and identity-account stores, a provider
 * availability answer).
 *
 * The organization's own read: each step ticks on its record and nothing
 * else (an agent no journey made never names a journey agent; a failed run
 * is a run but no job; a person who joined is a direct or federated account,
 * never an app user or a service account, and never the one left out); a
 * server that signs nobody in never ticks steps 5 and 6.
 *
 * The count: the window's top-level organizations only (a child, one made
 * before the window and one made after it are not counted), the
 * organizations an internal address made left out and counted apart, each
 * step's count the number of organizations whose own read has it done, and
 * no name or address in the answer.
 *
 * And the edges: a run history longer than one page is read on until a
 * completed run; a team on the access list is no teammate; a row whose
 * bytes do not decode is skipped, never fatal; a refusal the reader chose
 * passes through as itself; a window past the cap is refused with a
 * narrower one asked for.
 */
import { create, type DescMessage, type MessageShape } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { GrantSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OnboardingStepId } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/onboarding_pb";

import { parseInternalAccounts } from "../../../boot/internal-accounts.js";
import { createLogger } from "../../../boot/logger.js";
import type { ProviderAvailabilityProvider } from "../../../extensions/provider-availability.js";
import { tempStore, type TempStore } from "../../../store/sqlite/__tests__/support.js";
import { grantIdFor } from "../../grant/constants.js";
import { newAccountDisplayResolver } from "../../grant/display-resolver.js";
import { newResourceGrantStore } from "../../grant/resource-store.js";
import { orgRole, triple } from "../../grant/__tests__/support.js";
import { newResourceIdentityAccountStore } from "../../identityaccount/resource-store.js";
import { newOnboardingService, type OnboardingService } from "../service.js";
import { newOnboardingFactsReader, RUN_PAGE, type OnboardingFactsDeps } from "../facts.js";
import { countOnboardingFunnel } from "../funnel.js";
import type { Store } from "../../../store/interface.js";
import { Code, ConnectError } from "@connectrpc/connect";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const DAY = 24 * 60 * 60 * 1000;
/** The window the count is asked for: 2026-11-01 through 2026-11-07, UTC. */
const FROM = Date.UTC(2026, 10, 1);
const TO = Date.UTC(2026, 10, 7, 23, 59, 59, 999);
const IN_WINDOW = FROM + 2 * DAY;

/** The steps a read has done, by name, in the journey's order. */
function done(steps: readonly { readonly id: OnboardingStepId; readonly done: boolean }[]): string[] {
  return steps.filter((step) => step.done).map((step) => OnboardingStepId[step.id]);
}

let temp: TempStore;
let served: Map<string, "anthropic" | "openai">;

async function save<Desc extends DescMessage>(kind: ApiResourceKind, id: string, schema: Desc, msg: MessageShape<Desc>): Promise<void> {
  await temp.store.saveResource(kind, id, schema, msg);
}

function stamped(createdAtMs: number, createdBy = "") {
  return { audit: { specAudit: { createdAt: timestampFromMs(createdAtMs), createdBy: { id: createdBy } } } };
}

async function account(id: string, mode: IdentityAccountProvisioningMode, email: string, firstName = ""): Promise<void> {
  await save(
    ApiResourceKind.identity_account,
    id,
    IdentityAccountSchema,
    create(IdentityAccountSchema, { metadata: { id }, spec: { idpId: `idp|${id}`, email, firstName, provisioningMode: mode } }),
  );
}

async function organization(id: string, createdAtMs: number, createdBy: string, parentOrg = ""): Promise<void> {
  await save(
    ApiResourceKind.organization,
    id,
    OrganizationSchema,
    create(OrganizationSchema, { metadata: { id, name: id }, spec: { parentOrg }, status: stamped(createdAtMs, createdBy) }),
  );
}

async function agent(org: string, slug: string, name: string, versions = 1, createdAtMs = IN_WINDOW): Promise<void> {
  const id = `agt_${org}_${slug}`;
  const row = create(AgentSchema, { metadata: { id, org, slug, name }, status: { ...stamped(createdAtMs) } });
  await save(ApiResourceKind.agent, id, AgentSchema, row);
  for (let n = 1; n <= versions; n++) await temp.store.saveAudit(ApiResourceKind.agent, id, AgentSchema, row, `hash-${n}`, "");
}

async function run(org: string, n: number, phase: RunPhase): Promise<void> {
  const id = `run_${org}_${n}`;
  await save(ApiResourceKind.run, id, RunSchema, create(RunSchema, { metadata: { id, org }, status: { phase, ...stamped(IN_WINDOW + n) } }));
}

async function role(accountId: string, relation: string, org: string): Promise<void> {
  const spec = orgRole(accountId, relation, org);
  await newResourceGrantStore(temp.store, { keepsHistory: false }).save(create(GrantSchema, { metadata: { id: grantIdFor(spec) }, spec }));
}

function service(authenticationRequired = true): OnboardingService {
  const availability: ProviderAvailabilityProvider = {
    availability: (org, provider) =>
      Promise.resolve(served.get(org) === provider ? { state: "served", source: "organization" } : { state: "missing", scope: "organization" }),
  };
  return newOnboardingService({
    store: temp.store,
    providerAvailability: availability,
    grants: newResourceGrantStore(temp.store, { keepsHistory: false }),
    displayResolver: newAccountDisplayResolver(newResourceIdentityAccountStore(temp.store)),
    principalDisplay: undefined,
    authenticationRequired,
    internalAccounts: parseInternalAccounts("*@stigmer.ai"),
    logger: silentLogger,
  });
}

beforeEach(async () => {
  temp = tempStore();
  served = new Map();
  for (const founder of ["f0", "f1", "f2", "f3", "f4", "f5", "f6"]) {
    await account(founder, IdentityAccountProvisioningMode.direct, `${founder}@example.com`, founder.toUpperCase());
  }
  await account("sam", IdentityAccountProvisioningMode.direct, "sam@example.com", "Sam");
  await account("priya", IdentityAccountProvisioningMode.federated, "priya@acme.example", "Priya");
  await account("dana", IdentityAccountProvisioningMode.app_user, "dana@users.example", "Dana");
  await account("svc", IdentityAccountProvisioningMode.service_account, "", "Backend");
  await account("team", IdentityAccountProvisioningMode.direct, "suresh@stigmer.ai", "Team");

  // Nothing yet.
  await organization("org_0", IN_WINDOW, "f0");
  await role("f0", "owner", "org_0");
  // An agent, but not one the journey made.
  await organization("org_1", IN_WINDOW, "f1");
  await agent("org_1", "linear-helper", "Linear Helper", 3);
  // A journey agent and a key.
  await organization("org_2", IN_WINDOW, "f2");
  await agent("org_2", "variance-reporter", "Variance Reporter");
  served.set("org_2", "openai");
  // A completed job, with no key a provider report attributes; a failed run before it.
  await organization("org_3", IN_WINDOW, "f3");
  await agent("org_3", "your-agent", "Your Agent");
  await run("org_3", 1, RunPhase.RUN_FAILED);
  await run("org_3", 2, RunPhase.RUN_COMPLETED);
  // Made theirs: a second version.
  await organization("org_4", IN_WINDOW, "f4");
  await agent("org_4", "ticket-replier", "Ticket Replier", 2);
  await run("org_4", 1, RunPhase.RUN_COMPLETED);
  served.set("org_4", "anthropic");
  // In their app: an app user signed in; a service account holds a role too.
  await organization("org_5", IN_WINDOW, "f5");
  await agent("org_5", "variance-reporter", "Variance Reporter", 2);
  await run("org_5", 1, RunPhase.RUN_COMPLETED);
  await role("f5", "owner", "org_5");
  await role("dana", "member", "org_5");
  await role("svc", "admin", "org_5");
  // Others in: two teammates beside the founder.
  await organization("org_6", IN_WINDOW, "f6");
  await agent("org_6", "contract-reviewer", "Contract Reviewer", 2);
  await run("org_6", 1, RunPhase.RUN_COMPLETED);
  await role("f6", "owner", "org_6");
  await role("dana", "member", "org_6");
  await role("sam", "member", "org_6");
  await role("priya", "admin", "org_6");

  // Not counted: the team's own, a child, one before the window, one after it.
  await organization("org_team", IN_WINDOW, "team");
  await agent("org_team", "variance-reporter", "Variance Reporter");
  await organization("org_child", IN_WINDOW, "f6", "org_6");
  await organization("org_before", FROM - DAY, "f1");
  // An organization row with no creation stamp is in no window.
  await save(ApiResourceKind.organization, "org_unstamped", OrganizationSchema, create(OrganizationSchema, { metadata: { id: "org_unstamped" } }));
  await organization("org_after", TO + DAY, "f1");
});

afterEach(async () => {
  await temp.cleanup();
});

describe("an organization's own read", () => {
  it("ticks each step on its record and nothing else", async () => {
    const onboarding = service();
    // Each asked by its founder, as the card asks for the person looking at it.
    const answers = await Promise.all([0, 1, 2, 3, 4, 5, 6].map((n) => onboarding.progress(`org_${n}`, `f${n}`)));
    expect(answers.map((answer) => answer.steps.map((step) => OnboardingStepId[step.id]))).toEqual(
      Array(7).fill(["describe", "key", "watch", "make_yours", "in_app", "others"]),
    );
    expect(answers.map((answer) => done(answer.steps))).toEqual([
      [],
      ["describe"],
      ["describe", "key"],
      ["describe", "key", "watch"],
      ["describe", "key", "watch", "make_yours"],
      ["describe", "key", "watch", "make_yours", "in_app"],
      ["describe", "key", "watch", "make_yours", "in_app", "others"],
    ]);
  });

  it("names the facts a client's lines use", async () => {
    const onboarding = service();
    const none = await onboarding.progress("org_1", "");
    expect([none.newestAgent, none.changedAgent, none.servedProvider, none.everRan]).toEqual([undefined, undefined, "", false]);
    const failedThenDone = await onboarding.progress("org_3", "");
    expect([failedThenDone.newestAgent?.name, failedThenDone.changedAgent, failedThenDone.everRan]).toEqual(["Your Agent", undefined, true]);
    const changed = await onboarding.progress("org_4", "");
    expect([changed.changedAgent?.slug, changed.changedAgent?.org, changed.servedProvider]).toEqual(["ticket-replier", "org_4", "anthropic"]);
  });

  it("counts people, never app users or service accounts, and leaves out the one asking", async () => {
    const onboarding = service();
    const asFounder = await onboarding.progress("org_6", "f6");
    expect([asFounder.appUserName, [...asFounder.joinedNames].sort(), asFounder.joinedCount]).toEqual(["Dana", ["Priya", "Sam"], 2]);
    const asSam = await onboarding.progress("org_6", "sam");
    expect([[...asSam.joinedNames].sort(), asSam.joinedCount]).toEqual([["F6", "Priya"], 2]);
    // org_5's only people are its founder; an app user and a service account are not teammates.
    const alone = await onboarding.progress("org_5", "f5");
    expect([alone.appUserName, alone.joinedCount, done(alone.steps).includes("others")]).toEqual(["Dana", 0, false]);
  });

  it("never ticks steps 5 and 6 on a server that signs nobody in", async () => {
    const answer = await service(false).progress("org_6", "f6");
    expect(done(answer.steps)).toEqual(["describe", "key", "watch", "make_yours"]);
    expect([answer.appUserName, answer.joinedCount]).toEqual(["", 0]);
  });

  it("answers a failed read as an error, never a step it could not see", async () => {
    const onboarding = newOnboardingService({
      store: temp.store,
      providerAvailability: { availability: () => Promise.reject(new Error("keys unreadable")) },
      grants: newResourceGrantStore(temp.store, { keepsHistory: false }),
      displayResolver: newAccountDisplayResolver(newResourceIdentityAccountStore(temp.store)),
      principalDisplay: undefined,
      authenticationRequired: true,
      internalAccounts: parseInternalAccounts(""),
      logger: silentLogger,
    });
    await expect(onboarding.progress("org_2", "")).rejects.toThrow("failed to read onboarding");
  });
});

describe("the count", () => {
  it("counts the window's new top-level organizations at each step, the team's own apart", async () => {
    const funnel = await service().funnel({ fromMs: FROM, toMs: TO });
    expect([funnel.organizations, funnel.excluded]).toEqual([7, 1]);
    expect(funnel.steps.map((step) => [OnboardingStepId[step.id], step.reached])).toEqual([
      ["describe", 6],
      ["key", 5],
      ["watch", 4],
      ["make_yours", 3],
      ["in_app", 2],
      // org_5's founder is its only person; org_6's founder is left out and two others joined.
      ["others", 1],
    ]);
  });

  it("carries counts only", async () => {
    const funnel = await service().funnel({ fromMs: FROM, toMs: TO });
    const text = JSON.stringify(funnel);
    for (const word of ["org_", "Sam", "Dana", "example", "stigmer.ai", "Variance"]) expect(text).not.toContain(word);
  });

  it("counts an empty window as nobody", async () => {
    const funnel = await service().funnel({ fromMs: TO + 10 * DAY, toMs: TO + 11 * DAY });
    expect([funnel.organizations, funnel.excluded, funnel.steps.map((step) => step.reached)]).toEqual([0, 0, [0, 0, 0, 0, 0, 0]]);
  });
});

/** The facts reader's ports over the world, with one undecodable row added to every indexed read. */
function withCorruptRows(): OnboardingFactsDeps["store"] & Pick<Store, "queryResources"> {
  const corrupt = { id: "corrupt", data: new Uint8Array([0xff, 0xff, 0xff]), cursor: { createdAt: "0", id: "corrupt" } };
  return {
    queryResources: (async (declaration, query) => [...(await temp.store.queryResources(declaration, query)), corrupt]) as Store["queryResources"],
    countAuditEntries: (kind, id) => temp.store.countAuditEntries(kind, id),
    getResource: ((kind, id, schema) => temp.store.getResource(kind, id, schema)) as Store["getResource"],
  };
}

function factsDeps(store: OnboardingFactsDeps["store"]): OnboardingFactsDeps {
  return {
    store,
    providerAvailability: { availability: () => Promise.resolve({ state: "missing", scope: "organization" }) },
    grants: newResourceGrantStore(temp.store, { keepsHistory: false }),
    displayResolver: newAccountDisplayResolver(newResourceIdentityAccountStore(temp.store)),
    principalDisplay: undefined,
    authenticationRequired: true,
    logger: silentLogger,
  };
}

describe("the edges", () => {
  it("reads a run history past one page until a completed run", async () => {
    await organization("org_paged", IN_WINDOW, "f0");
    await run("org_paged", 0, RunPhase.RUN_COMPLETED);
    for (let n = 1; n <= RUN_PAGE; n++) await run("org_paged", n, RunPhase.RUN_FAILED);
    const answer = await service().progress("org_paged", "f0");
    expect([done(answer.steps), answer.everRan]).toEqual([["key", "watch"], true]);
  });

  it("counts no team as a teammate", async () => {
    const spec = triple({ kind: "team", id: "tm_ops", relation: "member" }, "member", { kind: "organization", id: "org_5" });
    await newResourceGrantStore(temp.store, { keepsHistory: false }).save(create(GrantSchema, { metadata: { id: grantIdFor(spec) }, spec }));
    const answer = await service().progress("org_5", "f5");
    expect(answer.joinedCount).toBe(0);
  });

  it("skips a row whose bytes do not decode, and still reads the rest", async () => {
    const facts = await newOnboardingFactsReader(factsDeps(withCorruptRows())).read("org_4", "f4");
    expect([facts.changedAgent?.slug, facts.completedRun]).toEqual(["ticket-replier", true]);
    const funnel = await countOnboardingFunnel(
      {
        store: withCorruptRows(),
        facts: newOnboardingFactsReader(factsDeps(temp.store)),
        displayResolver: newAccountDisplayResolver(newResourceIdentityAccountStore(temp.store)),
        internalAccounts: parseInternalAccounts("*@stigmer.ai"),
        logger: silentLogger,
      },
      { fromMs: FROM, toMs: TO },
    );
    expect([funnel.organizations, funnel.excluded]).toEqual([7, 1]);
  });

  it("passes a refusal the reader chose through as itself", async () => {
    const onboarding = newOnboardingService({
      ...factsDeps(temp.store),
      providerAvailability: { availability: () => Promise.reject(new ConnectError("keys are resting", Code.Unavailable)) },
      internalAccounts: parseInternalAccounts(""),
    });
    await expect(onboarding.progress("org_2", "")).rejects.toMatchObject({ code: Code.Unavailable, rawMessage: "keys are resting" });
  });

  it("refuses a window past the cap, asking for a narrower one", async () => {
    const counting = countOnboardingFunnel(
      {
        store: temp.store,
        facts: newOnboardingFactsReader(factsDeps(temp.store)),
        displayResolver: newAccountDisplayResolver(newResourceIdentityAccountStore(temp.store)),
        internalAccounts: parseInternalAccounts(""),
        logger: silentLogger,
        cap: 2,
      },
      { fromMs: FROM, toMs: TO },
    );
    await expect(counting).rejects.toMatchObject({
      code: Code.InvalidArgument,
      rawMessage: "this window holds more than 2 new organizations, more than one count reads; ask for a narrower window",
    });
  });
});
