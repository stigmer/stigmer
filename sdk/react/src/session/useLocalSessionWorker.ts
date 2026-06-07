"use client";

import { useEffect, useMemo } from "react";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { useRunnerAdapter } from "../runner-adapter";
import { useExecutionTarget } from "../execution-target-context";
import { fromProtoExecutionTarget } from "./execution-target";

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
 * The effect depends only on stable primitives (`adapter`, `sessionId`, and
 * the derived `effectiveTarget` string) and **never on the `session` object**.
 * `useSessionConversation` refetches the session frequently; keying the effect
 * on the object would tear down and restart the worker on every refetch
 * (DD-010 / reference-stability). `executionTarget` is immutable after the
 * first execution, so the derived string stays stable across refetches.
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

  useEffect(() => {
    if (!adapter || !sessionId || effectiveTarget !== "local") return;

    // Fire-and-forget: a runner-start failure must not crash the session view.
    // The host adapter's add/remove are idempotent, so React's cleanup-driven
    // detach-old/attach-new on `sessionId` change is safe.
    adapter.onSessionOpened(sessionId).catch(() => {});
    return () => {
      adapter.onSessionClosed(sessionId).catch(() => {});
    };
  }, [adapter, sessionId, effectiveTarget]);
}
