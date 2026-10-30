// Whether the terminal kit draws live and whether a person can answer: one
// pure decision from the process's streams and environment, made before
// rendering, so the view, the run API and the bin agree.
//
// Two facts, decided apart because they come from different streams:
//   - `live`: Ink redraws in place. Ink's own rule (stdout is a TTY and the
//     process is not in CI, read the way `is-in-ci` reads CI and
//     CONTINUOUS_INTEGRATION) plus the `stigmer` CLI's: TERM=dumb draws
//     nothing live. Off it, Ink writes the last frame once, at exit, with no
//     cursor codes, which is what a pipe or a CI log wants.
//   - `canAnswer`: a key press can reach a prompt someone sees. It needs a
//     live screen and a stdin Ink can put in raw mode (a TTY). A terminal's
//     stdin with stdout piped (`stigmer-ink ... | tee log`) cannot answer:
//     nobody sees the prompt the keys would go to.
//
// Proven by __tests__/terminal-mode.test.ts.

/** The parts of a process's streams the decision reads. */
export interface TerminalStreams {
  /** The input a person would type into. */
  readonly stdin: {
    /** Whether it is a terminal, which Ink can put in raw mode. */
    readonly isTTY?: boolean;
  };
  /** The output the view draws on. */
  readonly stdout: {
    /** Whether it is a terminal, which Ink can redraw in place. */
    readonly isTTY?: boolean;
  };
  /** The environment: `TERM`, `CI` and `CONTINUOUS_INTEGRATION` are read. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** How a run is shown, and whether a person can answer its prompts. */
export interface TerminalMode {
  /** Ink draws live, redrawing in place; off, it writes the final frame once at exit. */
  readonly live: boolean;
  /** A person can answer prompts with the keyboard. */
  readonly canAnswer: boolean;
}

/** A CI flag set to anything but `0` or `false`, as `is-in-ci` (and so Ink) reads it. */
function inCi(env: TerminalStreams["env"]): boolean {
  const set = (key: string) => key in env && env[key] !== "0" && env[key] !== "false";
  return set("CI") || set("CONTINUOUS_INTEGRATION");
}

/** Decides {@link TerminalMode} from the streams and the environment (module header). */
export function terminalMode({ stdin, stdout, env }: TerminalStreams): TerminalMode {
  const live = stdout.isTTY === true && env.TERM !== "dumb" && !inCi(env);
  return { live, canAnswer: live && stdin.isTTY === true };
}
