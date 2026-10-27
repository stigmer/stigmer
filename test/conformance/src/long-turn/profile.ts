// What a real-clock long turn plays: the profiles, their steps, and the shell
// each step runs.
// Domain: conformance long turn (the real-clock run's plan; pure).
//
// Three profiles, chosen by `--profile` (scripts/long-turn-real-clock.ts and
// scripts/long-turn-live.ts):
//
//   - `goal` plays what a turn of hours must survive, in real time and in one
//     turn: a 10-minute silent build, a 10-minute build that prints a line
//     every 30 s, a subagent that works 4 minutes, enough tool output for
//     three compactions, the server replaced mid-tool (a rollout: on a
//     Postgres target the outgoing and the incoming server serve together),
//     a runner killed mid-tool and a runner drained mid-tool. The report says
//     how far the turn got.
//   - `endurance` avoids every killer known on 2026-10-18 (stigmer#2414,
//     #2415, #2416, #2417, #2428, #2429, and the native shell's 120 s
//     timeout, #2432):
//     100-second commands that print every 20 s, nothing killed, for three
//     hours, so what it finds is what only hours show. Its tool output is
//     paced to cross the compaction trigger of its model (Claude Haiku 4.5,
//     whose library profile puts it at 170,000 tokens) three times or more.
//   - `retention` is live only: does a real model keep its goal across three
//     compactions. Its bulk reads are chained: each prints a fresh random key
//     on its last line, and the next takes that key as its argument and
//     records it in its start marker. No call can be written before the step
//     before it has run, so a model cannot paste the listed commands into one
//     call ahead of time (on 2026-10-23 Haiku 4.5 ran `goal`'s bulk reads
//     three or four to a call, their joined output cut to the runner's 30,000
//     characters, and compacted once instead of three times); an output
//     thrown away loses its key, and the report checks every key given
//     against the one printed (report.ts `stepFidelityOf`). The real-clock run
//     refuses it: its mock plays the commands literally, and a mock keeps no
//     goal to measure.
//
// Every step's shell appends `start <id>` and `end <id>` to the run's marker
// file, so the run reads which step is open from disk, never from a guess.
// The subagent's step is a shell too, which the subagent runs: on the native
// harness a subagent's work is its own tool calls, streamed into the parent,
// and a subagent whose model sat silent for minutes with nothing open would
// be a hung model call, which the stall window stops by design. Each shell
// step names its timeout, as a model raises it for a long command
// (`timeoutSecondsOf`): the native shell's default bound is 120 s.
// A held step (`server-restart`, `kill`, `drain`, `message`) waits for its
// release file, so the run replaces the server, ends the runner, or sends
// the person's message while the step is provably running. A `message` step
// is the person writing to the turn mid-tool: the run sends `text` to the
// session while the step works, replaces the server while the message still
// waits in the session's queue, and releases the step, so the turn reads
// the message at its next step, after this one's result.

/** One thing the long turn does. Seconds are wall time. */
export type LongTurnStep =
  | { readonly kind: "silent"; readonly id: string; readonly seconds: number }
  | { readonly kind: "streamed"; readonly id: string; readonly seconds: number; readonly everySeconds: number; readonly bytesPerLine: number }
  | { readonly kind: "subagent"; readonly id: string; readonly seconds: number }
  | { readonly kind: "bulk"; readonly id: string; readonly bytes: number }
  /** A bulk read that prints a key on its last line; `after` names the step whose key it takes (absent on the first). */
  | { readonly kind: "chained"; readonly id: string; readonly bytes: number; readonly after?: string }
  | { readonly kind: "server-restart"; readonly id: string }
  | { readonly kind: "kill"; readonly id: string }
  | { readonly kind: "drain"; readonly id: string }
  | { readonly kind: "message"; readonly id: string; readonly text: string };

export type LongTurnProfileName = "goal" | "endurance" | "retention";

