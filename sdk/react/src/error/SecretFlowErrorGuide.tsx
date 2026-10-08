"use client";

import { useMemo } from "react";
import { StigmerError, getUserMessage } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";

/** Props for {@link SecretFlowErrorGuide}. */
export interface SecretFlowErrorGuideProps {
  /**
   * The error to inspect. Renders nothing when `null` or when the error
   * does not match a recognized secret-flow failure pattern.
   */
  readonly error: Error | null;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

interface MissingVariable {
  /** Who declares the key: an MCP server's name, "the agent <name>", "repository <name>". */
  readonly declarer: string;
  readonly variableName: string;
  /** The server's own instruction: who must act, and how. */
  readonly action: string;
}

/**
 * The run refusal's wording when a required key is in none of a run's
 * vaults: "<declarer> needs <KEY>: <who acts>", one per key, joined by
 * "; ". A wrapping prefix (a recover's) ends in a colon, and a bracketed
 * code prefix ends in "]"; the declarer never starts before either.
 *
 * Read by splitting and searching, never a regular expression over the
 * whole message: the message is server text, and a backtracking pattern
 * over it can take quadratic time on a long one.
 */
const NEEDS = " needs ";
const KEY_AND_ACTION = /^([A-Za-z_][A-Za-z0-9_]*): ([\s\S]+)$/;

/**
 * Parse a `FAILED_PRECONDITION` error message for keys a run needs and
 * none of its vaults holds. Returns an empty array when nothing matches.
 */
function parseMissingVariables(message: string): MissingVariable[] {
  const results: MissingVariable[] = [];
  for (const part of message.split(";")) {
    const at = part.indexOf(NEEDS);
    if (at < 0) continue;
    const head = part.slice(0, at);
    const declarer = head
      .slice(Math.max(head.lastIndexOf(":"), head.lastIndexOf("]")) + 1)
      .trim();
    const keyAndAction = KEY_AND_ACTION.exec(part.slice(at + NEEDS.length));
    if (declarer === "" || keyAndAction === null) continue;
    const action = keyAndAction[2].trim();
    if (action === "") continue;
    results.push({ declarer, variableName: keyAndAction[1], action });
  }
  return results;
}

function isFailedPreconditionError(error: Error): boolean {
  return error instanceof StigmerError && error.code === "failed-precondition";
}

/**
 * Contextual recovery guidance for secret-flow errors.
 *
 * Detects `FAILED_PRECONDITION` errors from run creation that name keys
 * none of the run's vaults holds, and renders each key with the server's
 * own instruction (add it to My vault, sign in, ask a schedule's owner).
 *
 * When the error does not match a secret-flow pattern, renders nothing.
 * This makes the component composable: try `SecretFlowErrorGuide`
 * first, fall through to {@link ErrorMessage} for everything else.
 *
 * No Console-specific dependencies (no routing, no app-shell imports).
 * Platform builders embedding Stigmer components get the same guidance.
 *
 * @example
 * ```tsx
 * {error && (
 *   <SecretFlowErrorGuide error={error} />
 *   ?? <ErrorMessage error={error} />
 * )}
 *
 * // Or in a single expression:
 * <SecretFlowErrorGuide error={error} />
 * {error && !isSecretFlowError(error) && <ErrorMessage error={error} />}
 * ```
 */
export function SecretFlowErrorGuide({
  error,
  className,
}: SecretFlowErrorGuideProps) {
  const parsed = useMemo(() => {
    if (!error || !isFailedPreconditionError(error)) return null;
    const variables = parseMissingVariables(error.message);
    if (variables.length === 0) return null;
    return variables;
  }, [error]);

  if (!parsed) return null;

  const grouped = useMemo(() => {
    const map = new Map<string, MissingVariable[]>();
    for (const item of parsed) {
      const list = map.get(item.declarer) ?? [];
      list.push(item);
      map.set(item.declarer, list);
    }
    return map;
  }, [parsed]);

  return (
    <div
      role="alert"
      className={cn(
        "stg:rounded-lg stg:border stg:border-amber-500/30 stg:bg-amber-500/5 stg:p-4",
        className,
      )}
    >
      <div className="stg:flex stg:items-start stg:gap-3">
        <KeyIcon className="stg:mt-0.5 stg:size-4 stg:shrink-0 stg:text-amber-600 stg:dark:text-amber-400" />

        <div className="stg:min-w-0 stg:flex-1 stg:space-y-2">
          <p className="stg:text-sm stg:font-medium stg:text-amber-800 stg:dark:text-amber-200">
            Missing logins and secrets
          </p>

          <div className="stg:space-y-1.5">
            {Array.from(grouped).map(([declarer, items]) => (
              <div key={declarer}>
                <p className="stg:text-xs stg:text-amber-700 stg:dark:text-amber-300">
                  <span className="stg:font-medium">{declarer}</span> needs:
                </p>
                <ul className={cn(UNSTYLED_LIST, "stg:mt-0.5 stg:space-y-0.5")}>
                  {items.map((item) => (
                    <li
                      key={item.variableName}
                      className="stg:text-xs stg:text-amber-800/80 stg:dark:text-amber-200/80 stg:pl-3"
                    >
                      <span className="stg:font-mono">{item.variableName}</span>
                      {" — "}
                      {item.action}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}

/**
 * Check whether an error matches the secret-flow missing variable pattern.
 * Useful for conditional rendering alongside `ErrorMessage`.
 */
export function isSecretFlowError(error: Error | null): boolean {
  if (!error || !isFailedPreconditionError(error)) return false;
  return parseMissingVariables(error.message).length > 0;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function KeyIcon({ className }: { className?: string }) {
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
      <circle cx="10.5" cy="5.5" r="3" />
      <path d="M8.5 7.5L3 13l1.5 1.5" />
      <path d="M5.5 11l1.5 1.5" />
    </svg>
  );
}
