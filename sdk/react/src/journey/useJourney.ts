"use client";

// Where an organization is on the journey from a first agent to its users:
// six steps, each done only when the server already says so. The dashboard's
// card, the launcher's next line and the line under a first job all read
// this one hook, so the three never disagree.
//
//   1 Say what it should do  an agent exists (the server's agent list)
//   2 Add a model key        a provider serves a model (`useModelReadiness`),
//                            or a run has completed: a model answered it,
//                            whatever readiness can attribute (a key in the
//                            runners' own environment reads as unknown, not
//                            served)
//   3 Watch it work          a run has completed (the all-time run summary);
//                            a run that failed or was stopped did no job
//   4 Make it yours          a journey agent has a second version: its
//                            instructions changed, or a skill was added
//   5 Put it in your app     not read yet: never done
//   6 Bring others in        not read yet: never done
//
// Nothing is stored: every answer is a read the server already serves. The
// version read is the only new one, and it is made only for journey agents
// (`journey-agents.ts`), newest first, stopping at the first agent with a
// second version, and only once the agent list has one; a plugin upgrade's
// new version never counts.
//
// Asked only for a host that opts in and a person the server lets make
// agents (`can_create_agent`, asked fail closed, the first question's
// rule): the steps are acts. Until every read is in, the answer is
// "pending", so no surface draws a step and then takes it back; a read that
// fails answers "off", so nothing claims a step it could not see.

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { ListAgentVersionsInputSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import type { ResourceRef } from "@stigmer/client";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunSummaryTimeWindow, useRunSummary } from "../dashboard/useRunSummary.js";
import { useModelReadiness } from "../models/useModelReadiness.js";
import { presentationOf } from "../models/provider-presentation.js";
import { isJourneyAgentSlug } from "./journey-agents.js";

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
  { id: "in-app", title: "Put it in your app", todo: "Give your users the chat, from the agent's Channels tab." },
  { id: "others", title: "Bring others in", todo: "Invite your team to this organization." },
];

/** The journey agents the server lists, newest first, and the one changed since it was made. */
interface JourneyAgents {
  /** Whether the organization has any agent at all. */
  readonly hasAgent: boolean;
  /** The newest journey agent, undefined when there is none. */
  readonly newest: JourneyAgent | undefined;
  /** The first journey agent (newest first) with a second version, undefined when none has one. */
  readonly changed: JourneyAgent | undefined;
}

/** How many agents the list reads: one page, a new organization's whole list. */
const AGENT_PAGE = 50;

const OFF: UseJourneyReturn = { status: "off", steps: [], done: 0, current: undefined, agent: undefined, everRan: undefined };
const PENDING: UseJourneyReturn = { status: "pending", steps: [], done: 0, current: undefined, agent: undefined, everRan: undefined };

/**
 * Where `org` is on the journey from a first agent to its users. Pass
 * `enabled: false` to skip every read (the answer is then `"off"`).
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
  const asking = options.enabled && !!org;
  const orgId = asking ? (org as string) : null;
  const permission = useCheckPermission(orgId ? { kind: "organization", id: orgId } : null, "can_create_agent", { fail: "closed" });
  const allowed = permission.allowed;
  // The reads are made only for a person the steps are for.
  const reading = orgId !== null && allowed ? orgId : null;
  // One all-time read answers both: whether anything ran, and whether a run completed.
  const runs = useRunSummary({ org: reading, timeWindow: RunSummaryTimeWindow.ALL_TIME });
  const summary = reading ? runs.summary : null;
  const everRan = summary === null ? undefined : summary.activeCount + Object.values(summary.phaseCounts).reduce((sum, n) => sum + n, 0) > 0;
  const completed = summary === null ? undefined : (summary.phaseCounts[RunPhase.RUN_COMPLETED] ?? 0) > 0;
  const readiness = useModelReadiness(reading);
  const agents = useFetch<JourneyAgents | undefined>(
    reading
      ? async () => {
          const list = await stigmer.agent.list({ org: reading, pageSize: AGENT_PAGE });
          let newest: JourneyAgent | undefined;
          let changed: JourneyAgent | undefined;
          for (const agent of list.entries) {
            const slug = agent.metadata?.slug ?? "";
            if (!isJourneyAgentSlug(slug)) continue;
            const found: JourneyAgent = {
              ref: { org: agent.metadata?.org || reading, slug },
              name: agent.metadata?.name || slug,
            };
            newest ??= found;
            // A second version means its spec changed since it was made.
            const versions = await stigmer.agent.listVersions(
              create(ListAgentVersionsInputSchema, { org: found.ref.org, slug, pageSize: 2 }),
            );
            if (versions.entries.length > 1) {
              changed = found;
              break;
            }
          }
          return { hasAgent: list.entries.length > 0, newest, changed };
        }
      : null,
    [stigmer, reading],
    undefined,
  );

  const served = useMemo(
    () => (readiness.providers ?? []).find((report) => report.availability.state === "served")?.provider,
    [readiness.providers],
  );

  return useMemo<UseJourneyReturn>(() => {
    if (orgId === null) return OFF;
    if (permission.isLoading) return PENDING;
    if (!allowed) return OFF;
    if (runs.error !== null || agents.error !== null || readiness.error !== null) return OFF;
    if (everRan === undefined || completed === undefined || agents.data === undefined || readiness.providers === null) {
      return PENDING;
    }
    const known = agents.data;
    const agent = known.changed ?? known.newest;
    const facts: Record<JourneyStepId, string | undefined> = {
      describe: known.hasAgent ? (agent ? `${agent.name} is made` : "Your first agent is made") : undefined,
      key: served !== undefined ? `${presentationOf(served).name} is connected` : completed ? "A model answered its first job" : undefined,
      watch: completed ? "It ran its first job" : undefined,
      "make-yours": known.changed ? `${known.changed.name} has your changes` : undefined,
      "in-app": undefined,
      others: undefined,
    };
    let current: JourneyStep | undefined;
    let done = 0;
    const steps = STEPS.map((step, index): JourneyStep => {
      const fact = facts[step.id];
      if (fact !== undefined) {
        done += 1;
        return { id: step.id, number: index + 1, title: step.title, state: "done", line: fact };
      }
      const state: JourneyStepState = current === undefined ? "current" : "todo";
      const drawn: JourneyStep = { id: step.id, number: index + 1, title: step.title, state, line: step.todo };
      current ??= drawn;
      return drawn;
    });
    return { status: "ready", steps, done, current, agent, everRan };
  }, [orgId, permission.isLoading, allowed, runs.error, everRan, completed, agents.error, agents.data, readiness.error, readiness.providers, served]);
}
