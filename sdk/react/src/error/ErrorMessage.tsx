"use client";

import type { ReactNode } from "react";
import {
  classifyError,
  getUserMessage,
  getRpcMetadata,
  type ErrorCategory,
} from "@stigmer/client";
import { Notice } from "../internal/surface/Notice.js";

/** Props for {@link ErrorMessage}. */
export interface ErrorMessageProps {
  /** The error to display. Renders nothing when `null`. */
  readonly error: Error | null;
  /**
   * The headline, in the page's words ("Couldn't load the members.").
   * When omitted, a plain sentence for the error's category.
   */
  readonly title?: string;
  /**
   * What wasn't lost, when the page knows ("Your organization's vaults
   * are safe; only this page's read failed."). Drawn under the error's own
   * line.
   */
  readonly comfort?: ReactNode;
  /**
   * Callback to retry the failed operation. Shows "Try again" when
   * provided and trying again can help (the server failed or didn't
   * answer, the request was cancelled, or the cause is unknown).
   */
  readonly retry?: () => void;
  /** Signs the person in again. Shows "Sign in again" when the error is that they're signed out. */
  readonly signIn?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/** The headline for each category when the caller gives none: what happened, in a sentence. */
const CATEGORY_HEADLINES: Record<ErrorCategory, string> = {
  auth: "You're signed out.",
  permission: "You don't have access to this.",
  "not-found": "This isn't here any more.",
  validation: "Stigmer couldn't accept that.",
  server: "Something went wrong on Stigmer's side.",
  unavailable: "Stigmer didn't answer.",
  cancelled: "That was cancelled before it finished.",
  unknown: "Something went wrong.",
};

/** The categories where trying again can help. */
const RETRYABLE: ReadonlySet<ErrorCategory> = new Set(["server", "unavailable", "cancelled", "unknown"]);

/**
 * A failure, as the console draws one: a note in the failed tone with a
 * bold sentence on what happened, the error's own message under it, what
 * wasn't lost when the page knows, one act (Try again, or Sign in again),
 * and Copy details (the category, and the RPC method and path) for
 * whoever fixes it.
 *
 * Uses `classifyError()`, `getUserMessage()` and `getRpcMetadata()` from
 * `@stigmer/client`.
 *
 * All visual properties flow through `--stgm-*` design tokens. No
 * Console-specific dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * function AgentName({ slug }: { slug: string }) {
 *   const { agent, error, refetch } = useAgent("acme", slug);
 *   if (error) return <ErrorMessage error={error} title="Couldn't load the agent." retry={refetch} />;
 *   return <h1>{agent?.metadata?.name}</h1>;
 * }
 * ```
 */
export function ErrorMessage({
  error,
  title,
  comfort,
  retry,
  signIn,
  className,
}: ErrorMessageProps) {
  if (!error) return null;

  const category = classifyError(error);
  const message = getUserMessage(error);
  const metadata = getRpcMetadata(error);
  const details = [
    message,
    `Category: ${category}`,
    metadata ? `Method: ${metadata.method}` : "",
    metadata ? `Path: ${metadata.path}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const act =
    category === "auth" && signIn
      ? { label: "Sign in again", onClick: signIn }
      : retry && RETRYABLE.has(category)
        ? { label: "Try again", onClick: retry, icon: <RotateCcwIcon className="stg:size-3.5" /> }
        : undefined;

  return (
    <Notice
      tone="failed"
      role="alert"
      icon={category === "auth" || category === "permission" ? <ShieldXIcon /> : undefined}
      headline={title ?? CATEGORY_HEADLINES[category]}
      act={act}
      details={details}
      className={className}
    >
      <p className="stg:m-0 stg:break-words">{message}</p>
      {comfort != null && <p className="stg:m-0 stg:text-muted-foreground">{comfort}</p>}
    </Notice>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline SVGs — SDK components avoid icon library dependencies)
// ---------------------------------------------------------------------------

function ShieldXIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 1.5l5 2v4c0 3.5-2.5 5.5-5 6.5-2.5-1-5-3-5-6.5v-4l5-2z" />
      <path d="M6 6.5l4 4M10 6.5l-4 4" />
    </svg>
  );
}

function RotateCcwIcon({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 6.5h4v-4" />
      <path d="M3.5 11.5a5.5 5.5 0 1 0 .5-6l-2 1" />
    </svg>
  );
}
