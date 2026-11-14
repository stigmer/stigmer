"use client";

// Where an organization is on the journey from a first agent to its users:
// six steps, each done only when the server already says so. The dashboard's
// card, the launcher's next line and the line under a first job all read
// this one hook, so the three never disagree.
//
//   1 Say what it should do  an agent exists
//   2 Add a model key        a provider serves a model, or a run has
//                            completed: a model answered it, whatever the
//                            server can attribute (a key in the runners' own
//                            environment reads as unknown, not served)
//   3 Watch it work          a run has completed; a run that failed or was
//                            stopped did no job
//   4 Make it yours          a journey agent has a second version: its
//                            instructions changed, or a skill was added
//   5 Put it in your app     a person signed in from the builder's own app:
//                            an app-user account on the organization's
//                            access list; never on a server that signs
//                            nobody in
//   6 Bring others in        someone besides the viewer has joined: a
//                            person (a direct or federated account) on the
//                            same access list; never on a server that signs
//                            nobody in
//
// The steps are the server's: one read, the organization's onboarding
// (`organization.getOnboarding`), whose rule the server keeps once and also
// runs for the platform operator's count of where newcomers stop, so the card
// and the count cannot disagree. Which agents are the journey's is
// `@stigmer/examples/journey`'s rule, the one the first question makes agents
// under. The words of each step stay here.
//
// Asked only for a host that opts in and an admin of the organization: the
// server answers `can_edit` holders and refuses everyone else, a member
// among them, who gets no journey and the ordinary launcher. A server too
// old to answer the read draws no journey either. Until the answer is in,
// it is "pending", so no surface draws a step and then takes it back; a
// read that fails answers "off", so nothing claims a step it could not see.

import { useMemo } from "react";
import type { OnboardingProgress } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/onboarding_pb";
import { OnboardingStepId } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/onboarding_pb";
import type { ResourceRef } from "@stigmer/client";
import { isPermissionDenied } from "@stigmer/client";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";
import { isUnimplemented } from "../internal/isUnimplemented.js";
import { presentationOf } from "../models/provider-presentation.js";

/** The six steps, in the journey's order. */
export type JourneyStepId = "describe" | "key" | "watch" | "make-yours" | "in-app" | "others";

/** A step's place: done, the one to take now, or one after it. */
export type JourneyStepState = "done" | "current" | "todo";

/** One step of the journey, as a surface draws it. */
export interface JourneyStep {
  readonly id: JourneyStepId;
  /** 1 to 6. */
  readonly number: number;
  /** The step's name ("Make it yours"). */
  readonly title: string;
  readonly state: JourneyStepState;
  /**
   * One line: for a done step, what the server says happened ("Variance
   * Reporter has your changes"); for the others, what taking it means.
   */
  readonly line: string;
}

/** The agent the journey made: the newest journey agent, or the one already made the newcomer's own. */
export interface JourneyAgent {
  /** Its reference, by organization id and slug. */
  readonly ref: ResourceRef;
  /** Its display name ("Variance Reporter"). */
  readonly name: string;
}

/** Return value of {@link useJourney}. */
export interface UseJourneyReturn {
  /**
   * `"off"`: not asked (no opt-in, no organization, a person who may not
   * make agents) or a read failed; `"pending"`: still reading; `"ready"`:
   * every step is known.
   */
  readonly status: "off" | "pending" | "ready";
  /** The six steps while `"ready"`; empty otherwise. */
  readonly steps: readonly JourneyStep[];
  /** How many steps are done (0 unless `"ready"`). */
  readonly done: number;
  /** The first step not done, or undefined when all six are (or not `"ready"`). */
  readonly current: JourneyStep | undefined;
  /** The agent the journey made, or undefined when there is none. */
  readonly agent: JourneyAgent | undefined;
  /**
   * Whether anything has ever run here, a failed or stopped run included
   * (`useEverRan`'s rule), for a surface that lays itself out on it; while
   * `"ready"` only, undefined otherwise. The steps themselves count only
   * runs that completed.
   */
  readonly everRan: boolean | undefined;
}

/** The six steps' names and what taking each means, in order. */
const STEPS: readonly { readonly id: JourneyStepId; readonly title: string; readonly todo: string }[] = [
  { id: "describe", title: "Say what it should do", todo: "Pick an example job or describe your own. It runs on a sample file." },
  { id: "key", title: "Add a model key", todo: "Add an Anthropic or OpenAI key, so your agent has a model to think with." },
  { id: "watch", title: "Watch it work", todo: "Send it the sample and watch it work, step by step. A file comes back." },
  { id: "make-yours", title: "Make it yours", todo: "Change its instructions, run it on your own file, give it a skill." },
  { id: "in-app", title: "Put it in your app", todo: "Give your users the chat, from the agent's In your app tab." },
  { id: "others", title: "Bring others in", todo: "Name your organization and invite your team." },
];

