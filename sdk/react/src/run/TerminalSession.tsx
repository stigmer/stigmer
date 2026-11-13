"use client";

// One rendered terminal session: the `$ command` prompt line followed by its
// output, as a single block. Inside a step's card it draws no frame of its own:
// the step's body is the frame, so the session is monospace lines at the
// body's padding. Drawn on its own (`framed`), it takes the muted surface every
// other code/output block uses, so it tracks the host theme, preset and mode.

import { cn } from "@stigmer/design-tokens";
import { StatusBadge } from "../status/StatusBadge.js";
import { CollapsiblePre, TRUNCATION_LINE_LIMIT } from "./tool-rendering-primitives.js";
import { useSandboxNormalize } from "./SandboxContext.js";

/** The session's lines: monospace meta type, one step apart. */
const SESSION_LAYOUT = "stg:space-y-1 stg:font-mono stg:text-xs";

/** Its own frame, for a session drawn outside a step's card. */
const STANDALONE_FRAME = "stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:p-2.5";

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
  /**
   * The command is still running and `stdout` is what it has printed so far:
   * the newest lines stay in view as the output grows (the oldest fold into
   * a `… +N lines` marker), the way a terminal scrolls. Once the command
   * returns, the row renders its finished session instead.
   */
  readonly live?: boolean;
  /**
   * Draw the block's own border, corner and muted fill, for a session shown
   * on its own. Defaults to `false`: every place the kit draws one is inside a
   * step's card (a tool row's body, an approval card), whose body is the frame.
   */
  readonly framed?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a shell tool call as a single, cohesive terminal session — the
 * command prompt line immediately followed by its output — instead of a
 * separate command box and output box. Inside a card it has no frame of its
 * own (the card's body is the frame); pass `framed` to draw it on its own.
 *
 * Used by {@link ResultView} (full session) and the approval gate's
 * {@link ToolArgsView} (command-only, pre-execution). Importable on its own by
 * platform builders composing custom tool UIs.
 *
 * @example
 * ```tsx
 * <>
 *   <TerminalSession command="ls -la" stdout="total 8" exitCode={0} />
 *   <TerminalSession command="npm test" framed />
 * </>
 * ```
 */
export function TerminalSession({
  command,
  stdout,
  stderr,
  exitCode,
  live = false,
  framed = false,
  className,
}: TerminalSessionProps) {
  const normalize = useSandboxNormalize();
  const failed = exitCode !== undefined && exitCode !== 0;

  return (
    <div
      data-cursor-target="terminal-session"
      className={cn(SESSION_LAYOUT, framed && STANDALONE_FRAME, className)}
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
      {stdout && live && <LiveOutput content={normalize(stdout)} />}
      {stdout && !live && (
        <CollapsiblePre content={normalize(stdout)} className="stg:text-foreground" />
      )}
      {stderr && (
        <CollapsiblePre content={normalize(stderr)} className="stg:text-destructive" />
      )}
      {failed && <ExitBadge exitCode={exitCode} />}
    </div>
  );
}

/**
 * A running command's output so far, pinned to its newest lines: what a
 * person watching a build needs is what it printed last. No reveal control,
 * because the output is still growing; the finished session has one.
 */
function LiveOutput({ content }: { content: string }) {
  const lines = content.trimEnd().split("\n");
  const shown = lines.slice(-TRUNCATION_LINE_LIMIT);
  const hidden = lines.length - shown.length;
  return (
    <pre data-cursor-target="terminal-live-output" className="stg:whitespace-pre-wrap stg:break-words stg:font-mono stg:text-foreground">
      {hidden > 0 && (
        <span className="stg:block stg:select-none stg:text-muted-foreground-subtle">
          … +{hidden} {hidden === 1 ? "line" : "lines"}
        </span>
      )}
      {shown.join("\n")}
    </pre>
  );
}

/** The `exit N` failure badge of a session whose command failed. */
function ExitBadge({ exitCode }: { exitCode?: number }) {
  return (
    <div>
      <span className="stg:sr-only">Command exited with code {exitCode}</span>
      <span aria-hidden="true" className="stg:inline-flex">
        <StatusBadge phase="failed" label={`exit ${exitCode}`} />
      </span>
    </div>
  );
}
