"use client";

/**
 * "Make it again as me": an automation that acts as the account that
 * created it (a schedule fires as its creator, an evaluator's judge grades
 * as its creator) stops once that account no longer counts in the
 * organization, after an access move or under a sign-in requirement. Its
 * creator is a stamp nothing changes, so the only way to have it act as the
 * person's new account is a new row that account creates. Their access
 * moved with them, so they may read, create and delete it.
 *
 *   - a schedule: a copy is created under a temporary slug, the old one is
 *     deleted, and the copy takes the old slug back, so links to it keep
 *     working. A failure after the copy exists leaves both; the copy keeps
 *     its temporary slug and the old one stays paused;
 *   - an evaluator: an agent has one, so the old one is deleted and the
 *     copy created. A failure between the two leaves the agent with no
 *     evaluator, which the error says, and the agent's page makes again.
 *
 * Plugin and agent evals are runs: they are made again by starting a new
 * eval on the plugin's or agent's page, which `remakeable` answers false
 * for.
 */
import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { RenameInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { AccountAutomation } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { toEvaluatorInput, toScheduleInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** The kinds made again in one click; the rest are made again from their parent's page. */
const REMAKEABLE: ReadonlySet<string> = new Set(["schedule", "evaluator"]);

/** Whether `automation` is made again in one click. */
export function remakeable(automation: Pick<AccountAutomation, "kind">): boolean {
  return REMAKEABLE.has(automation.kind);
}

/** Return value of {@link useRemakeAutomation}. */
export interface UseRemakeAutomationReturn {
  /** Make the automation again as the caller; resolves with the new row's id. */
  readonly remake: (automation: AccountAutomation) => Promise<string>;
  /** The id of the automation being made again, or `null`. */
  readonly remaking: string | null;
  readonly error: Error | null;
}

export function useRemakeAutomation(): UseRemakeAutomationReturn {
  const stigmer = useStigmer();
  const [remaking, setRemaking] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const remake = useCallback(
    async (automation: AccountAutomation): Promise<string> => {
      setRemaking(automation.id);
      setError(null);
      try {
        switch (automation.kind) {
          case "schedule": {
            const old = await stigmer.schedule.get(automation.id);
            const slug = old.metadata?.slug ?? "";
            const copy = await stigmer.schedule.create({
              ...toScheduleInput(old),
              id: undefined,
              slug: `${slug}-${Date.now().toString(36)}`.slice(0, 63),
            });
            await stigmer.schedule.delete(automation.id);
            const id = copy.metadata?.id ?? "";
            if (slug !== "") {
              await stigmer.schedule.rename(create(RenameInputSchema, { resourceId: id, slug }));
            }
            return id;
          }
          case "evaluator": {
            const old = await stigmer.evaluator.get(automation.id);
            await stigmer.evaluator.delete(automation.id);
            const copy = await stigmer.evaluator.create({ ...toEvaluatorInput(old), id: undefined });
            return copy.metadata?.id ?? "";
          }
          default:
            throw new Error(`a ${automation.kind} is made again from its parent's page`);
        }
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setRemaking(null);
      }
    },
    [stigmer],
  );

  return { remake, remaking, error };
}
