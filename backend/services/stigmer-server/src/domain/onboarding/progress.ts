/**
 * Where an organization is on the journey from a first agent to its users:
 * the one rule every reader of the journey shares.
 *
 * Six steps, each done only when the server's own records already say so:
 *
 *   describe    an agent exists in the organization
 *   key         a provider serves a model, or a run has completed (a model
 *               answered it, whatever availability can attribute: a key in
 *               the runners' own environment reads as unknown, not served)
 *   watch       a run has completed; a run that failed or was stopped did
 *               no job
 *   make_yours  an agent the journey made has a second version: its
 *               instructions changed, or a skill was added
 *   in_app      a person signed in from the builder's own app: an app user
 *               on the organization's access list
 *   others      a person besides the one left out (the one asking, or in a
 *               count the organization's creator) is on the same list
 *
 * The console's first-steps card reads this through getOnboarding, and the
 * operator's count (getOnboardingFunnel) runs it for every new
 * organization, so the card and the count cannot disagree. The words of
 * each step stay in the clients; the server only says which are done and
 * names the facts a client's lines about them use.
 *
 * {@link onboardingProgress} is a pure function of the facts, which
 * facts.ts reads; a test pins every rule without a store.
 */
import { create } from "@bufbuild/protobuf";

import {
  OnboardingAgentSchema,
  OnboardingProgressSchema,
  OnboardingStepId,
  OnboardingStepSchema,
} from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/onboarding_pb";
import type { OnboardingProgress } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/onboarding_pb";

/** The six steps, in the journey's order. */
export const ONBOARDING_STEPS: readonly OnboardingStepId[] = [
  OnboardingStepId.describe,
  OnboardingStepId.key,
  OnboardingStepId.watch,
  OnboardingStepId.make_yours,
  OnboardingStepId.in_app,
  OnboardingStepId.others,
];

/** An agent the journey made, as a client's line names it. */
export interface OnboardingAgentFact {
  readonly org: string;
  readonly slug: string;
  readonly name: string;
}

/** What the records say about one organization, read by facts.ts. */
export interface OnboardingFacts {
  /** Whether the organization has any agent at all. */
  readonly hasAgent: boolean;
  /** The newest agent the journey made, or undefined when there is none. */
  readonly newestAgent: OnboardingAgentFact | undefined;
  /** The newest agent the journey made that has a second version, or undefined. */
  readonly changedAgent: OnboardingAgentFact | undefined;
  /** The first provider that serves a model, in the server's order, or undefined. */
  readonly servedProvider: string | undefined;
  /** Whether any run has ever started, a failed or stopped one included. */
  readonly everRan: boolean;
  /** Whether a run has completed. */
  readonly completedRun: boolean;
  /**
   * The first app user's display name, or undefined when there is none or
   * the server signs nobody in.
   */
  readonly appUserName: string | undefined;
  /**
   * The display names of the people on the access list besides the one
   * left out, in the list's order; empty on a server that signs nobody in.
   */
  readonly joined: readonly string[];
}

/** The six steps' answers and the facts a client names, as the wire carries them. */
export function onboardingProgress(facts: OnboardingFacts): OnboardingProgress {
  const done = stepsDone(facts);
  return create(OnboardingProgressSchema, {
    steps: ONBOARDING_STEPS.map((id) => create(OnboardingStepSchema, { id, done: done.has(id) })),
    newestAgent: facts.newestAgent === undefined ? undefined : create(OnboardingAgentSchema, facts.newestAgent),
    changedAgent: facts.changedAgent === undefined ? undefined : create(OnboardingAgentSchema, facts.changedAgent),
    servedProvider: facts.servedProvider ?? "",
    everRan: facts.everRan,
    appUserName: facts.appUserName ?? "",
    joinedNames: facts.joined.slice(0, 2),
    joinedCount: facts.joined.length,
  });
}

/** Which steps the facts show done. */
export function stepsDone(facts: OnboardingFacts): ReadonlySet<OnboardingStepId> {
  const done = new Set<OnboardingStepId>();
  if (facts.hasAgent) done.add(OnboardingStepId.describe);
  if (facts.servedProvider !== undefined || facts.completedRun) done.add(OnboardingStepId.key);
  if (facts.completedRun) done.add(OnboardingStepId.watch);
  if (facts.changedAgent !== undefined) done.add(OnboardingStepId.make_yours);
  if (facts.appUserName !== undefined) done.add(OnboardingStepId.in_app);
  if (facts.joined.length > 0) done.add(OnboardingStepId.others);
  return done;
}