export interface LongTurnProfile {
  readonly name: LongTurnProfileName;
  /** The model registry id the turn runs on; it decides the window compaction is measured against. */
  readonly model: string;
  readonly steps: readonly LongTurnStep[];
  /** How long the run may take before it is stopped and reported as such. */
  readonly budgetMs: number;
  /** Only a real model can play it: the real-clock run refuses it. */
  readonly liveOnly?: boolean;
}

/** The model both profiles run on: its library profile (200,000 tokens) puts compaction at 170,000. */
export const LONG_TURN_MODEL = "claude-haiku-4.5";

/** Approximate tokens per character, the summarization middleware's own counter's ratio. */
const CHARS_PER_TOKEN = 4;

/** The compaction trigger for the profile's model, and what one compaction keeps (0.1 of the window). */
const COMPACTION_TRIGGER_TOKENS = 170_000;
const COMPACTION_KEEP_TOKENS = 20_000;

/**
 * One bulk read's size: under the runner's own cut of a single tool result
 * (30,000 characters by default, `middleware/tool-truncation.ts`), so every
 * byte reaches the conversation. At 60,000 half of each read was cut, and
 * the reads the profile counted on for three compactions made one.
 */
export const BULK_BYTES = 28_000;

/** How many bulk reads cross the trigger `compactions` times, counting what each compaction keeps. */
export function bulkReadsFor(compactions: number): number {
  const tokens = COMPACTION_TRIGGER_TOKENS + (compactions - 1) * (COMPACTION_TRIGGER_TOKENS - COMPACTION_KEEP_TOKENS);
  return Math.ceil((tokens * CHARS_PER_TOKEN) / BULK_BYTES) + 1;
}

/** What the person writes to the `goal` turn mid-tool, about half an hour in. */
export const GOAL_MESSAGE = "Also add a line to NOTES.md saying the long turn ran.";

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
      { kind: "message", id: "message-mid-tool", text: GOAL_MESSAGE },
      ...bulk,
      { kind: "server-restart", id: "server-restarted-mid-tool" },
      { kind: "kill", id: "killed-mid-tool" },
      { kind: "drain", id: "drained-mid-tool" },
    ],
    budgetMs: 60 * 60_000,
  };
}

/** Where a chained step's command takes the key the step before it printed. */
export const CHAIN_KEY = "<KEY>";

/** The compactions a live run must reach for its goal to be measured (report.ts `goalVerdictOf`). */
export const RETENTION_COMPACTIONS = 3;

/** The `retention` profile: `goal`'s bulk reads, chained by key (the header), live only. */
export function retentionProfile(): LongTurnProfile {
  return {
    name: "retention",
    model: LONG_TURN_MODEL,
    steps: Array.from({ length: bulkReadsFor(RETENTION_COMPACTIONS) }, (_, i): LongTurnStep => ({
      kind: "chained",
      id: `bulk-${i + 1}`,
      bytes: BULK_BYTES,
      ...(i === 0 ? {} : { after: `bulk-${i}` }),
    })),
    budgetMs: 90 * 60_000,
    liveOnly: true,
  };
}

/**
 * Each endurance command's length, and how often it prints: under every
 * stall window known today, and under the native shell's own 120 s timeout
 * with room to spare (#2432; a first endurance run at 6 × 20 s was cut off
 * there, every step, on 2026-10-18).
 */
export const ENDURANCE_STEP_SECONDS = 100;
export const ENDURANCE_EVERY_SECONDS = 20;

/** The native shell's default bound, which a call raises with `timeout` (the runner's command runner keeps deepagents' 120 s). */
export const NATIVE_SHELL_TIMEOUT_SECONDS = 120;

