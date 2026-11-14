// How an ended turn that didn't finish reads: one sentence on what
// happened, one that comforts (what wasn't lost, or who can fix it), the
// word the session's status pill says, the note the plan's stopped to-do
// takes, the one act that picks the turn back up, and at most one link to
// the fix. Every surface that tells a person a turn went wrong reads this
// one table, so the notice under the turn and the pill above it cannot
// disagree.
//
// It reads only what a session's events fold into a turn
// (@stigmer/session-log): the turn's phase, its stop cause, and the stop
// detail the runner names beside it (`StigmerStopDetail`: a refused key, a
// spending cap, a connected app that wouldn't connect, with the model or app
// it names). The error's text is never read for meaning: it stays the
// details a person copies for support.
//
// Trade-offs:
// - Words, not markup or addresses: the act and the link are identifiers
//   (`run_again`, `models_hub`), and the surface owns what each does and
//   where it points, so a terminal can adopt the same words.
// - The provider and the model are names the caller resolves from the
//   detail's model id (the React kit's model registry); unknown, they read
//   "the model provider" and "this model".
// - The error's text is quoted once: an agent that can't run as it is set up
//   fails with the runner's own sentence for a person (its actionable
//   surface), which the comfort leads with.
// - What a turn finished is counted from its own to-do list
//   (`turnSteps`), never guessed from its steps: "2 of 5 to-dos are done".
// - A turn the runner named no kind for (an older runner, a desktop app's
//   local runner not yet updated) reads one generic sentence per stop cause.
// - Who reads decides the comfort: one who can fix the cause (an admin for a
//   key, a member for the agent) is told how; anyone else is told that
//   nothing was lost and, where it helps, who can fix it.

import type { Turn } from "@stigmer/session-log";
import { turnSteps } from "./turn-steps.js";

/** How the ending reads at a glance: red didn't finish, amber paused at a limit or interrupted, grey stopped. */
export type TurnEndingTone = "failed" | "paused" | "stopped";

/**
 * The one act that picks the turn back up. `run_again` and `resume` pick a
 * FAILED turn up where it stopped (the run's recover); `continue` sends
 * "Continue" as the person's next message; `rerun` sends the turn's message
 * again; `choose_model` opens the composer's model picker; `none` offers no
 * act, because doing the same again would fail the same way.
 */
export type TurnEndingAct = "run_again" | "resume" | "continue" | "rerun" | "choose_model" | "none";

/** Where the fix lives: the organization's models page, the agent's page, the provider's billing or status page, or nowhere. */
export type TurnEndingLink = "models_hub" | "agent" | "provider_billing" | "provider_status" | "none";

/** Who reads the ending, as the comfort and the link need it. */
export interface TurnEndingViewer {
  /** May manage the organization's model keys (an admin). */
  readonly canManageProviders: boolean;
  /** May open the agent that ran the turn (a member). */
  readonly canOpenAgent: boolean;
  /** May take the turn's act at all (recover or send); a reader may not. */
  readonly canAct: boolean;
  /** Stopped this turn themself. */
  readonly stoppedIt: boolean;
}

/** The names the detail's model id resolves to; absent when the caller doesn't know it. */
export interface TurnEndingNames {
  /** The provider's display name ("Anthropic"). */
  readonly provider?: string;
  /** The model's display name ("Claude Sonnet 4.6"). */
  readonly model?: string;
}

/** An ended turn's words (module header). */
export interface TurnEnding {
  readonly tone: TurnEndingTone;
  /** The status pill's words. */
  readonly pill: string;
  readonly headline: string;
  readonly comfort: string;
  /** The note under the plan's to-do the turn stopped on ("Stopped here"). */
  readonly stepNote: string;
  /** The act this viewer is offered; `none` for a reader. */
  readonly act: TurnEndingAct;
  /** The link this viewer is offered; `none` for one who can't act on it. */
  readonly link: TurnEndingLink;
  /** The stop detail's kind, or the stop cause when the runner named none: what Copy details names. */
  readonly kind: string;
}

/** The words for one way a turn ends, with the placeholders `{provider}`, `{model}`, `{app}` and `{done}`. */
interface Entry {
  readonly tone: TurnEndingTone;
  readonly pill: string;
  readonly headline: string;
  /** The comfort for one who can fix the cause and act. */
  readonly fixer: string;
  /** The comfort for anyone else. */
  readonly reader: string;
  readonly act: TurnEndingAct;
  readonly link: TurnEndingLink;
  /** Who can follow the link and take the fixer's comfort: an admin for a key, a member for the agent, anyone who can act. */
  readonly fixedBy: "admin" | "member" | "actor";
  readonly stepNote: string;
}

const DIDNT_FINISH = "Didn't finish";
const LOST_NOTHING = "Nothing was lost: your message is still here.";
const KEPT = "What it finished is kept{done}.";

