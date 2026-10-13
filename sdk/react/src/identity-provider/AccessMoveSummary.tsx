"use client";

/**
 * What an access move does, or did: the access that moves to the person's
 * SSO account, the entries of their old account's My vault in the
 * organization that the move deletes (saved again afterwards), and the
 * automations and invitations that acted for the old account and stop. The
 * same view serves the preview before the move (`moved` false) and the
 * result after it, where each schedule and evaluator can be made again as
 * the new account in one click and each eval is started again from its
 * page.
 */
import { useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { MoveOrgAccessResult } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { remakeable, useRemakeAutomation } from "./useRemakeAutomation.js";

/** Props for {@link AccessMoveSummary}. */
export interface AccessMoveSummaryProps {
  /** The move's preview or result. */
  readonly move: MoveOrgAccessResult;
  /** The open invitations the old account created there. */
  readonly invitationIds: ReadonlyArray<string>;
  /** Whether the move has happened; before it, nothing is offered to make again. */
  readonly moved: boolean;
  /** Where an automation lives, for a link to it; absent, it is named without a link. */
  readonly automationHref?: (kind: string, slug: string) => string | undefined;
  readonly className?: string;
}

const KIND_NOUN: Readonly<Record<string, string>> = {
  schedule: "Schedule",
  evaluator: "Evaluator",
  plugin_eval: "Plugin eval",
  agent_eval: "Agent eval",
};

export function AccessMoveSummary({ move, invitationIds, moved, automationHref, className }: AccessMoveSummaryProps) {
  const { remake, remaking, error } = useRemakeAutomation();
  const [remade, setRemade] = useState<ReadonlySet<string>>(new Set());
  return (
    <div className={cn("stg:space-y-3 stg:text-xs", className)}>
      <p className="stg:text-foreground">
        {moved ? "Moved" : "Moves"} {move.movedPolicies} {move.movedPolicies === 1 ? "piece of access" : "pieces of access"}:
        your roles, your shares, and everything you made or own here.
      </p>

      {move.myVaultEntries.length > 0 && (
        <div>
          <p className="stg:text-foreground stg:font-medium">
            {moved ? "Deleted from" : "Deletes"} your My vault here:
          </p>
          <ul className="stg:text-muted-foreground stg:mt-1 stg:list-disc stg:pl-5">
            {move.myVaultEntries.map((entry) => (
              <li key={entry} className="stg:font-mono">
                {entry}
              </li>
            ))}
          </ul>
          <p className="stg:text-muted-foreground stg:mt-1">Save them again in your new account&apos;s My vault.</p>
        </div>
      )}

      {move.automations.length > 0 && (
        <div>
          <p className="stg:text-foreground stg:font-medium">
            {moved ? "Stopped" : "Stops"}: these run as your old account.
          </p>
          <ul className={cn(UNSTYLED_LIST, "stg:mt-1 stg:space-y-1")}>
            {move.automations.map((automation) => {
              const href = automationHref?.(automation.kind, automation.slug);
              const label = `${KIND_NOUN[automation.kind] ?? automation.kind}: ${automation.name || automation.slug || automation.id}`;
              return (
                <li key={automation.id} className="stg:flex stg:items-center stg:justify-between stg:gap-2">
                  {href === undefined ? (
                    <span className="stg:text-muted-foreground">{label}</span>
                  ) : (
                    <a href={href} className="stg:text-primary stg:hover:underline">
                      {label}
                    </a>
                  )}
                  {moved && remakeable(automation) && remade.has(automation.id) && (
                    <span className="stg:text-muted-foreground stg:shrink-0">Made again as you</span>
                  )}
                  {moved && remakeable(automation) && !remade.has(automation.id) && (
                    <button
                      type="button"
                      disabled={remaking !== null}
                      onClick={() =>
                        void remake(automation).then(
                          () => setRemade((held) => new Set([...held, automation.id])),
                          // The hook holds the error, shown below the list.
                          () => undefined,
                        )
                      }
                      className="stg:text-primary stg:hover:text-foreground stg:shrink-0 stg:font-medium stg:disabled:opacity-50"
                    >
                      {remaking === automation.id ? "Making it again…" : "Make it again as me"}
                    </button>
                  )}
                  {moved && !remakeable(automation) && (
                    <span className="stg:text-muted-foreground stg:shrink-0">Start it again from its page</span>
                  )}
                </li>
              );
            })}
          </ul>
          {error && (
            <p role="alert" className="stg:text-destructive stg:mt-1">
              {getUserMessage(error)}
            </p>
          )}
        </div>
      )}

      {invitationIds.length > 0 && (
        <p className="stg:text-muted-foreground">
          {invitationIds.length === 1 ? "An invitation" : `${invitationIds.length} invitations`} you created here{" "}
          {moved ? "stopped" : "stop"} working. Create {invitationIds.length === 1 ? "it" : "them"} again once you have moved.
        </p>
      )}
    </div>
  );
}
