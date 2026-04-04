"use client";

import { useMemo } from "react";
import { StigmerError, getUserMessage } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";

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
  readonly serverName: string;
  readonly variableName: string;
}

const MISSING_ENV_VAR_PATTERN =
  /MCP server '([^']+)' requires environment variable '([^']+)'/g;

/**
 * Parse a `FAILED_PRECONDITION` error message for missing environment
 * variable declarations. Returns an empty array when the pattern does
 * not match.
 */
function parseMissingVariables(message: string): MissingVariable[] {
  const results: MissingVariable[] = [];
  let match: RegExpExecArray | null;
  while ((match = MISSING_ENV_VAR_PATTERN.exec(message)) !== null) {
    results.push({ serverName: match[1], variableName: match[2] });
  }
  MISSING_ENV_VAR_PATTERN.lastIndex = 0;
  return results;
}

function isFailedPreconditionError(error: Error): boolean {
  return error instanceof StigmerError && error.code === "failed-precondition";
}

/**
 * Contextual recovery guidance for secret-flow errors.
 *
 * Detects `FAILED_PRECONDITION` errors from execution creation that
 * indicate missing MCP server environment variables, and renders
 * actionable guidance alongside the technical error message.
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
    const map = new Map<string, string[]>();
    for (const { serverName, variableName } of parsed) {
      const list = map.get(serverName) ?? [];
      list.push(variableName);
      map.set(serverName, list);
    }
    return map;
  }, [parsed]);

  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-amber-500/30 bg-amber-500/5 p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <KeyIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Missing environment variables
          </p>

          <div className="space-y-1.5">
            {Array.from(grouped).map(([server, vars]) => (
              <div key={server}>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  <span className="font-medium">{server}</span> requires:
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {vars.map((v) => (
                    <li
                      key={v}
                      className="text-xs font-mono text-amber-800/80 dark:text-amber-200/80 pl-3"
                    >
                      {v}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t border-amber-500/20 pt-2">
            <p className="text-xs text-amber-700/90 dark:text-amber-300/90">
              You can provide these values in two ways:
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-amber-700/80 dark:text-amber-300/80">
              <li className="flex items-start gap-1.5">
                <span className="mt-px shrink-0">•</span>
                <span>
                  Add them to your{" "}
                  <strong className="font-medium">personal environment</strong>{" "}
                  in Settings for automatic reuse across sessions.
                </span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="mt-px shrink-0">•</span>
                <span>
                  Provide them as{" "}
                  <strong className="font-medium">session variables</strong>{" "}
                  when sending a message.
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
