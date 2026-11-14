/**
 * Pins the journey as the surfaces draw it from the server's one answer
 * (`organization.getOnboarding`, whose rule the server keeps and its own
 * suite pins over a seeded world): the six steps in the journey's order,
 * each done exactly when the server says so, the first not done the current
 * one; each done step's line naming what happened (the journey's agent, the
 * provider that serves it or the model that answered, the app user, who
 * joined: "Sam joined", "Sam and Priya joined", "Sam and 2 others joined");
 * the journey's agent the one changed, else the newest; whether anything
 * ran, for a surface's layout. Nothing is read without the host's opt-in;
 * "pending" until the answer is in; "off" for a person the server refuses
 * (no admin of the organization, a member who may make agents included), on
 * a server too old to answer, and when the read fails, so nothing claims a
 * step it could not see.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { StigmerError } from "@stigmer/client";
import {
  OnboardingProgressSchema,
  OnboardingStepId,
  OnboardingStepSchema,
  type OnboardingProgress,
} from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/onboarding_pb";
import { useJourney } from "../useJourney";

const ALL = [
  OnboardingStepId.describe,
  OnboardingStepId.key,
  OnboardingStepId.watch,
  OnboardingStepId.make_yours,
  OnboardingStepId.in_app,
  OnboardingStepId.others,
];

/** An agent as the answer names it. */
interface Named {
  readonly org: string;
  readonly slug: string;
  readonly name: string;
}

/** The facts an answer may carry beside its steps. */
interface Facts {
  readonly newestAgent?: Named;
  readonly changedAgent?: Named;
  readonly servedProvider?: string;
  readonly everRan?: boolean;
  readonly appUserName?: string;
  readonly joinedNames?: string[];
  readonly joinedCount?: number;
}

/** The server's answer with the named steps done and any facts given. */
function progress(done: readonly OnboardingStepId[], facts: Facts = {}): OnboardingProgress {
  const answer = create(OnboardingProgressSchema, facts);
  answer.steps = ALL.map((id) => create(OnboardingStepSchema, { id, done: done.includes(id) }));
  return answer;
}

/** What the server answers next: a progress, a refusal, or a read still in flight. */
let answer: () => Promise<OnboardingProgress>;