/** The `endurance` profile: `minutes` of 100-second commands that print, paced for three compactions or more. */
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
  const profile =
    name === "goal" ? goalProfile() : name === "endurance" ? enduranceProfile(options.minutes ?? 180) : name === "retention" ? retentionProfile() : undefined;
  if (profile === undefined) throw new Error(`unknown profile '${name}' (goal, endurance or retention)`);
  if (options.steps === undefined || options.steps.length === 0) return profile;
  const unknown = options.steps.filter((id) => !profile.steps.some((step) => step.id === id));
  if (unknown.length > 0) throw new Error(`profile '${name}' has no step ${unknown.join(", ")}`);
  return { ...profile, steps: profile.steps.filter((step) => options.steps!.includes(step.id)) };
}

/** Where a run's step bookkeeping lives: the marker file the steps append to, the keys chained steps printed, and a held step's release file. */
export interface StepFiles {
  readonly markers: string;
  /** One `<step id> <key>` line per chained step that ran. */
  readonly keys: string;
  releaseOf(id: string): string;
}

/** Room a step's timeout leaves past its own length. */
const TIMEOUT_MARGIN_SECONDS = 120;

/** How long a held step may wait for its release: under the native shell's 55-minute ceiling. */
const HELD_TIMEOUT_SECONDS = 3_000;

/**
 * The `timeout` (seconds) a step's shell call asks for, so the command is
 * never cut off at the shell's default bound; undefined where the default
 * (120 s) is already ample.
 */
export function timeoutSecondsOf(step: LongTurnStep): number | undefined {
  switch (step.kind) {
    case "silent":
    case "streamed":
    case "subagent":
      return step.seconds + TIMEOUT_MARGIN_SECONDS;
    case "server-restart":
    case "kill":
    case "drain":
    case "message":
      return HELD_TIMEOUT_SECONDS;
    case "bulk":
    case "chained":
      return undefined;
  }
}

/** The shell command a step runs; a subagent's is the one its subagent runs. */
export function shellCommandOf(step: LongTurnStep, files: StepFiles): string {
  const start = `echo 'start ${step.id}' >> '${files.markers}'`;
  const end = `echo 'end ${step.id}' >> '${files.markers}'`;
  switch (step.kind) {
    case "silent":
    case "subagent":
      return `${start}; sleep ${step.seconds}; ${end}`;
    case "streamed": {
      const lines = Math.max(1, Math.round(step.seconds / step.everySeconds));
      const fill = step.bytesPerLine > 20 ? ` $(head -c ${step.bytesPerLine - 20} /dev/zero | tr '\\0' 'x')` : "";
      return `${start}; for i in $(seq 1 ${lines}); do echo "line $i${fill}"; sleep ${step.everySeconds}; done; ${end}`;
    }
    case "bulk":
      return `${start}; head -c ${step.bytes} /dev/zero | tr '\\0' 'b'; echo; ${end}`;
    case "chained": {
      const given = step.after === undefined ? start : `echo 'start ${step.id} ${CHAIN_KEY}' >> '${files.markers}'`;
      const key = "k=$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \\n')";
      return `${given}; head -c ${step.bytes} /dev/zero | tr '\\0' 'b'; echo; ${key}; echo "${step.id} $k" >> '${files.keys}'; ${end}; echo "next key: $k"`;
    }
    case "server-restart":
    case "kill":
    case "drain":
    case "message":
      return `${start}; while [ ! -f '${files.releaseOf(step.id)}' ]; do sleep 0.2; done; ${end}`;
  }
}

/** What the marker file says: every step that began and ended, in order, and the one still open. */
export interface StepProgress {
  readonly started: readonly string[];
  readonly ended: readonly string[];
  readonly open: string | undefined;
}

/** One line of the marker file: a step began (with the key it was given, on a chained step) or ended. */
export interface StepMarker {
  readonly mark: "start" | "end";
  readonly id: string;
  readonly key?: string;
}

