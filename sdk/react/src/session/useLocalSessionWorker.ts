"use client";

import { useEffect, useMemo } from "react";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { useWhoAmI } from "../iam-policy/useWhoAmI.js";
import { useRunnerAdapter } from "../runner-adapter.js";
import { useExecutionTarget } from "../execution-target-context.js";
import { fromProtoExecutionTarget } from "./execution-target.js";

/**
 * Drives the local runner worker lifecycle for an open session.
 *
 * A `Session` is a long-lived, multi-turn conversation with **no terminal
 * phase** — its runner worker must keep polling the session task queue for as
 * long as the session is open, because `sendFollowUp` creates new executions
 * without re-attaching a worker. The lifecycle is therefore
 * **attach-on-open / detach-on-close**: attach when the session is opened
 * (this hook mounts with a loaded, local session and an adapter present),
 * detach when it is closed (unmount or `sessionId` change). This also closes
 * the "re-opening an existing session leaves its task queue without a poller"
 * gap that previously made follow-ups silently hang.
 *
 * Wired once from {@link useSessionConversation} so every consumer — web,
 * desktop, Ink/terminal, and custom headless hosts — gets the behavior for
 * free. It is a no-op unless a `runnerAdapter` is configured **and** the
 * session resolves to local execution (cloud sessions are server-provisioned).
 *
 * **Only the session's own person serves it.** Anyone a session is shared
 * with can open it, and every desktop that attached would poll the same
 * queue, each turn going to whichever worker asks first. A server with
 * sign-in credentials a local session's runner for the person who created
 * the session, so another viewer's desktop would take turns it cannot run
 * (or, where it could, run someone else's turn on its own machine). The
 * worker is therefore kept off exactly when the signed-in account is known
 * and is not the session's creator — the creator stamp read the two ways
 * the server reads it, as the account id and as the account's identity
 * provider subject. Every other case attaches as before: while the account
 * is loading the attach waits (as it waits for the session), and when there
 * is no account (a single-user server answers `whoAmI` NOT_FOUND, and every
 * session there is its operator's) the desktop serves the session.
 *
 * The effect depends only on stable primitives (`adapter`, `sessionId`, the
 * derived `effectiveTarget` string and the derived `servesHere` flag) and
 * **never on the `session` object**.
 * `useSessionConversation` refetches the session frequently; keying the effect
 * on the object would tear down and restart the worker on every refetch
 * (DD-010 / reference-stability). `executionTarget` is immutable after the
 * first execution, and a session's creator never changes, so both derived
 * values stay stable across refetches.
 *
 * @param sessionId - The session being viewed, or `null` to skip.
 * @param session - The loaded session, or `null` while loading. The worker is
 *   not attached until the session loads, so the decision uses the session's
 *   own (authoritative) execution target rather than the provider default.
 */
export function useLocalSessionWorker(
  sessionId: string | null,
  session: Session | null,
): void {
  const adapter = useRunnerAdapter();
  const contextTarget = useExecutionTarget();
  const { account, isLoading: accountLoading } = useWhoAmI();

  // Resolve the session's effective execution target as a stable primitive.
  // `undefined` until the session loads — so we never attach a local worker
  // before we know whether the session actually runs locally (which would
  // spuriously start a worker for a cloud session opened in a local-default
  // app). When the spec is UNSPECIFIED, fall back to the provider target.
  const isLoaded = session != null;
  const specTarget = session?.spec?.executionTarget;
  const effectiveTarget = useMemo(() => {
    if (!isLoaded) return undefined;
    return (
      fromProtoExecutionTarget(specTarget ?? ExecutionTarget.UNSPECIFIED) ??
      contextTarget
    );
  }, [isLoaded, specTarget, contextTarget]);

  // Whether this viewer's desktop may serve the session, as a stable
  // primitive: `undefined` while the account is loading, `true` when there
  // is no account to compare or the account is the session's creator.
  const creatorStamp = session?.status?.audit?.specAudit?.createdBy?.id ?? "";
  const accountId = account?.metadata?.id ?? "";
  const accountSubject = account?.spec?.idpId ?? "";
  const servesHere = useMemo(() => {
    if (accountLoading) return undefined;
    if (accountId === "" || creatorStamp === "") return true;
    return creatorStamp === accountId || creatorStamp === accountSubject;
  }, [accountLoading, accountId, accountSubject, creatorStamp]);

  useEffect(() => {
    if (!adapter || !sessionId || effectiveTarget !== "local") return;
    if (servesHere !== true) return;

    // Fire-and-forget: a runner-start failure must not crash the session view.
    // The host adapter's add/remove are idempotent, so React's cleanup-driven
    // detach-old/attach-new on `sessionId` change is safe.
    adapter.onSessionOpened(sessionId).catch(() => {});
    return () => {
      adapter.onSessionClosed(sessionId).catch(() => {});
    };
  }, [adapter, sessionId, effectiveTarget, servesHere]);
}