function client() {
  return { organization: { getOnboarding: vi.fn((_org: string) => answer()) } };
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

/** The steps' states and lines once ready. */
async function readyLines(done: readonly OnboardingStepId[], facts: Parameters<typeof progress>[1] = {}) {
  answer = () => Promise.resolve(progress(done, facts));
  const { result } = renderJourney();
  await waitFor(() => expect(result.current.status).toBe("ready"));
  return result.current;
}

beforeEach(() => {
  answer = () => Promise.resolve(progress([]));
});
afterEach(cleanup);

describe("useJourney", () => {
  it("reads nothing without the host's opt-in", () => {
    const { result, stigmer } = renderJourney(false);

    expect(result.current.status).toBe("off");
    expect(stigmer.organization.getOnboarding).not.toHaveBeenCalled();
  });

  it("asks the server once, for the organization", async () => {
    const { result, stigmer } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(stigmer.organization.getOnboarding.mock.calls).toEqual([["org_acme"]]);
  });

  it("CON-01 reads no step for a person the server refuses: no admin of the organization, a member who may make agents included", async () => {
    answer = () => Promise.reject(new StigmerError("permission-denied", "unauthorized to read this organization's onboarding", 7));
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("off"));
    expect(result.current.steps).toEqual([]);
  });

  it("draws no journey on a server too old to answer", async () => {
    answer = () => Promise.reject(new StigmerError("unknown", "not implemented", 12));
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("off"));
  });

  it("answers off when the read fails, claiming no step it could not see", async () => {
    answer = () => Promise.reject(new StigmerError("internal", "failed to read onboarding", 13));
    const { result } = renderJourney();

    await waitFor(() => expect(result.current.status).toBe("off"));
    expect([result.current.done, result.current.current, result.current.everRan]).toEqual([0, undefined, undefined]);
  });

  it("is pending while the server is asked, so nothing is drawn and taken back", () => {
    answer = () => new Promise<never>(() => {});
    const { result } = renderJourney();

    expect(result.current.status).toBe("pending");
    expect(result.current.steps).toEqual([]);
  });

  it("starts a new organization on its first step, in the journey's order", async () => {
    const journey = await readyLines([]);

    expect(journey.steps.map((step) => [step.number, step.id, step.title, step.state])).toEqual([
      [1, "describe", "Say what it should do", "current"],
      [2, "key", "Add a model key", "todo"],
      [3, "watch", "Watch it work", "todo"],
      [4, "make-yours", "Make it yours", "todo"],
      [5, "in-app", "Put it in your app", "todo"],
      [6, "others", "Bring others in", "todo"],
    ]);
    expect([journey.done, journey.current?.id, journey.agent, journey.everRan]).toEqual([0, "describe", undefined, false]);
  });

  it("marks each step done on the server's word, with what happened, and names the journey's agent", async () => {
    const journey = await readyLines(ALL, {
      newestAgent: { org: "org_acme", slug: "variance-reporter", name: "Variance Reporter" },
      changedAgent: { org: "org_acme", slug: "variance-reporter", name: "Variance Reporter" },
      servedProvider: "anthropic",
      everRan: true,
      appUserName: "Dana",
      joinedNames: ["Sam"],
      joinedCount: 1,
    });

    expect(journey.steps.map((step) => [step.state, step.line])).toEqual([
      ["done", "Variance Reporter is made"],
      ["done", "Anthropic is connected"],
      ["done", "It ran its first job"],
      ["done", "Variance Reporter has your changes"],
      ["done", "Dana signed in from your app"],
      ["done", "Sam joined"],
    ]);
    expect([journey.done, journey.current, journey.everRan]).toEqual([6, undefined, true]);
    expect(journey.agent).toEqual({ ref: { org: "org_acme", slug: "variance-reporter" }, name: "Variance Reporter" });
  });

  it("names the agent changed since it was made over a newer one, else the newest", async () => {
    const changed = await readyLines([OnboardingStepId.describe, OnboardingStepId.make_yours], {
      newestAgent: { org: "org_acme", slug: "your-agent-2", name: "Your Agent 2" },
      changedAgent: { org: "org_acme", slug: "ticket-replier", name: "Ticket Replier" },
    });
    expect([changed.agent?.ref.slug, changed.steps[0]?.line, changed.steps[3]?.line]).toEqual([
      "ticket-replier",
      "Ticket Replier is made",
      "Ticket Replier has your changes",
    ]);
    cleanup();

    const newest = await readyLines([OnboardingStepId.describe], { newestAgent: { org: "", slug: "your-agent", name: "" } });
    expect([newest.agent?.ref, newest.agent?.name]).toEqual([{ org: "org_acme", slug: "your-agent" }, "your-agent"]);
  });

  it("says a first agent is made when the server names none the journey made", async () => {
    const journey = await readyLines([OnboardingStepId.describe]);

    expect([journey.steps[0]?.line, journey.agent, journey.current?.id]).toEqual(["Your first agent is made", undefined, "key"]);
  });

  it("says a model answered when the key step is done though no provider reads as serving (a key in the runners' environment)", async () => {
    const journey = await readyLines([OnboardingStepId.describe, OnboardingStepId.key, OnboardingStepId.watch], { everRan: true });

    expect(journey.steps[1]?.line).toBe("A model answered its first job");
    expect(journey.current?.id).toBe("make-yours");
  });

  it("keeps the key and watch steps open after a run that failed, though something ran", async () => {
    const journey = await readyLines([OnboardingStepId.describe], { everRan: true });

    expect([journey.steps[1]?.state, journey.steps[2]?.state, journey.everRan]).toEqual(["current", "todo", true]);
  });

  it("names two who joined, then the first and how many others", async () => {
    const two = await readyLines([OnboardingStepId.others], { joinedNames: ["Sam", "Priya"], joinedCount: 2 });
    expect(two.steps[5]?.line).toBe("Sam and Priya joined");
    cleanup();

    const three = await readyLines([OnboardingStepId.others], { joinedNames: ["Sam", "Priya"], joinedCount: 3 });
    expect(three.steps[5]?.line).toBe("Sam and 2 others joined");
  });

  it("leaves a step the server does not name done open, the current one the first open", async () => {
    const journey = await readyLines([OnboardingStepId.describe, OnboardingStepId.key, OnboardingStepId.others], {
      joinedNames: ["Sam"],
      joinedCount: 1,
    });

    expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "current", "todo", "todo", "done"]);
    expect([journey.done, journey.current?.id]).toEqual([3, "watch"]);
  });
});