/** The server's name for each step. */
const SERVER_STEP: Record<JourneyStepId, OnboardingStepId> = {
  describe: OnboardingStepId.describe,
  key: OnboardingStepId.key,
  watch: OnboardingStepId.watch,
  "make-yours": OnboardingStepId.make_yours,
  "in-app": OnboardingStepId.in_app,
  others: OnboardingStepId.others,
};

const OFF: UseJourneyReturn = { status: "off", steps: [], done: 0, current: undefined, agent: undefined, everRan: undefined };
const PENDING: UseJourneyReturn = { status: "pending", steps: [], done: 0, current: undefined, agent: undefined, everRan: undefined };

/**
 * Where `org` is on the journey from a first agent to its users. Pass
 * `enabled: false` to skip the read (the answer is then `"off"`).
 *
 * @example
 * ```tsx
 * function NextStep({ org }: { org: string }) {
 *   const journey = useJourney(org, { enabled: true });
 *   if (journey.status !== "ready" || journey.current === undefined) return null;
 *   return <p>Next: {journey.current.title}</p>;
 * }
 * ```
 */
export function useJourney(org: string | null | undefined, options: { readonly enabled: boolean }): UseJourneyReturn {
  const stigmer = useStigmer();
  const orgId = options.enabled && org ? org : null;
  // null: the server refused (not an admin here) or does not serve the read.
  const read = useFetch<OnboardingProgress | null | undefined>(
    orgId
      ? async () => {
          try {
            return await stigmer.organization.getOnboarding(orgId);
          } catch (err) {
            if (isPermissionDenied(err) || isUnimplemented(err)) return null;
            throw err;
          }
        }
      : null,
    [stigmer, orgId],
    undefined,
  );

  return useMemo<UseJourneyReturn>(() => {
    if (orgId === null || read.error !== null) return OFF;
    if (read.data === undefined) return PENDING;
    if (read.data === null) return OFF;
    return journeyOf(read.data, orgId);
  }, [orgId, read.error, read.data]);
}

/** The journey as the surfaces draw it, from the server's answer. */
function journeyOf(progress: OnboardingProgress, org: string): UseJourneyReturn {
  const done = new Set(progress.steps.filter((step) => step.done).map((step) => step.id));
  const named = (agent: OnboardingProgress["newestAgent"]): JourneyAgent | undefined =>
    agent === undefined ? undefined : { ref: { org: agent.org || org, slug: agent.slug }, name: agent.name || agent.slug };
  const changed = named(progress.changedAgent);
  const agent = changed ?? named(progress.newestAgent);
  const facts: Record<JourneyStepId, string> = {
    describe: agent ? `${agent.name} is made` : "Your first agent is made",
    key: progress.servedProvider !== "" ? `${presentationOf(progress.servedProvider).name} is connected` : "A model answered its first job",
    watch: "It ran its first job",
    "make-yours": `${changed?.name ?? "Your agent"} has your changes`,
    "in-app": `${progress.appUserName} signed in from your app`,
    others: joinedLine(progress.joinedNames, progress.joinedCount),
  };
  let current: JourneyStep | undefined;
  let count = 0;
  const steps = STEPS.map((step, index): JourneyStep => {
    if (done.has(SERVER_STEP[step.id])) {
      count += 1;
      return { id: step.id, number: index + 1, title: step.title, state: "done", line: facts[step.id] };
    }
    const state: JourneyStepState = current === undefined ? "current" : "todo";
    const drawn: JourneyStep = { id: step.id, number: index + 1, title: step.title, state, line: step.todo };
    current ??= drawn;
    return drawn;
  });
  return { status: "ready", steps, done: count, current, agent, everRan: progress.everRan };
}

/** "Sam joined", "Sam and Priya joined", "Sam and 2 others joined", from up to two names and how many joined. */
function joinedLine(names: readonly string[], count: number): string {
  const [first = "Someone", second] = names;
  if (count <= 1) return `${first} joined`;
  if (count === 2 && second !== undefined) return `${first} and ${second} joined`;
  return `${first} and ${count - 1} others joined`;
}