/** One entry per stop kind the runner names (`StigmerStopDetail.kind`), in the order of the wire's list. */
const BY_KIND: Readonly<Record<string, Entry>> = {
  provider_key_rejected: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "{Provider} refused this organization's model key.",
    fixer: "The key on Models & providers isn't valid any more. Replace it, then Run again: the turn picks up where it stopped, and your message isn't sent twice. Nothing was lost.",
    reader: `The key on Models & providers isn't valid any more, and only an admin can replace it. ${LOST_NOTHING} Ask an admin of this organization to replace it.`,
    act: "run_again",
    link: "models_hub",
    fixedBy: "admin",
    stepNote: "Stopped here",
  },
  provider_key_missing: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "This organization has no {provider} key.",
    fixer: `Add one on Models & providers, then Run again. ${LOST_NOTHING}`,
    reader: `Only an admin can add one. ${LOST_NOTHING} Ask an admin of this organization to add it.`,
    act: "run_again",
    link: "models_hub",
    fixedBy: "admin",
    stepNote: "Stopped here",
  },
  provider_out_of_credit: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "Your {provider} account has no credit left.",
    fixer: "The key works, but {provider} won't run the model until the account has credit. Add some, then Run again: the turn picks up where it stopped. Nothing was lost.",
    reader: `{Provider} won't run the model until the organization's account has credit. ${LOST_NOTHING}`,
    act: "run_again",
    link: "provider_billing",
    fixedBy: "admin",
    stepNote: "Stopped here",
  },
  provider_rate_limited: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "{Provider} was too busy to answer.",
    fixer: "This is on {provider}'s side and usually passes within minutes. Nothing was lost; Run again picks up where it stopped.",
    reader: `This is on {provider}'s side and usually passes within minutes. ${LOST_NOTHING}`,
    act: "run_again",
    link: "provider_status",
    fixedBy: "actor",
    stepNote: "Stopped here",
  },
  provider_overloaded: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "{Provider} was too busy to answer.",
    fixer: "This is on {provider}'s side and usually passes within minutes. Nothing was lost; Run again picks up where it stopped.",
    reader: `This is on {provider}'s side and usually passes within minutes. ${LOST_NOTHING}`,
    act: "run_again",
    link: "provider_status",
    fixedBy: "actor",
    stepNote: "Stopped here",
  },
  model_unavailable: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "This key can't use {model}.",
    fixer: "{Provider} says the model isn't available to this account. Choose another model, then send your message again. Nothing was lost.",
    reader: `{Provider} says the model isn't available to this account. ${LOST_NOTHING}`,
    act: "choose_model",
    link: "none",
    fixedBy: "actor",
    stepNote: "Stopped here",
  },
  provider_unreachable: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "Stigmer couldn't reach {provider}.",
    fixer: "The connection dropped before {provider} answered. Nothing was lost; Run again picks up where it stopped.",
    reader: `The connection dropped before {provider} answered. ${LOST_NOTHING}`,
    act: "run_again",
    link: "provider_status",
    fixedBy: "actor",
    stepNote: "Stopped here",
  },
  request_rejected: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "{Provider} refused this request.",
    fixer:
      "The conversation is too long for the model, or the request isn't one it accepts. Running it again would fail the same way: start a new session or send something shorter. Nothing was lost.",
    reader: `The conversation is too long for the model, or the request isn't one it accepts. ${LOST_NOTHING}`,
    act: "none",
    link: "none",
    fixedBy: "actor",
    stepNote: "Stopped here",
  },
  cost_cap: {
    tone: "paused",
    pill: "Paused at its spending cap",
    headline: "This turn reached its spending cap.",
    fixer: `${KEPT} Continue sends "Continue" as your next message, and it carries on with a fresh budget. The cap is on the agent's page.`,
    reader: KEPT,
    act: "continue",
    link: "agent",
    fixedBy: "actor",
    stepNote: "Paused here",
  },
  tool_call_limit: {
    tone: "paused",
    pill: "Paused at its step limit",
    headline: "This turn reached its step limit.",
    fixer: `Agents pause after so many tool calls in one turn, so a loop can't run forever. ${KEPT} Continue sends "Continue" and it carries on.`,
    reader: `Agents pause after so many tool calls in one turn, so a loop can't run forever. ${KEPT}`,
    act: "continue",
    link: "agent",
    fixedBy: "actor",
    stepNote: "Paused here",
  },
  stalled: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "The turn stalled and was stopped.",
    fixer: "Its last step stopped making progress. Everything before it is kept: Resume picks up there, and steps that worked aren't run again.",
    reader: "Its last step stopped making progress. Everything before it is kept.",
    act: "resume",
    link: "none",
    fixedBy: "actor",
    stepNote: "Stalled here",
  },
  operation_limit: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "This turn hit its time limit.",
    fixer:
      "One step ran longer than a turn may, so it was stopped while it worked. Everything before it is kept: Resume picks up there, and steps that worked aren't run again.",
    reader: "One step ran longer than a turn may, so it was stopped while it worked. Everything before it is kept.",
    act: "resume",
    link: "none",
    fixedBy: "actor",
    stepNote: "Stopped here",
  },
  workspace_busy: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "Another turn of this session held the workspace.",
    fixer: "This turn waited for its files and gave up before it started. Nothing was lost; Resume once the other turn has finished.",
    reader: "This turn waited for its files and gave up before it started. Nothing was lost.",
    act: "resume",
    link: "none",
    fixedBy: "actor",
    stepNote: "Stopped here",
  },
  agent_setup: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "This agent can't run as it's set up.",
    fixer: "{error} Change the agent, then Run again. Nothing was lost.",
    reader: `${LOST_NOTHING} Its owner can fix the agent.`,
    act: "run_again",
    link: "agent",
    fixedBy: "member",
    stepNote: "Stopped here",
  },
  app_unreachable: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "The {app} app wouldn't connect.",
    fixer: `The agent needs it and couldn't reach it, so the turn stopped before it began. Check the app on the agent's page, then Run again. ${LOST_NOTHING}`,
    reader: `The agent needs it and couldn't reach it, so the turn stopped before it began. ${LOST_NOTHING}`,
    act: "run_again",
    link: "agent",
    fixedBy: "member",
    stepNote: "Stopped here",
  },
  app_needs_sign_in: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "The {app} app needs a new sign-in.",
    fixer: `The agent couldn't use it because its sign-in has expired. Sign in again on the agent's page, then Run again. ${LOST_NOTHING}`,
    reader: `The agent couldn't use it because its sign-in has expired. ${LOST_NOTHING}`,
    act: "run_again",
    link: "agent",
    fixedBy: "member",
    stepNote: "Stopped here",
  },
  internal: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "Something broke on Stigmer's side.",
    fixer: "It wasn't anything you did, and what the agent finished is kept. Run again picks up where it stopped; if it happens twice, copy the details for support.",
    reader: "It wasn't anything you did, and what the agent finished is kept.",
    act: "run_again",
    link: "none",
    fixedBy: "actor",
    stepNote: "Stopped here",
  },
  runner_lost: {
    tone: "paused",
    pill: "Interrupted",
    headline: "The turn was interrupted when the machine running it stopped.",
    fixer: "It kept its place. Resume picks up after the last finished step: steps that worked aren't run again, and your message isn't sent twice.",
    reader: "It kept its place.",
    act: "resume",
    link: "none",
    fixedBy: "actor",
    stepNote: "Interrupted here",
  },
  no_sandbox_room: {
    tone: "failed",
    pill: "Didn't start",
    headline: "Every sandbox was busy, so this turn didn't start.",
    fixer: `${LOST_NOTHING} Run again waits for room again.`,
    reader: LOST_NOTHING,
    act: "run_again",
    link: "none",
    fixedBy: "actor",
    stepNote: "Didn't start",
  },
};

