// Minimal terminal prompts for the setup wizard. Prompts and echoes are written
// to stderr so stdout stays clean; secret entry switches the TTY to raw mode and
// suppresses echo so API keys never appear on screen or in scrollback.

import { createInterface } from "node:readline";

/** Ask a yes/no question (default no). Returns true only for an explicit yes. */
export async function confirm(question: string): Promise<boolean> {
  const answer = (await promptLine(`${question} [y/N] `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

/** Read a line from stdin, showing `question` on stderr. */
export function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Read a secret from stdin with echo suppressed (falls back to plain read on a
 * non-TTY stdin, e.g. piped input). */
export function promptSecret(question: string): Promise<string> {
  const stdin = process.stdin;
  if (stdin.isTTY !== true || typeof stdin.setRawMode !== "function") {
    return promptLine(`${question}: `);
  }

  process.stderr.write(`${question}: `);
  return new Promise((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();

    const finish = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stderr.write("\n");
      resolve(value);
    };

    const onData = (chunk: Buffer): void => {
      const char = chunk.toString("utf8");
      switch (char) {
        case "\n":
        case "\r":
        case "\u0004": // Ctrl-D
          finish();
          break;
        case "\u0003": // Ctrl-C
          stdin.setRawMode(false);
          process.stderr.write("\n");
          process.exit(130);
          break;
        case "\u007f": // Backspace
        case "\b":
          value = value.slice(0, -1);
          break;
        default:
          value += char;
      }
    };

    stdin.on("data", onData);
  });
}
