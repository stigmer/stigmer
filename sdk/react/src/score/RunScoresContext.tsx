"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { useWhoAmI } from "../iam-policy/useWhoAmI.js";
import {
  judgeScoreOf,
  runHealthScoreOf,
  scoresByRun,
  type ViewerIdentity,
} from "./score-view.js";
import { useSessionScores } from "./useSessionScores.js";

/**
 * The thread's scores, shared by every {@link RunScores} it renders:
 * the session's scores read once, grouped by run, the organization each
 * run belongs to (a rating is filed there), each run's request and whether
 * it continued an earlier one (a test case is made from them), the
 * viewer's identity, and a refetch for after a rating.
 *
 * Two contexts on purpose. `RunScoresEnabledContext` is a constant the
 * thread's row renderer reads to decide whether to render the control at
 * all; `RunScoresDataContext` changes with every fetch and is read only by
 * the controls, so a refetch re-renders the few rating rows, never the
 * whole thread.
 *
 * @internal Not part of the public `@stigmer/react` API.
 */
export interface RunScoresData {
  readonly scoresOf: (runId: string) => readonly Score[];
  readonly orgOf: (runId: string) => string;
  /** What the person typed for the run; empty when the thread lacks it. */
  readonly requestOf: (runId: string) => string;
  /** Whether the run continued a conversation: an earlier run is in the thread. */
  readonly followsEarlierRun: (runId: string) => boolean;
  readonly viewer: ViewerIdentity | null;
  readonly refetch: () => void;
}

const RunScoresDataContext = createContext<RunScoresData | null>(null);
const RunScoresEnabledContext = createContext(false);

/** Whether the surrounding thread shows run scores. @internal */
export function useRunScoresEnabled(): boolean {
  return useContext(RunScoresEnabledContext);
}

/** The thread's score data; `null` outside a {@link RunScoresProvider}. @internal */
export function useRunScoresData(): RunScoresData | null {
  return useContext(RunScoresDataContext);
}

/**
 * The refetch schedule after a run completes: grading starts when the run
 * completes and writes its scores a moment later, so the view asks again a
 * bounded number of times (about five seconds in all). It stops early only
 * once both the health score and a judge score are read: the judge's
 * pending score is written just after run health, and a run whose agent
 * has no AI grading never gets one, so such a run takes all three reads.
 * A pending judge grade is then followed by useSessionScores' own poll.
 */
export const GRADING_REFETCH_DELAYS_MS: readonly number[] = [750, 1_500, 3_000];

const NO_SCORES: readonly Score[] = [];

/** Props for {@link RunScoresProvider}. @internal */
export interface RunScoresProviderProps {
  /** Every run the thread renders, completed and streaming. */
  readonly runs: readonly Run[];
  readonly children: ReactNode;
}

/**
 * Reads a thread's scores and hands them to its rating controls. Mounted
 * by `MessageThread` only when its host asked for run scores, so a view
 * that shows none makes no score request at all.
 *
 * @internal Not part of the public `@stigmer/react` API.
 */
export function RunScoresProvider({ runs, children }: RunScoresProviderProps) {
  const sessionId = sessionIdOfRuns(runs);
  const { scores, refetch } = useSessionScores(sessionId);
  const { account } = useWhoAmI();

  const byRun = useMemo(() => scoresByRun(scores), [scores]);
  const orgByRun = useMemo(() => {
    const map = new Map<string, string>();
    for (const run of runs) {
      const id = run.metadata?.id ?? "";
      if (id !== "") map.set(id, run.metadata?.org ?? "");
    }
    return map;
  }, [runs]);
  // The thread renders its runs in conversation order, so a run's place
  // says whether it continued an earlier request.
  const turnByRun = useMemo(() => {
    const map = new Map<
      string,
      { readonly request: string; readonly index: number }
    >();
    runs.forEach((run, index) => {
      const id = run.metadata?.id ?? "";
      if (id !== "") map.set(id, { request: run.spec?.message ?? "", index });
    });
    return map;
  }, [runs]);

  const viewer = useMemo<ViewerIdentity | null>(
    () =>
      account === null
        ? null
        : {
            accountId: account.metadata?.id ?? "",
            subject: account.spec?.idpId ?? "",
          },
    [account],
  );

  useRefetchOnCompletion(runs, byRun, refetch);

  const data = useMemo<RunScoresData>(
    () => ({
      scoresOf: (runId) => byRun.get(runId) ?? NO_SCORES,
      orgOf: (runId) => orgByRun.get(runId) ?? "",
      requestOf: (runId) => turnByRun.get(runId)?.request ?? "",
      followsEarlierRun: (runId) => (turnByRun.get(runId)?.index ?? 0) > 0,
      viewer,
      refetch,
    }),
    [byRun, orgByRun, turnByRun, viewer, refetch],
  );

  return (
    <RunScoresEnabledContext.Provider value={true}>
      <RunScoresDataContext.Provider value={data}>
        {children}
      </RunScoresDataContext.Provider>
    </RunScoresEnabledContext.Provider>
  );
}

/** The session the thread's runs belong to, or `null` before the first run. */
function sessionIdOfRuns(runs: readonly Run[]): string | null {
  for (const run of runs) {
    const target = run.spec?.target;
    if (target?.case === "sessionId" && target.value !== "") {
      return target.value;
    }
  }
  return null;
}

/**
 * Refetches on the {@link GRADING_REFETCH_DELAYS_MS} schedule when a run
 * the view already knew moves to COMPLETED, until its health score is
 * read with a judge score. Runs already completed when the view mounted are
 * covered by the first fetch.
 */
function useRefetchOnCompletion(
  runs: readonly Run[],
  byRun: ReadonlyMap<string, readonly Score[]>,
  refetch: () => void,
): void {
  const seenPhase = useRef(new Map<string, RunPhase>());
  const waiting = useRef(new Set<string>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const byRunRef = useRef(byRun);
  useEffect(() => {
    byRunRef.current = byRun;
  }, [byRun]);

  useEffect(() => {
    for (const run of runs) {
      const id = run.metadata?.id ?? "";
      if (id === "") continue;
      const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
      const before = seenPhase.current.get(id);
      seenPhase.current.set(id, phase);
      if (
        before !== undefined &&
        before !== RunPhase.RUN_COMPLETED &&
        phase === RunPhase.RUN_COMPLETED
      ) {
        waiting.current.add(id);
        for (const delay of GRADING_REFETCH_DELAYS_MS) {
          timers.current.push(
            setTimeout(() => {
              const scores = byRunRef.current.get(id) ?? NO_SCORES;
              if (
                runHealthScoreOf(scores) !== undefined &&
                judgeScoreOf(scores) !== undefined
              ) {
                waiting.current.delete(id);
                return;
              }
              if (waiting.current.has(id)) refetch();
            }, delay),
          );
        }
      }
    }
  }, [runs, refetch]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);
}