/** One entry per stop cause, for a turn the runner named no kind for, and the stops whose cause says it all. */
const BY_CAUSE: Readonly<Record<string, Entry>> = {
  model_error: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "The model provider didn't finish this turn.",
    fixer: "It failed on the provider's side, and Stigmer wasn't told why. Nothing was lost; Run again picks up where it stopped.",
    reader: `It failed on the provider's side. ${LOST_NOTHING}`,
    act: "run_again",
    link: "none",
    fixedBy: "actor",
    stepNote: "Stopped here",
  },
  failed: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "This turn didn't finish.",
    fixer: "Something stopped it before it was done, and Stigmer wasn't told why. Nothing was lost; Run again picks up where it stopped. If it happens twice, copy the details for support.",
    reader: `Something stopped it before it was done. ${LOST_NOTHING}`,
    act: "run_again",
    link: "none",
    fixedBy: "actor",
    stepNote: "Stopped here",
  },
  timeout: {
    tone: "failed",
    pill: DIDNT_FINISH,
    headline: "The turn ran out of time and was stopped.",
    fixer: "Everything before it is kept: Resume picks up there, and steps that worked aren't run again.",
    reader: "Everything before it is kept.",
    act: "resume",
    link: "none",
    fixedBy: "actor",
    stepNote: "Stopped here",
  },
  budget_reached: {
    tone: "paused",
    pill: "Paused at a limit",
    headline: "This turn reached one of its limits.",
    fixer: `${KEPT} Continue sends "Continue" as your next message, and it carries on. The limits are on the agent's page.`,
    reader: KEPT,
    act: "continue",
    link: "agent",
    fixedBy: "actor",
    stepNote: "Paused here",
  },
  infrastructure: BY_KIND["runner_lost"]!,
  user: {
    tone: "stopped",
    pill: "Stopped",
    headline: "This turn was stopped.",
    fixer: `${KEPT} Continue sends "Continue" as your next message, and it carries on from here.`,
    reader: KEPT,
    act: "continue",
    link: "none",
    fixedBy: "actor",
    stepNote: "Stopped here",
  },
  platform_stop: {
    tone: "stopped",
    pill: "Stopped by Stigmer",
    headline: "Stigmer stopped this turn.",
    fixer: "It wasn't the agent and it wasn't you. What it finished is kept; run it again when you're ready. If it can't run, sending will say why.",
    reader: "It wasn't the agent and it wasn't you. What it finished is kept.",
    act: "rerun",
    link: "none",
    fixedBy: "actor",
    stepNote: "Stopped here",
  },
};

