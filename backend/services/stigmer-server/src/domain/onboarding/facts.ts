/**
 * Reads what one organization's records say about the journey from a first
 * agent to its users (progress.ts names the six steps), with no caller: the
 * per-organization read asks it for the person asking, and the operator's
 * count asks it for every new organization.
 *
 * Every fact comes through a port the composition already holds, so every
 * edition answers it over its own drivers:
 *
 *   - agents: the agent list index, one organization's newest first, one
 *     page of {@link AGENT_PAGE} (a new organization's whole list); the
 *     journey's agents are named by `@stigmer/examples/journey`, the rule
 *     the React kit makes them under, so an agent a plugin installed (which
 *     gains versions when the plugin upgrades) never counts;
 *   - a second version: the agent's audit history, counted, read only for
 *     the journey's agents, newest first, stopping at the first with two;
 *   - runs: the run list index, newest first, a page at a time, stopping at
 *     the first completed run. Read directly, not through the run summary,
 *     which narrows the rows to what a caller may read;
 *   - the provider: the composed availability provider (the one the run
 *     create chain refuses by), each provider in the server's order;
 *   - people: the organization's own access list, the one the members page
 *     and the React kit read (domain/grant/access-lists.ts), classed by the
 *     account's provisioning mode exactly as the SDK classes an entry
 *     (sdk/typescript/src/iam-principal.ts): `app_user` is an app user,
 *     `direct` or `federated` a person. Read only on a server that signs
 *     people in: on one that trusts every caller, nobody signs in.
 *
 * A failed read rejects: the caller answers an error rather than a step it
 * could not see.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceRefView } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { isJourneyAgentSlug } from "@stigmer/examples/journey";

import type { Logger } from "../../boot/logger.js";
import type { PrincipalDisplay } from "../../extensions/principal-display.js";
import type { ProviderAvailabilityProvider } from "../../extensions/provider-availability.js";
import { MODEL_PROVIDERS } from "../../modelcatalog/provider-need.js";
import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import type { Store } from "../../store/interface.js";
import type { ListIndexCursor } from "../../store/list-index.js";
import { agentListIndex } from "../agent/list-index.js";
import { buildPrincipalAccessList, type PrincipalDisplayResolver } from "../grant/access-lists.js";
import type { GrantStore } from "../grant/store.js";
import { agentExecutionListIndex } from "../run/list-index.js";
import type { OnboardingAgentFact, OnboardingFacts } from "./progress.js";

/** How many agents the read takes: one page, a new organization's whole list, as the kit read it. */
export const AGENT_PAGE = 50;

/** How many runs each read of the run index takes while looking for a completed one. */
const RUN_PAGE = 200;

/** The access list's person kind. */
const ACCOUNT_KIND = kindEnumName(ApiResourceKind.identity_account);

/** What the reader reads through. */
export interface OnboardingFactsDeps {
  readonly store: Pick<Store, "queryResources" | "countAuditEntries" | "getResource">;
  readonly providerAvailability: ProviderAvailabilityProvider;
  readonly grants: GrantStore;
  readonly displayResolver: PrincipalDisplayResolver;
  readonly principalDisplay: PrincipalDisplay | undefined;
  /** Whether this server signs people in; on one that trusts every caller, steps 5 and 6 never tick. */
  readonly authenticationRequired: boolean;
  readonly logger: Logger;
}

/** Reads one organization's journey facts. */
export interface OnboardingFactsReader {
  /**
   * The facts for `org`, with `leaveOut` (an identity-account id: the one
   * asking, or the organization's creator; "" for nobody) left out of the
   * people who joined.
   */
  read(org: string, leaveOut: string): Promise<OnboardingFacts>;
}

export function newOnboardingFactsReader(deps: OnboardingFactsDeps): OnboardingFactsReader {
  return {
    async read(org, leaveOut) {
      const [agents, runs, servedProvider, people] = await Promise.all([
        readAgents(deps, org),
        readRuns(deps, org),
        readServedProvider(deps, org),
        readPeople(deps, org, leaveOut),
      ]);
      return { ...agents, ...runs, servedProvider, ...people };
    },
  };
}

