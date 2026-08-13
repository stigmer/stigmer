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
      {failed && <ExitBadge exitCode={exitCode} />}
    </div>
  );
}

/** How many trailing output lines a collapsed terminal tail keeps visible. */
const TAIL_LINE_LIMIT = 3;

/** Props for {@link TerminalTail}. */
export interface TerminalTailProps {
  /** The command that was run, shown as the `$ <command>` prompt line. */
  readonly command?: string;
  /** Standard output. */
  readonly stdout?: string;
  /** Standard error. */
  readonly stderr?: string;
  /** Process exit code. A non-zero code renders a trailing `exit N` badge. */
  readonly exitCode?: number;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The collapsed teaser of a settled terminal session: the `$ command` prompt
 * line plus a dimmed tail of the last few output lines — enough to see at a
 * glance that the command ran and what it printed last, without the full
 * output competing with the conversation.
 *
 * The reduced contrast is deliberate and load-bearing: the tail is *context*,
 * not content, so it renders one contrast step below the reading text
 * (`muted-foreground`), while the command — the user-relevant intent — keeps
 * full contrast. stderr is not colored here for the same reason; the full
 * session (one disclosure away) restores the destructive treatment.
 *
 * Rendered by the tool-call row's `"tail"` disclosure state (see
 * {@link ToolCallItem}); the row's header chevron is the expand control, so
 * this component is presentation-only.
 */
export function TerminalTail({
  command,
  stdout,
  stderr,
  exitCode,
  className,
}: TerminalTailProps) {
  const normalize = useSandboxNormalize();
  const failed = exitCode !== undefined && exitCode !== 0;

  // One combined stream, in the order the full session renders it. Trailing
  // whitespace is trimmed so an ending newline doesn't blank the last slot.
  const combined = [stdout, stderr]
    .filter((s): s is string => Boolean(s))
    .join("\n")
    .replace(/\s+$/, "");
  const lines = combined ? normalize(combined).split("\n") : [];
  const tail = lines.slice(-TAIL_LINE_LIMIT);
  const hiddenCount = lines.length - tail.length;

  return (
    <div
      data-cursor-target="terminal-tail"
      className={cn(
        "stg:space-y-1 stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:p-2.5 stg:font-mono stg:text-xs",
        className,
      )}
    >
      {command && (
        <pre className="stg:whitespace-pre-wrap stg:break-words stg:text-foreground">
          <span className="stg:select-none stg:text-muted-foreground">$ </span>
          {normalize(command)}
        </pre>
      )}
      {tail.length > 0 && (
        <pre className="stg:whitespace-pre-wrap stg:break-words stg:text-muted-foreground">
          {hiddenCount > 0 && (
            <span className="stg:block stg:select-none stg:text-muted-foreground-subtle">
              … +{hiddenCount} {hiddenCount === 1 ? "line" : "lines"}
            </span>
          )}
          {tail.join("\n")}
        </pre>
      )}
      {failed && <ExitBadge exitCode={exitCode} />}
    </div>
  );
}

/** The `exit N` failure badge, shared by the full session and the tail. */
function ExitBadge({ exitCode }: { exitCode?: number }) {
  return (
    <div>
      <span className="stg:sr-only">Command exited with code {exitCode}</span>
      <span
        aria-hidden="true"
        className="stg:inline-block stg:rounded stg:bg-destructive-subtle stg:px-1 stg:py-0.5 stg:text-[10px] stg:font-medium stg:leading-none stg:tabular-nums stg:text-destructive"
      >
        exit {exitCode}
      </span>
    </div>
  );
}
