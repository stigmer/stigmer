"use client";

// How the session view wires its last turn's ending notice: who reads it,
// the names its model resolves to, and the act and the link this reader is
// offered. The words are `describeTurnEnding`'s (@stigmer/client); this
// hook decides only what each act does and where each link goes.
//
// - Run again and Resume on a FAILED turn recover the run: the same turn
//   picks up where it stopped, steps that worked are not run again, and the
//   thread shows no second copy of the message. Recover needs `can_edit` on
//   the run, so the permission is asked first: a reader who may send but not
//   recover (a participant) is offered the plain re-send, "Send it again";
//   one who can do neither is offered nothing.
// - Continue (a budget stop, a person's stop) sends "Continue" as the next
//   message, as the runner's own copy asks; recover refuses those runs.
// - Run again after the platform's stop re-sends the turn's message.
// - Choose another model opens the composer's model picker: a recover would
//   ask the same model and fail the same way.
// - A link shows only to a reader who can act on it (an admin for a key, a
//   member for the agent); a provider with no billing or status page in the
//   kit's table gets none.

import { useCallback, useMemo, type RefObject } from "react";
import type { Turn, TurnEnding, TurnEndingNames, TurnEndingViewer } from "@stigmer/client";
import { useRunActions } from "@stigmer/react-core";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { useModelRegistry } from "../models/useModelRegistry.js";
import { presentationOf } from "../models/provider-presentation.js";
import type { RunErrorNoticeLink } from "../run/RunErrorNotice.js";
import type { TurnEndingAction, TurnEndingWiring } from "../run/ThreadPresentationContext.js";

/** The agent a session runs, as `agentHref` takes it. */
export interface SessionAgentRef {
  readonly org: string;
  readonly slug: string;
}

/** What the wiring reads from the session view. */
export interface TurnEndingWiringInput {
  /** The session's newest turn. */
  readonly lastTurn: Turn | undefined;
  /** The organization the session runs in. */
  readonly orgId: string;
  /** May send a message at all: the owners and a participant. */
  readonly canSend: boolean;
  /** Answers what the turn waits on: the owners (a person's stop reads as theirs). */
  readonly decides: boolean;
  /** Sends a message through the full submit pipeline. */
  readonly send: (message: string) => void;
  /** The turn's own message, when it has one to send again. */
  readonly retryMessage: string | undefined;
  /** Where Models & providers is. */
  readonly modelsHubHref: string;
  /** Where the agent's page is, for the agent the session runs; undefined for no link. */
  readonly agentHref?: string;
  /** The column the composer sits in, where the model picker is found. */
  readonly columnRef: RefObject<HTMLElement | null>;
}

/** The ending acts that recover the run. */
const RECOVERS: ReadonlySet<TurnEnding["act"]> = new Set(["run_again", "resume"]);

/** The kinds whose fix is a key: only an admin follows their link. */
const KEY_KINDS: ReadonlySet<string> = new Set(["provider_key_rejected", "provider_key_missing", "provider_out_of_credit"]);

/** The session view's ending wiring (module header), and a refused recover's error. */
export function useTurnEndingWiring(input: TurnEndingWiringInput): { readonly wiring: TurnEndingWiring; readonly error: Error | null; readonly clearError: () => void } {
  const { lastTurn, orgId, canSend, decides, send, retryMessage, modelsHubHref, agentHref, columnRef } = input;
  const ended = lastTurn?.ended === true;
  const failed = ended && lastTurn?.status?.phase === "failed";
  const kind = lastTurn?.status?.stopDetail?.kind ?? "";
  const runId = lastTurn?.runId ?? "";

  // Asked only when the answer changes what shows: a failed turn's recover,
  // a key's fix.
  const recoverable = useCheckPermission(failed && canSend && runId !== "" ? { kind: "run", id: runId } : null, "can_edit", { fail: "closed" });
  const managesKeys = useCheckPermission(failed && KEY_KINDS.has(kind) && orgId !== "" ? { kind: "organization", id: orgId } : null, "can_manage_billing", {
    fail: "closed",
  });
  const actions = useRunActions(failed ? runId : null);
  const { getModel } = useModelRegistry();

  const viewer = useMemo<TurnEndingViewer>(
    () => ({ canManageProviders: managesKeys.allowed, canOpenAgent: canSend && agentHref !== undefined, canAct: canSend, stoppedIt: decides }),
    [managesKeys.allowed, canSend, agentHref, decides],
  );

  const names = useCallback(
    (model: string): TurnEndingNames => {
      const info = getModel(model);
      return info === undefined ? {} : { provider: presentationOf(info.provider).name, model: info.displayName };
    },
    [getModel],
  );

  const { recover } = actions;
  const actOf = useCallback(
    (ending: TurnEnding): TurnEndingAction | undefined => {
      switch (ending.act) {
        case "run_again":
        case "resume":
          if (RECOVERS.has(ending.act) && recoverable.allowed) {
            return { label: ending.act === "resume" ? "Resume" : "Run again", run: () => void recover() };
          }
          return retryMessage === undefined ? undefined : { label: "Send it again", run: () => send(retryMessage) };
        case "continue":
          return { label: "Continue", run: () => send("Continue") };
        case "rerun":
          return retryMessage === undefined ? undefined : { label: "Run again", run: () => send(retryMessage) };
        case "choose_model":
          return { label: "Choose another model", run: () => columnRef.current?.querySelector<HTMLElement>("[data-model-picker]")?.click() };
        case "none":
          return undefined;
      }
    },
    [recoverable.allowed, recover, retryMessage, send, columnRef],
  );

  const linkOf = useCallback(
    (ending: TurnEnding, turn: Turn): RunErrorNoticeLink | undefined => {
      const model = turn.status?.stopDetail?.model ?? "";
      const provider = model === "" ? undefined : getModel(model)?.provider;
      const presentation = provider === undefined ? undefined : presentationOf(provider);
      switch (ending.link) {
        case "models_hub":
          return { label: "Open Models & providers", href: modelsHubHref };
        case "agent":
          return agentHref === undefined ? undefined : { label: "Open the agent", href: agentHref };
        case "provider_billing":
          return presentation?.billingUrl == null ? undefined : { label: `Open ${presentation.name} billing`, href: presentation.billingUrl, external: true };
        case "provider_status":
          return presentation?.statusUrl == null ? undefined : { label: `${presentation.name}'s status page`, href: presentation.statusUrl, external: true };
        case "none":
          return undefined;
      }
    },
    [getModel, modelsHubHref, agentHref],
  );

  const wiring = useMemo<TurnEndingWiring>(
    () => ({ viewer, names, actOf, linkOf, acting: actions.isSubmitting }),
    [viewer, names, actOf, linkOf, actions.isSubmitting],
  );
  return { wiring, error: actions.error, clearError: actions.clearError };
}
