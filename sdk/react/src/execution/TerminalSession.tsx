"use client";

// One rendered terminal session: the `$ command` prompt line followed by its
// output, as a single block. Rendered on the same `bg-muted-subtle` surface as
// every other code/output block (CollapsibleCode, search, list) — not a
// bespoke dark box — so it tracks the host theme, preset, and color mode.

import { cn } from "@stigmer/theme";
import { CollapsiblePre } from "./tool-rendering-primitives.js";
import { useSandboxNormalize } from "./SandboxContext.js";

/** Props for {@link TerminalSession}. */
export interface TerminalSessionProps {
  /**
   * The command that was run, shown as the `$ <command>` prompt line. Omit for
   * a pure-output render; the pre-execution approval gate passes only this
   * (no output exists yet).
   */
  readonly command?: string;
  /** Standard output. */
  readonly stdout?: string;
  /** Standard error, rendered in the destructive color. */
  readonly stderr?: string;
  /** Process exit code. A non-zero code renders a trailing `exit N` badge. */
  readonly exitCode?: number;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a shell tool call as a single, cohesive terminal session — the
 * command prompt line immediately followed by its output — instead of a
 * separate command box and output box.
 *
 * Used by {@link ResultView} (full session) and the approval gate's
 * {@link ToolArgsView} (command-only, pre-execution). Importable on its own by
 * platform builders composing custom tool UIs.
 *
 * @example
 * ```tsx
 * <TerminalSession command="ls -la" stdout="total 8\n..." exitCode={0} />
 * <TerminalSession command="npm test" /> // gate: command only
 * ```
 */
export function TerminalSession({
  command,
  stdout,
  stderr,
  exitCode,
  className,
}: TerminalSessionProps) {
  const normalize = useSandboxNormalize();
  const failed = exitCode !== undefined && exitCode !== 0;

  return (
    <div
      data-cursor-target="terminal-session"
      className={cn(
        "stg:space-y-1 stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:p-2.5 stg:font-mono stg:text-xs",
        className,
      )}
    >
      {command && (
        // A plain <pre> (not CollapsiblePre): the command is the user's intent
        // and renders in full — even a multi-line heredoc — without a second
        // truncation toggle competing with stdout's.
        <pre className="stg:whitespace-pre-wrap stg:break-words stg:text-foreground">
          <span className="stg:select-none stg:text-muted-foreground">$ </span>
          {normalize(command)}
        </pre>
      )}
      {stdout && (
        <CollapsiblePre content={normalize(stdout)} className="stg:text-foreground" />
      )}
      {stderr && (
        <CollapsiblePre content={normalize(stderr)} className="stg:text-destructive" />
      )}
      {failed && (
        <div>
          <span className="stg:sr-only">Command exited with code {exitCode}</span>
          <span
            aria-hidden="true"
            className="stg:inline-block stg:rounded stg:bg-destructive-subtle stg:px-1 stg:py-0.5 stg:text-[10px] stg:font-medium stg:leading-none stg:tabular-nums stg:text-destructive"
          >
            exit {exitCode}
          </span>
        </div>
      )}
    </div>
  );
}