/** A person's own stop, read by the person who stopped it. */
const STOPPED_BY_YOU: Pick<Entry, "pill" | "headline"> = { pill: "Stopped by you", headline: "You stopped this turn." };

/** Stop causes whose own surface tells the ending (an eval's try, a file review's settlement): no notice. */
const QUIET_CAUSES: ReadonlySet<string> = new Set(["eval_stopped", "review_resolved"]);

/** What an ending reads when the caller asks: the turn, who reads it, and the names its model resolves to. */
export interface DescribeTurnEndingInput {
  readonly turn: Turn;
  readonly viewer: TurnEndingViewer;
  readonly names?: TurnEndingNames;
}

/**
 * How `turn` ended, in words (module header); undefined while it works, when
 * it finished on its own, and for an ending its own surface tells.
 */
export function describeTurnEnding({ turn, viewer, names = {} }: DescribeTurnEndingInput): TurnEnding | undefined {
  const status = turn.status;
  if (!turn.ended || status === undefined) return undefined;
  const cause = status.stopCause;
  if (QUIET_CAUSES.has(cause)) return undefined;
  const kind = status.stopDetail?.kind ?? "";
  const entry = entryOf(status.phase, cause, kind);
  if (entry === undefined) return undefined;
  const ownStop = cause === "user" || (status.phase === "cancelled" && cause === "") ? viewer.stoppedIt : false;
  const canFix = viewer.canAct && (entry.fixedBy === "admin" ? viewer.canManageProviders : entry.fixedBy === "member" ? viewer.canOpenAgent : true);
  const fill = filler(turn, names, status.stopDetail?.app ?? "");
  return {
    tone: entry.tone,
    pill: ownStop ? STOPPED_BY_YOU.pill : entry.pill,
    headline: fill(ownStop ? STOPPED_BY_YOU.headline : entry.headline),
    comfort: fill(canFix ? entry.fixer : entry.reader),
    stepNote: entry.stepNote,
    act: viewer.canAct ? entry.act : "none",
    link: canFix ? entry.link : "none",
    kind: kind !== "" ? kind : cause,
  };
}

/** The entry for an ending: its kind's, else its cause's, else its phase's. */
function entryOf(phase: string, cause: string, kind: string): Entry | undefined {
  const byKind = BY_KIND[kind];
  if (byKind !== undefined) return byKind;
  const byCause = BY_CAUSE[cause];
  if (byCause !== undefined) return byCause;
  if (phase === "failed") return BY_CAUSE["failed"];
  // A cancel or a termination no cause explains is a stop (an operator's terminate, a run older than causes).
  if (phase === "cancelled" || phase === "terminated") return BY_CAUSE["user"];
  return undefined;
}

/** Fills a sentence's placeholders from the turn and its names. */
function filler(turn: Turn, names: TurnEndingNames, app: string): (text: string) => string {
  // The agent's setup failure is a person's sentence already (the runner's
  // actionable surface): the one error the comfort quotes.
  const error = (turn.status?.error ?? "").trim();
  const provider = names.provider ?? "the model provider";
  const model = names.model ?? "this model";
  const done = doneOf(turn);
  return (text) =>
    text
      .replaceAll("{Provider}", capitalized(provider))
      .replaceAll("{provider}", provider)
      .replaceAll("{model}", model)
      .replaceAll("{app}", app === "" ? "connected" : app)
      .replaceAll("{done}", done)
      .replaceAll("{error}", error);
}

/** What the turn finished, from its own to-do list: ": 2 of 5 to-dos are done", or nothing with no list. */
function doneOf(turn: Turn): string {
  const plan = turnSteps(turn).plan;
  if (plan.length === 0) return "";
  const done = plan.filter((item) => item.todo.status === "completed").length;
  return `: ${done} of ${plan.length} to-dos are done`;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
