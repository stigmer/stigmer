// Composes what the judge of a quality task is shown: the user's messages and
// the agent's final replies, the files that differ from the workspace's
// starting state, the content of the files the task names as they stand
// after the last turn, and the benchmark's checks of that state.
// Domain: conformance benchmark (the quality cells' subject).
//
// Three properties, each pinned by the unit arms:
// - BLIND. The subject never names the harness or the model, and carries no
//   tool names (the two harnesses name their built-in tools differently, so a
//   tool list would say which harness ran). The judge grades outcomes: what
//   the agent said, what the tree holds, what the checks found.
// - LITERAL. It opens with a fixed Markdown heading, so it is never a
//   `${ … }` expression. The workflow engine evaluates a string only when the
//   whole of it is one (runner workflow-engine/resolve.ts), so the text
//   reaches the judge byte for byte.
// - BOUNDED. A named file is cut at FILE_CONTENT_LIMIT_BYTES with the cut
//   stated, so one runaway write cannot crowd out the rest.
//
// Pure: the caller reads the workspace (workspace-facts.ts) and the turns
// (session.ts) and hands the facts in.
import type { FileChangeFact, QualityCheck, SampleOutcome } from "./report";

/** The subject's first line; fixed, and never an expression. */
export const SUBJECT_HEADING = "# The task, the agent's replies, and the repository afterwards";

/** A named file's content beyond this is cut, the cut stated. */
export const FILE_CONTENT_LIMIT_BYTES = 24_000;

export interface SubjectTurn {
  prompt: string;
  reply: string;
  outcome: SampleOutcome;
}

export interface SubjectInput {
  turns: readonly SubjectTurn[];
  filesChanged: readonly FileChangeFact[];
  namedFiles: readonly { path: string; content: string | null }[];
  checks: readonly QualityCheck[];
}

export function composeSubject(input: SubjectInput): string {
  const parts: string[] = [
    SUBJECT_HEADING,
    "",
    "An AI agent worked in a small Go repository at a user's request, over the turns below, in one conversation. " +
      "Each turn shows the user's message and the agent's final reply. After the turns come the files that differ " +
      "from the repository's starting state, the content of the files this task names as they stand after the " +
      "agent's last turn, and the checks run on that state.",
  ];

  input.turns.forEach((turn, index) => {
    parts.push("", `## Turn ${index + 1}`, "", "### The user", "", turn.prompt, "", "### The agent's final reply", "");
    if (turn.reply !== "") parts.push(turn.reply);
    else parts.push(turn.outcome === "completed" ? "(The agent gave no text reply.)" : `(No reply: the turn ended ${turn.outcome}.)`);
  });

  parts.push("", "## Files that differ from the starting state", "");
  if (input.filesChanged.length === 0) parts.push("None.");
  else for (const fact of input.filesChanged) parts.push(`- ${fact.change}: ${fact.path}`);

  for (const file of input.namedFiles) {
    parts.push("", `## ${file.path}, after the last turn`, "");
    if (file.content === null) {
      parts.push("(This file does not exist after the last turn.)");
      continue;
    }
    parts.push(...fenced(bounded(file.content)));
  }

  if (input.checks.length > 0) {
    parts.push("", "## Checks run on the repository after the last turn");
    for (const check of input.checks) parts.push("", `### ${check.name}: ${check.outcome}`, "", ...fenced(check.detail));
  }

  return `${parts.join("\n")}\n`;
}

function bounded(content: string): string {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes <= FILE_CONTENT_LIMIT_BYTES) return content;
  const kept = Buffer.from(content, "utf8").subarray(0, FILE_CONTENT_LIMIT_BYTES).toString("utf8");
  return `${kept}\n… (cut here: ${bytes - FILE_CONTENT_LIMIT_BYTES} more bytes)`;
}

/** A code fence longer than any backtick run inside `text`, so the text cannot close it. */
function fenced(text: string): string[] {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [fence, text.replace(/\n$/, ""), fence];
}