/** The marker file's lines, in order; anything else in it is ignored. */
export function stepMarkersOf(markerText: string): StepMarker[] {
  return markerText.split("\n").flatMap((line): StepMarker[] => {
    const match = /^(start|end) (\S+)(?: (\S+))?$/.exec(line.trim());
    if (match === null) return [];
    return [{ mark: match[1] as StepMarker["mark"], id: match[2]!, ...(match[3] === undefined ? {} : { key: match[3] }) }];
  });
}

export function stepProgressOf(markerText: string): StepProgress {
  const started: string[] = [];
  const ended: string[] = [];
  for (const marker of stepMarkersOf(markerText)) (marker.mark === "start" ? started : ended).push(marker.id);
  const open = [...started].reverse().find((id) => started.filter((s) => s === id).length > ended.filter((e) => e === id).length);
  return { started, ended, open };
}

/** The subagent a live model hands the `subagent` step to, and the tool it hands it with. */
export interface StepHelper {
  readonly tool: string;
  readonly name: string;
  /** A built-in helper is one of a kind ("a general-purpose subagent"); a saved one is named ("the <name> subagent"). */
  readonly saved: boolean;
}

/** Native's (and Cursor's) built-in helper: `task` to `general-purpose`, the wording every live run before Claude's read. */
export const GENERAL_PURPOSE_HELPER: StepHelper = { tool: "task", name: "general-purpose", saved: false };

/**
 * The instruction a live model is given for a step: the scripted run's tool
 * call, in words. The `subagent` step names `helper`: an engine with no
 * general-purpose helper of its own (Claude) is handed a saved one, by its
 * name and its engine's tool.
 */
export function narrateStep(step: LongTurnStep, files: StepFiles, helper: StepHelper = GENERAL_PURPOSE_HELPER): string {
  const timeout = timeoutSecondsOf(step);
  const run = `Run exactly this shell command${timeout === undefined ? "" : `, with a timeout of ${timeout} seconds,`} and wait for it to finish: ${shellCommandOf(step, files)}`;
  if (step.kind === "subagent") {
    return `Hand this to ${helper.saved ? "the" : "a"} ${helper.name} subagent with the ${helper.tool} tool, and wait for its answer: "${run.replace(/"/g, "'")} Then answer in one line: done."`;
  }
  if (step.kind === "chained" && step.after !== undefined) {
    return `Run this shell command, with ${CHAIN_KEY} replaced by the key step ${step.after} printed on its last line ("next key: ..."), and wait for it to finish: ${shellCommandOf(step, files)}`;
  }
  return run;
}

/** The flags both long-turn scripts read. */
export interface LongTurnFlags {
  readonly profile: string;
  readonly minutes: number | undefined;
  readonly steps: readonly string[];
  readonly out: string | undefined;
  /** The live run's harness (`deep-agent` or `cursor`); the real-clock run is native only. */
  readonly harness: string;
  /** The live run's model, a registry id; absent, the harness's parity model. The real-clock run plays the profile's on the mock. */
  readonly model: string | undefined;
  /** The real-clock run's execution target: a server restart overlaps two servers only on `local-postgres-execution`. */
  readonly target: LongTurnTarget;
}

/** The execution targets the real-clock run boots. */
export type LongTurnTarget = "local-execution" | "local-postgres-execution";

export function parseLongTurnFlags(argv: readonly string[]): LongTurnFlags {
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const minutes = value("minutes");
  if (minutes !== undefined && !(Number(minutes) > 0)) throw new Error(`--minutes must be a positive number, not '${minutes}'`);
  const target = value("target") ?? "local-execution";
  if (target !== "local-execution" && target !== "local-postgres-execution") {
    throw new Error(`--target must be local-execution or local-postgres-execution, not '${target}'`);
  }
  return {
    profile: value("profile") ?? "goal",
    minutes: minutes === undefined ? undefined : Number(minutes),
    steps: (value("steps") ?? "").split(",").filter((s) => s !== ""),
    out: value("out"),
    harness: value("harness") ?? "deep-agent",
    model: value("model"),
    target,
  };
}
