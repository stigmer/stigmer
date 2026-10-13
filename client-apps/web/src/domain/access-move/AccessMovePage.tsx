"use client";

/**
 * The access move's first half, opened while signed in the old way (an
 * email login) from an SSO_REQUIRED refusal: `/sso/move?org=<organization id>`.
 *
 * It asks for the move's ticket, shows what the move will do (the access
 * that moves, the My vault entries it deletes, what stops), and on the
 * person's word keeps the ticket in this tab and sends them to the
 * organization's SSO provider, landing on the second half
 * (`/sso/move/finish`, AccessMoveFinishPage). The ticket is asked for once
 * per visit; a refused ask (an owner, nothing to move, no SSO provider)
 * says why.
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getUserMessage } from "@stigmer/sdk";
import { AccessMoveSummary, useCreateAccessMove } from "@stigmer/react";
import type { AccessMoveTicket } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { startSsoLogin } from "@/auth/oidc/start-sso-login";
import { Button } from "@/domain/_shared/ui/button";
import { savePendingMove } from "./move-ticket";

/** Where the provider's sign-in lands to finish the move. */
export const FINISH_PATH = "/sso/move/finish";

export function AccessMovePage() {
  const org = useSearchParams().get("org") ?? "";
  const { createMove, isCreating, error } = useCreateAccessMove();
  const [ticket, setTicket] = useState<AccessMoveTicket | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (org === "" || asked.current) return;
    asked.current = true;
    createMove(org).then(setTicket, () => undefined);
  }, [org, createMove]);

  const provider = ticket?.provider;

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-10">
      <h1 className="text-lg font-semibold">Bring your access with you</h1>
      {org === "" ? (
        <p className="text-muted-foreground text-sm">
          No organization was named.
        </p>
      ) : error ? (
        <p role="alert" className="text-destructive text-sm">
          {getUserMessage(error)}
        </p>
      ) : isCreating || ticket === null ? (
        <p className="text-muted-foreground text-sm">Working out what moves…</p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            This organization requires sign-in through {provider?.displayName}.
            Sign in through it once and everything you have here moves to that
            account. Your other organizations are not touched.
          </p>
          {ticket.preview && (
            <AccessMoveSummary
              move={ticket.preview}
              invitationIds={ticket.invitationIds}
              moved={false}
            />
          )}
          {provider && (
            <Button
              onClick={() => {
                savePendingMove({ ticket: ticket.ticket, org: ticket.org });
                void startSsoLogin(provider, ticket.org, FINISH_PATH);
              }}
            >
              Continue with {provider.displayName}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
