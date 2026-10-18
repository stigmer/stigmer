// What a real-clock long turn plays: the profiles, their steps, and the shell
// each step runs.
// Domain: conformance long turn (the real-clock run's plan; pure).
//
// Two profiles, chosen by `--profile` (scripts/long-turn-real-clock.ts):
//
//   - `goal` plays what a turn of hours must survive, in real time and in one
//     turn: a 10-minute silent build, a 10-minute build that prints a line
//     every 30 s, a subagent that works 4 minutes, enough tool output for
//     three compactions, a runner killed mid-tool and a runner drained
//     mid-tool. Today the turn dies early; the report says where.
//   - `endurance` avoids every killer known on 2026-10-18 (stigmer#2414,
//     #2415, #2416, #2417, #2428, #2429 and the native shell's 120 s timeout):
//     two-minute commands that print every 20 s, nothing killed, for three
//     hours, so what it finds is what only hours show. Its tool output is
//     paced to cross the compaction trigger of its model (Claude Haiku 4.5,
//     whose library profile puts it at 170,000 tokens) three times or more.
//
// Every step's shell appends `start <id>` and `end <id>` to the run's marker
// file, so the run reads which step is open from disk, never from a guess.
// A held step (`kill`, `drain`) waits for its release file, so the run ends
// the runner while the step is provably running.

/** One thing the long turn does. Seconds are wall time. */
export type LongTurnStep =
  | { readonly kind: "silent"; readonly id: string; readonly seconds: number }
  | { readonly kind: "streamed"; readonly id: string; readonly seconds: number; readonly everySeconds: number; readonly bytesPerLine: number }
  | { readonly kind: "subagent"; readonly id: string; readonly seconds: number }
  | { readonly kind: "bulk"; readonly id: string; readonly bytes: number }
  | { readonly kind: "kill"; readonly id: string }
  | { readonly kind: "drain"; readonly id: string };

export type LongTurnProfileName = "goal" | "endurance";

export interface LongTurnProfile {
  readonly name: LongTurnProfileName;
  /** The model registry id the turn runs on; it decides the window compaction is measured against. */
  readonly model: string;
  readonly steps: readonly LongTurnStep[];
  /** How long the run may take before it is stopped and reported as such. */
  readonly budgetMs: number;
}

/** The model both profiles run on: its library profile (200,000 tokens) puts compaction at 170,000. */
export const LONG_TURN_MODEL = "claude-haiku-4.5";

/** Approximate tokens per character, the summarization middleware's own counter's ratio. */
const CHARS_PER_TOKEN = 4;

/** The compaction trigger for the profile's model, and what one compaction keeps (0.1 of the window). */
const COMPACTION_TRIGGER_TOKENS = 170_000;
const COMPACTION_KEEP_TOKENS = 20_000;

/**
 * One bulk read's size: under deepagents' 80,000-character truncation of a
 * single tool result (TOOL_RESULT_TOKEN_LIMIT × 4), so every byte reaches
 * the conversation, and under the shell's 100 KB output cap.
 */
export const BULK_BYTES = 60_000;

/** How many bulk reads cross the trigger `compactions` times, counting what each compaction keeps. */
export function bulkReadsFor(compactions: number): number {
  const tokens = COMPACTION_TRIGGER_TOKENS + (compactions - 1) * (COMPACTION_TRIGGER_TOKENS - COMPACTION_KEEP_TOKENS);
  return Math.ceil((tokens * CHARS_PER_TOKEN) / BULK_BYTES) + 1;
}

/** The `goal` profile: the definition of done, played once in real time. */
export function goalProfile(): LongTurnProfile {
  const bulk = Array.from({ length: bulkReadsFor(3) }, (_, i): LongTurnStep => ({ kind: "bulk", id: `bulk-${i + 1}`, bytes: BULK_BYTES }));
  return {
    name: "goal",
    model: LONG_TURN_MODEL,
    steps: [
      { kind: "silent", id: "silent-build", seconds: 600 },
      { kind: "streamed", id: "streamed-build", seconds: 600, everySeconds: 30, bytesPerLine: 80 },
      { kind: "subagent", id: "subagent-work", seconds: 240 },
      ...bulk,
      { kind: "kill", id: "killed-mid-tool" },
      { kind: "drain", id: "drained-mid-tool" },
    ],
    budgetMs: 60 * 60_000,
  };
}

/** Each endurance command's length, and how often it prints: under every stall window known today. */
const ENDURANCE_STEP_SECONDS = 110;
const ENDURANCE_EVERY_SECONDS = 20;

/** The `endurance` profile: `minutes` of two-minute commands that print, paced for three compactions or more. */
export function enduranceProfile(minutes: number): LongTurnProfile {
  const count = Math.max(1, Math.floor((minutes * 60) / (ENDURANCE_STEP_SECONDS + 5)));
  const lines = ENDURANCE_STEP_SECONDS / ENDURANCE_EVERY_SECONDS;
  // Spread the bytes that cross three compactions over every command, with a
  // quarter's margin for what the model and the tools add of their own.
  const bytesPerStep = Math.min(BULK_BYTES, Math.ceil((bulkReadsFor(3) * BULK_BYTES * 1.25) / count));
  const bytesPerLine = Math.max(80, Math.ceil(bytesPerStep / lines));
  return {
    name: "endurance",
    model: LONG_TURN_MODEL,
    steps: Array.from({ length: count }, (_, i): LongTurnStep => ({
      kind: "streamed",
      id: `step-${i + 1}`,
      seconds: ENDURANCE_STEP_SECONDS,
      everySeconds: ENDURANCE_EVERY_SECONDS,
      bytesPerLine,
    })),
    budgetMs: (minutes + 30) * 60_000,
  };
}