async function readAgents(
  deps: OnboardingFactsDeps,
  org: string,
): Promise<Pick<OnboardingFacts, "hasAgent" | "newestAgent" | "changedAgent">> {
  const rows = await deps.store.queryResources(agentListIndex, { org, limit: AGENT_PAGE });
  let newestAgent: OnboardingAgentFact | undefined;
  let changedAgent: OnboardingAgentFact | undefined;
  for (const row of rows) {
    const agent = decode(deps, () => fromBinary(AgentSchema, row.data), "agent");
    const slug = agent?.metadata?.slug ?? "";
    if (agent === undefined || !isJourneyAgentSlug(slug)) continue;
    const found: OnboardingAgentFact = { org: agent.metadata?.org || org, slug, name: agent.metadata?.name || slug };
    newestAgent ??= found;
    // A second version means its spec changed since it was made.
    if ((await deps.store.countAuditEntries(ApiResourceKind.agent, row.id)) > 1) {
      changedAgent = found;
      break;
    }
  }
  return { hasAgent: rows.length > 0, newestAgent, changedAgent };
}

async function readRuns(deps: OnboardingFactsDeps, org: string): Promise<Pick<OnboardingFacts, "everRan" | "completedRun">> {
  let after: ListIndexCursor | undefined;
  let everRan = false;
  for (;;) {
    const rows = await deps.store.queryResources(agentExecutionListIndex, { org, limit: RUN_PAGE, ...(after ? { after } : {}) });
    if (rows.length > 0) everRan = true;
    for (const row of rows) {
      const run = decode(deps, () => fromBinary(RunSchema, row.data), "run");
      if (run?.status?.phase === RunPhase.RUN_COMPLETED) return { everRan, completedRun: true };
    }
    const last = rows[rows.length - 1];
    if (rows.length < RUN_PAGE || last === undefined) return { everRan, completedRun: false };
    after = last.cursor;
  }
}

async function readServedProvider(deps: OnboardingFactsDeps, org: string): Promise<string | undefined> {
  for (const provider of MODEL_PROVIDERS) {
    const report = await deps.providerAvailability.availability(org, provider);
    if (report.state === "served") return provider;
  }
  return undefined;
}

async function readPeople(
  deps: OnboardingFactsDeps,
  org: string,
  leaveOut: string,
): Promise<Pick<OnboardingFacts, "appUserName" | "joined">> {
  if (!deps.authenticationRequired) return { appUserName: undefined, joined: [] };
  const organizationKind = kindEnumName(ApiResourceKind.organization);
  const entries = await buildPrincipalAccessList(deps.grants, deps.store, deps.displayResolver, deps.principalDisplay, [
    { kind: organizationKind, id: org },
  ]);
  let appUserName: string | undefined;
  const joined: string[] = [];
  for (const entry of entries) {
    const view = entry.principal;
    if (view === undefined || view.id === "" || view.kind !== ACCOUNT_KIND) continue;
    const mode = view.identityOrigin?.provisioningMode;
    if (mode === IdentityAccountProvisioningMode.app_user) {
      appUserName ??= displayNameOf(view);
    } else if (
      (mode === IdentityAccountProvisioningMode.direct || mode === IdentityAccountProvisioningMode.federated) &&
      view.id !== leaveOut
    ) {
      joined.push(displayNameOf(view));
    }
  }
  return { appUserName, joined };
}

/** An entry's name, else its email, else its id: the kit's rule. */
function displayNameOf(view: ApiResourceRefView): string {
  return view.name || view.email || view.id;
}

/** A row decoded, or undefined (logged) when its bytes do not decode, as the list lanes skip one. */
function decode<T>(deps: OnboardingFactsDeps, read: () => T, kind: string): T | undefined {
  try {
    return read();
  } catch (error) {
    deps.logger.warn(`Failed to unmarshal ${kind}, skipping`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
