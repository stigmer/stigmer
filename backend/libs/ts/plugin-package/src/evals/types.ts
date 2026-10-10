/**
 * The eval suite model: what `readEvalSuite` returns for a plugin's
 * `evals/` folder, in Claude Code's plugin-eval format (case format
 * `schema_version: "1.1"`).
 *
 * One normalised shape whichever file a field came from: a case may be a
 * `prompt.md`, a `case.yaml`, or both, and its graders may be
 * `graders/*.md` files or `case.yaml` entries. The reader applies the
 * format's precedence (prompt.md frontmatter over case.yaml, graders from
 * case.yaml first, then graders/*.md in path order) so a consumer never
 * re-derives it. Defaults the format documents are applied here too (runs
 * 3, max_turns 10, timeout 300 s, weight 1, focus last_message, tool_used
 * min 1), so the server's graders and the CLI's offline listing read the
 * same values.
 *
 * Features Stigmer does not run yet are still read, so a case that uses
 * one is listed with the feature named (`unsupported`) rather than run
 * without it: a degraded run is a wrong score.
 */

/** What a `regex` grader's `target` or an `llm` grader's `focus` names. */
export type EvalFocus =
  | { readonly kind: "last_message" }
  | { readonly kind: "trace" }
  | { readonly kind: "files" }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "mock_calls" };

/** A grader's `arm` setting; `undefined` when the grader leaves it unset. */
export type EvalGraderArm = "with-only" | "both";

/** A tool reference in `tool_order`: a name, or a name and an input regex. */
export interface EvalToolRef {
  readonly tool: string;
  /** JavaScript regex over the call's JSON-encoded input; absent matches any. */
  readonly inputMatch?: string;
}

/** The type-specific options of a grader. */
export type EvalGraderCheck =
  | {
      readonly type: "regex";
      readonly pattern: string;
      /** JavaScript regex flags, e.g. "i". Empty when unset. */
      readonly flags: string;
      /** `contains` (the default), `not_contains`, or exactly N matches. */
      readonly match:
        | { readonly kind: "contains" }
        | { readonly kind: "not_contains" }
        | { readonly kind: "count"; readonly count: number };
      readonly target: EvalFocus;
    }
  | {
      readonly type: "tool_used";
      readonly tool: string;
      readonly inputMatch?: string;
      /** Default 1. */
      readonly min: number;
      /** Absent means unlimited. */
      readonly max?: number;
    }
  | {
      readonly type: "tool_order";
      readonly before: EvalToolRef;
      readonly after: EvalToolRef;
    }
  | {
      readonly type: "file_exists";
      /** A glob over the paths created during the run. */
      readonly path: string;
      /** Default true. */
      readonly exists: boolean;
    }
  | {
      readonly type: "llm";
      readonly criteria: string;
      readonly focus: EvalFocus;
    }
  | {
      readonly type: "baseline";
      /** A `.jsonl` transcript, relative to the case directory. */
      readonly baselineFile: string;
      readonly criteria: string;
    };

export type EvalGraderType = EvalGraderCheck["type"];

/** One grader of a case. */
export interface EvalGrader {
  /** The `graders/<name>.md` filename without `.md`, or the entry's `name`. */
  readonly name: string;
  /** Plugin-relative path of the file that declared it. */
  readonly path: string;
  /** Any positive number; default 1. */
  readonly weight: number;
  readonly arm?: EvalGraderArm;
  readonly check: EvalGraderCheck;
}

/** The `context` block of a `case.yaml`. */
export interface EvalCaseContext {
  readonly scaffoldScript?: string;
  readonly historyFile?: string;
  readonly addDirs: readonly string[];
}

/** One case of the suite, normalised. */
export interface EvalCase {
  /** `name`, else the directory's name. */
  readonly name: string;
  /** The case directory, relative to the plugin's root, e.g. "evals/first-case". */
  readonly dir: string;
  readonly description?: string;
  readonly tags: readonly string[];
  /** The prompt sent to the agent, exactly as written. */
  readonly prompt: string;
  /** Tries per arm, 1 to 50; default 3. */
  readonly runs: number;
  /** As written; Stigmer's catalog decides whether it names a model. */
  readonly model?: string;
  /** Turn cap, 1 to 200; default 10. */
  readonly maxTurns: number;
  /** Wall-clock cap per try, 1 to 3600; default 300. */
  readonly timeoutSeconds: number;
  /** The case's `allowed_tools`, as written. */
  readonly allowedTools: readonly string[];
  readonly appendSystemPrompt?: string;
  /** The case's `env`; keys match `EVAL_[A-Z0-9_]*`. */
  readonly env: Readonly<Record<string, string>>;
  /**
   * `plugins` as written, relative to the case directory. One entry names
   * the plugin under test (the format's override of auto-detect); more than
   * one makes the case `unsupported: "plugins"`, since Stigmer evaluates the
   * installed plugin alone.
   */
  readonly plugins: readonly string[];
  readonly context: EvalCaseContext;
  /** The plugin-relative paths of every file under the case directory. */
  readonly files: readonly string[];
  readonly graders: readonly EvalGrader[];
  /**
   * The first feature this case uses that Stigmer does not run yet, as a
   * stable phrase the report prints after "not run: ", e.g.
   * "context.scaffold_script"; absent when Stigmer runs the case.
   */
  readonly unsupported?: string;
}

/** A problem reading the suite: a case that cannot load, an unknown key. */
export interface EvalSuiteFinding {
  readonly kind:
    | "eval-dir-invalid"
    | "eval-case-invalid"
    | "eval-grader-invalid"
    | "eval-field-unknown"
    | "eval-schema-version-unsupported";
  /** One user-facing sentence naming the file and field, as the format reports it. */
  readonly message: string;
  /** The plugin-relative path the finding points at. */
  readonly path: string;
}

/** The suite: the cases that loaded and the findings for those that did not. */
export interface EvalSuite {
  /** "evals", or the manifest's `experimental.evals` when it is usable. */
  readonly dir: string;
  /** Cases in directory order (sorted by path). */
  readonly cases: readonly EvalCase[];
  readonly findings: readonly EvalSuiteFinding[];
}