/** The profile a flag names; `steps` keeps only the steps whose ids it lists, in profile order. */
export function profileOf(name: string, options: { readonly minutes?: number; readonly steps?: readonly string[] } = {}): LongTurnProfile {
  const profile = name === "goal" ? goalProfile() : name === "endurance" ? enduranceProfile(options.minutes ?? 180) : undefined;
  if (profile === undefined) throw new Error(`unknown profile '${name}' (goal or endurance)`);
  if (options.steps === undefined || options.steps.length === 0) return profile;
  const unknown = options.steps.filter((id) => !profile.steps.some((step) => step.id === id));
  if (unknown.length > 0) throw new Error(`profile '${name}' has no step ${unknown.join(", ")}`);
  return { ...profile, steps: profile.steps.filter((step) => options.steps!.includes(step.id)) };
}

/** Where a run's step bookkeeping lives: the marker file the steps append to, and a held step's release file. */
export interface StepFiles {
  readonly markers: string;
  releaseOf(id: string): string;
}

/** The shell command a step runs, or undefined for the subagent (it is a `task`, not a shell). */
export function shellCommandOf(step: LongTurnStep, files: StepFiles): string | undefined {
  const start = `echo 'start ${step.id}' >> '${files.markers}'`;
  const end = `echo 'end ${step.id}' >> '${files.markers}'`;
  switch (step.kind) {
    case "silent":
      return `${start}; sleep ${step.seconds}; ${end}`;
    case "streamed": {
      const lines = Math.max(1, Math.round(step.seconds / step.everySeconds));
      const fill = step.bytesPerLine > 20 ? ` $(head -c ${step.bytesPerLine - 20} /dev/zero | tr '\\0' 'x')` : "";
      return `${start}; for i in $(seq 1 ${lines}); do echo "line $i${fill}"; sleep ${step.everySeconds}; done; ${end}`;
    }
    case "bulk":
      return `${start}; head -c ${step.bytes} /dev/zero | tr '\\0' 'b'; echo; ${end}`;
    case "kill":
    case "drain":
      return `${start}; while [ ! -f '${files.releaseOf(step.id)}' ]; do sleep 0.2; done; ${end}`;
    case "subagent":
      return undefined;
    default: {
      const exhaustive: never = step;
      throw new Error(`unknown step ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** What the marker file says: every step that began and ended, in order, and the one still open. */
export interface StepProgress {
  readonly started: readonly string[];
  readonly ended: readonly string[];
  readonly open: string | undefined;
}

export function stepProgressOf(markerText: string): StepProgress {
  const started: string[] = [];
  const ended: string[] = [];
  for (const line of markerText.split("\n")) {
    const match = /^(start|end) (\S+)$/.exec(line.trim());
    if (match === null) continue;
    (match[1] === "start" ? started : ended).push(match[2]!);
  }
  const open = [...started].reverse().find((id) => started.filter((s) => s === id).length > ended.filter((e) => e === id).length);
  return { started, ended, open };
}

/** The instruction a live model is given for a step: the scripted run's tool call, in words. */
export function narrateStep(step: LongTurnStep, files: StepFiles): string {
  if (step.kind === "subagent") {
    return `Hand this to a general-purpose subagent with the task tool: "Think about what a careful code review checks, for ${step.seconds} seconds of work, then answer in one line."`;
  }
  return `Run exactly this shell command with the execute tool, and wait for it to finish: ${shellCommandOf(step, files)}`;
}

/** The steps a live run can play: all but `kill` and `drain`, which need a door to restart the runner. */
export function liveStepsOf(steps: readonly LongTurnStep[]): LongTurnStep[] {
  return steps.filter((step) => step.kind !== "kill" && step.kind !== "drain");
}

/** The flags both long-turn scripts read. */
export interface LongTurnFlags {
  readonly profile: string;
  readonly minutes: number | undefined;
  readonly steps: readonly string[];
  readonly out: string | undefined;
  /** The live run's harness (`deep-agent` or `cursor`); the real-clock run is native only. */
  readonly harness: string;
}

export function parseLongTurnFlags(argv: readonly string[]): LongTurnFlags {
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const minutes = value("minutes");
  if (minutes !== undefined && !(Number(minutes) > 0)) throw new Error(`--minutes must be a positive number, not '${minutes}'`);
  return {
    profile: value("profile") ?? "goal",
    minutes: minutes === undefined ? undefined : Number(minutes),
    steps: (value("steps") ?? "").split(",").filter((s) => s !== ""),
    out: value("out"),
    harness: value("harness") ?? "deep-agent",
  };
}
