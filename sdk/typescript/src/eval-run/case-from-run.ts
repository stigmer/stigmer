// Turns a run into a test case for a plugin's evals/ folder, in Claude
// Code's plugin-eval format: a bad live conversation becomes a case the
// author commits, so the next version of the plugin is measured on it.
//
// The case is the files `claude plugin eval init --bare` would write, filled
// from the run: `prompt.md` (the format's starting limits, and the run's
// request as the body), `graders/criteria.md` (an `llm` rubric whose FAIL
// line names what went wrong, from the judge's failing reason or the
// person's comment; the PASS line stays for the author, who alone knows
// what a correct reply holds), and, when the caller knows the plugin's skill
// was never read, `graders/skill-fired.md` (a `tool_used: Skill` check
// matching the skill by name, in its bare or namespaced form).
//
// Stigmer never writes into the author's repository: the CLI writes these
// files into a local folder and the console offers them as a zip. A run that
// continued a conversation takes only its last request, and the result says
// so, because resumed conversations are not run yet.
//
// Pure. Pinned by `__tests__/case-from-run.test.ts`.

/** What a run offers a test case. */
export interface CaseFromRunInput {
  /** The run's request: what the person typed. */
  readonly request: string;
  /** The case's name, also its directory. */
  readonly caseName: string;
  /** The AI judge's reason for a rubric the run failed. */
  readonly judgeReason?: string;
  /** The comment a person left with a thumbs-down. */
  readonly thumbsComment?: string;
  /** The plugin's skill the run should have read and never did. */
  readonly skillNeverRead?: { readonly plugin: string; readonly skill: string };
  /** Whether the run continued an earlier conversation. */
  readonly multiTurn: boolean;
}

/** One file of the case, by its path inside the case directory. */
export interface CaseFile {
  readonly path: string;
  readonly content: string;
}

/** The case folder's files, and what the author should know about them. */
export interface CaseFromRun {
  readonly caseName: string;
  readonly files: readonly CaseFile[];
  /** Set when the case does not reproduce the whole run. */
  readonly note?: string;
}

/** The note on a case built from a run that continued a conversation. */
export const MULTI_TURN_NOTE = "built from the last request; resumed conversations are not run yet";

/** The longest name {@link suggestCaseName} returns. */
const MAX_CASE_NAME = 48;

/** Builds a case folder from a run. */
export function caseFromRun(input: CaseFromRunInput): CaseFromRun {
  const files: CaseFile[] = [
    { path: "prompt.md", content: promptFile(input.request) },
    { path: "graders/criteria.md", content: criteriaFile(failureOf(input)) },
  ];
  if (input.skillNeverRead !== undefined) {
    files.push({ path: "graders/skill-fired.md", content: skillFiredFile(input.skillNeverRead.skill) });
  }
  return {
    caseName: input.caseName,
    files,
    ...(input.multiTurn && { note: MULTI_TURN_NOTE }),
  };
}

/**
 * A case name from a request, as `claude plugin eval init` names a case
 * after its prompt: lower-case words joined by dashes, at most 48
 * characters, cut at a word (a first word longer than that is cut
 * itself). A request with no letters or digits is "case-from-run".
 */
export function suggestCaseName(request: string): string {
  const words = request
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "");
  let name = "";
  for (const word of words) {
    const next = name === "" ? word : `${name}-${word}`;
    if (next.length > MAX_CASE_NAME) break;
    name = next;
  }
  if (name !== "") return name;
  // One word longer than the limit is cut; no word at all gets the default.
  return words[0]?.slice(0, MAX_CASE_NAME) ?? "case-from-run";
}

function promptFile(request: string): string {
  return `---\nmax_turns: 10\nallowed_tools: [Read, Glob, Grep, Skill]\n---\n\n${request.trim()}\n`;
}

/** What went wrong, from the judge first, then the person; one line. */
function failureOf(input: CaseFromRunInput): string {
  for (const reason of [input.judgeReason, input.thumbsComment]) {
    const line = oneLine(reason ?? "");
    if (line !== "") return line;
  }
  return "";
}

function criteriaFile(failure: string): string {
  const fail =
    failure === ""
      ? "FAIL if <what a wrong or missing response looks like>."
      : `FAIL if the response repeats what went wrong in the run this case was made from: ${withStop(failure)}`;
  return `---\ntype: llm\n---\n\nPASS if <what a correct response contains>.\n${fail}\n`;
}

function skillFiredFile(skill: string): string {
  // The pattern sits in a single-quoted YAML scalar, where a quote is
  // written twice; the skill name is escaped as regex text first.
  const pattern = `"skill"\\s*:\\s*"(?:[\\w-]+:)?${escapeRegex(skill)}"`.replaceAll("'", "''");
  return `---\ntype: tool_used\ntool: Skill\ninput_match: '${pattern}'\n---\n`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
}

function withStop(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
