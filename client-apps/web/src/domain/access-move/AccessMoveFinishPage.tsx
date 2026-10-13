"use client";

/**
 * The access move's second half: the organization's SSO provider signed the
 * person in and landed here. It redeems the ticket the first half kept in
 * this tab, and shows what moved and what to make again. A refused redeem
 * (signed in as someone the provider did not make, a ticket that expired)
 * says why and drops the ticket, since a new move starts from the refusal
 * again. A redeem the server failed partway keeps the ticket and offers to
 * try again: the same ticket finishes the move while it lasts, and only a
 * finished move deletes the old account's My vault there.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getUserMessage, isRetryableError } from "@stigmer/sdk";
import { AccessMoveSummary, useRedeemAccessMove } from "@stigmer/react";
import type { AccessMoveResult } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { clearPendingMove, readPendingMove } from "./move-ticket";

export function AccessMoveFinishPage() {
  const { redeem, isRedeeming, error } = useRedeemAccessMove();
  const [result, setResult] = useState<AccessMoveResult | null>(null);
  const [missing, setMissing] = useState(false);
  const asked = useRef(false);

  const finish = useCallback(() => {
    const pending = readPendingMove();
    if (pending === null) {
      setMissing(true);
      return;
    }
    redeem(pending.ticket).then(
      (answer) => {
        clearPendingMove();
        setResult(answer);
      },
      (failure: unknown) => {
        // The hook holds the error, shown below; a refusal ends the ticket.
        if (!isRetryableError(failure)) clearPendingMove();
      },
    );
  }, [redeem]);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    finish();
  }, [finish]);

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-10">
      <h1 className="text-lg font-semibold">Bring your access with you</h1>
      {missing ? (
        <p className="text-muted-foreground text-sm">
          There is no move to finish in this tab. Start it again from the
          organization&apos;s sign-in notice.
        </p>
      ) : error && !isRedeeming ? (
        <div className="space-y-3">
          <p role="alert" className="text-destructive text-sm">
            {getUserMessage(error)}
          </p>
          {isRetryableError(error) && (
            <button
              type="button"
              onClick={finish}
              className="text-primary text-sm font-medium hover:underline"
            >
              Try again
            </button>
          )}
        </div>
      ) : isRedeeming || result === null ? (
        <p className="text-muted-foreground text-sm">Moving your access…</p>
      ) : (
        <>
          <p className="text-sm">
            Your access moved to the account you just signed in with.
          </p>
          {result.moved && (
            <AccessMoveSummary
              move={result.moved}
              invitationIds={result.invitationIds}
              moved
            />
          )}
          <Link
            href="/"
            className="text-primary text-sm font-medium hover:underline"
          >
            Go to the dashboard
          </Link>
        </>
      )}
    </div>
  );
}
