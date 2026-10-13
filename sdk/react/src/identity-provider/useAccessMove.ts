"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import {
  AccessMoveRequestSchema,
  RedeemAccessMoveInputSchema,
  type AccessMoveResult,
  type AccessMoveTicket,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateAccessMove}. */
export interface UseCreateAccessMoveReturn {
  /** Ask for a ticket that moves the caller's access in `org` to the account its SSO provider makes for them. */
  readonly createMove: (org: string) => Promise<AccessMoveTicket>;
  readonly isCreating: boolean;
  readonly error: Error | null;
  readonly clearError: () => void;
}

/**
 * Mutation hook for the first half of an access move, asked while signed in
 * the old way (an email login): the answer is a single-use ticket, ten
 * minutes long, and what the move will do. Keep the ticket in the browser
 * that asked for it and never show it; it is redeemed with
 * {@link useRedeemAccessMove} once signed in through the organization's
 * SSO provider.
 */
export function useCreateAccessMove(): UseCreateAccessMoveReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const clearError = useCallback(() => setError(null), []);
  const createMove = useCallback(
    async (org: string): Promise<AccessMoveTicket> => {
      setIsCreating(true);
      setError(null);
      try {
        return await stigmer.identityProvider.createAccessMove(create(AccessMoveRequestSchema, { org }));
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer],
  );
  return { createMove, isCreating, error, clearError };
}

/** Return value of {@link useRedeemAccessMove}. */
export interface UseRedeemAccessMoveReturn {
  /** Redeem a ticket: the access it names moves to the caller. */
  readonly redeem: (ticket: string) => Promise<AccessMoveResult>;
  readonly isRedeeming: boolean;
  readonly error: Error | null;
  readonly clearError: () => void;
}

/**
 * Mutation hook for the second half of an access move, asked once signed
 * in through the organization's SSO provider: the ticket's access moves to
 * the caller, and the answer says what moved and what stopped (the My
 * vault entries deleted, the automations and invitations to make again).
 */
export function useRedeemAccessMove(): UseRedeemAccessMoveReturn {
  const stigmer = useStigmer();
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const clearError = useCallback(() => setError(null), []);
  const redeem = useCallback(
    async (ticket: string): Promise<AccessMoveResult> => {
      setIsRedeeming(true);
      setError(null);
      try {
        return await stigmer.identityProvider.redeemAccessMove(create(RedeemAccessMoveInputSchema, { ticket }));
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsRedeeming(false);
      }
    },
    [stigmer],
  );
  return { redeem, isRedeeming, error, clearError };
}
