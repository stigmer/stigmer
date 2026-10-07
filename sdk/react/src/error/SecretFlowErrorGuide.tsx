"use client";

/**
 * Recovery guidance for a run the server refused because a value it needs
 * has no source. The server names each missing value with who needs it
 * ("MCP server 'linear' needs LINEAR_API_KEY"); this guide groups them by
 * who needs them and says how to give them: a key of your own, a value
 * for this run, or the organization's key an admin lets you use.
 *
 * Pinned by `__tests__/SecretFlowErrorGuide.test.tsx`.
 */
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
  /** Who needs the value, as the server named it ("MCP server 'linear'"). */
  readonly declarer: string;
  readonly variableName: string;
}

const DECLARER = "(?:MCP server|agent|git host) '[^']+'";
const MISSING_VALUE_PATTERN = new RegExp(
  `(${DECLARER}(?: and ${DECLARER})*) needs ([A-Za-z_][A-Za-z0-9_]*)`,
  "g",
);

/**
 * Parse a `FAILED_PRECONDITION` refusal for the values a run needs and
 * nothing gives, one entry per declarer and key. Returns an empty array
 * when the message names none.
 */
export function parseMissingVariables(message: string): MissingVariable[] {
  const results: MissingVariable[] = [];
  for (const match of message.matchAll(MISSING_VALUE_PATTERN)) {
    for (const declarer of match[1]!.split(" and ")) {
      results.push({ declarer, variableName: match[2]! });
    }
  }
  return results;
}

function isFailedPreconditionError(error: Error): boolean {
  return error instanceof StigmerError && error.code === "failed-precondition";
}

/**
 * Contextual recovery guidance for secret-flow errors.
 *
 * Detects `FAILED_PRECONDITION` errors from run creation that name
 * values nothing gives, and renders actionable guidance alongside the
 * technical error message.
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
  const grouped = useMemo(() => {
    if (!error || !isFailedPreconditionError(error)) return null;
    const variables = parseMissingVariables(error.message);
    if (variables.length === 0) return null;
    const map = new Map<string, string[]>();
    for (const { declarer, variableName } of variables) {
      const list = map.get(declarer) ?? [];
      if (!list.includes(variableName)) list.push(variableName);
      map.set(declarer, list);
    }
    return map;
  }, [error]);

  if (!grouped) return null;

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
            Missing keys
          </p>

          <div className="stg:space-y-1.5">
            {Array.from(grouped).map(([declarer, vars]) => (
              <div key={declarer}>
                <p className="stg:text-xs stg:text-amber-700 stg:dark:text-amber-300">
                  <span className="stg:font-medium">{declarer}</span> needs:
                </p>
                <ul className={cn(UNSTYLED_LIST, "stg:mt-0.5 stg:space-y-0.5")}>
                  {vars.map((v) => (
                    <li
                      key={v}
                      className="stg:text-xs stg:font-mono stg:text-amber-800/80 stg:dark:text-amber-200/80 stg:pl-3"
                    >
                      {v}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="stg:border-t stg:border-amber-500/20 stg:pt-2">
            <p className="stg:text-xs stg:text-amber-700/90 stg:dark:text-amber-300/90">
              You can provide these values in three ways:
            </p>
            <ul className={cn(UNSTYLED_LIST, "stg:mt-1 stg:space-y-0.5 stg:text-xs stg:text-amber-700/80 stg:dark:text-amber-300/80")}>
              <li className="stg:flex stg:items-start stg:gap-1.5">
                <span className="stg:mt-px stg:shrink-0">•</span>
                <span>
                  Save a key of yours for it in Settings,{" "}
                  <strong className="stg:font-medium">Accounts and keys</strong>,
                  or sign in to the tool, for reuse in every run.
                </span>
              </li>
              <li className="stg:flex stg:items-start stg:gap-1.5">
                <span className="stg:mt-px stg:shrink-0">•</span>
                <span>
                  Provide them as{" "}
                  <strong className="stg:font-medium">session variables</strong>{" "}
                  when sending a message.
                </span>
              </li>
              <li className="stg:flex stg:items-start stg:gap-1.5">
                <span className="stg:mt-px stg:shrink-0">•</span>
                <span>
                  Ask an admin to let you use the organization&apos;s key for it.
                </span>
              </li>
            </ul>
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
