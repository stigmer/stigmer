"use client";

import { useState, type FormEvent } from "react";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { downloadBinaryFile } from "../internal/download.js";
import { testCaseOfRun, zipTestCase } from "../plugin-eval/test-case.js";
import { useRunScoresData } from "./RunScoresContext.js";
import { RATING_COMMENT_MAX_LENGTH } from "./rating-input.js";
import { CriterionResult } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import {
  evalViewOf,
  judgeViewOf,
  runHealthViewOf,
  thumbsOf,
  viewerFeedbackOf,
  type EvalView,
  type JudgeView,
  type RunHealthView,
} from "./score-view.js";
import { useRateRun } from "./useRateRun.js";

/** Props for {@link RunScores}. */
export interface RunScoresProps {
  /** The completed run whose scores the control shows and rates. */
  readonly runId: string;
  /** Additional CSS class names for the root element. */
  readonly className?: string;
}

/**
 * A completed run's scores under its final answer: thumbs up and down with
 * an optional one-line comment, the run-health chip that opens to the
 * reason for each flag ("the last call to create_ticket failed (step 7)"),
 * and, where the run's agent has AI grading switched on, the judge chip:
 * "Judge: grading…" while the grade is in progress, then "Judge: passed" or
 * "Judge: 1 of 2 failed", which opens to each rubric's reason and the model
 * that graded it. A try of a plugin eval carries the eval chip ("Eval:
 * passed", "Eval: 1 of 3 failed"), which opens to each check's verdict and
 * reason. A run the platform could not grade says so quietly, with the
 * reason.
 *
 * "Make a test case", revealed with the thumbs, downloads the run as a case
 * folder for a plugin's evals/ (a zip of `prompt.md` and an `llm` rubric
 * seeded from the first failing grader's reason or the viewer's thumbs-down
 * comment). Stigmer never writes into the author's repository; the author
 * unzips it there and commits it.
 *
 * Reads the thread's scores from `MessageThread`'s provider (enabled by its
 * `runScores` prop), so it renders nothing outside one. Each person rates
 * a run once; a second click changes the rating. The buttons are disabled
 * while a write is in flight, so a double click cannot store two ratings.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */
export function RunScores({ runId, className }: RunScoresProps) {
  const data = useRunScoresData();
  const { rateRun, isRating, error } = useRateRun();
  // The rating this view last wrote: shown until the refetch carries it,
  // and the one that counts when the creator stamp cannot be matched.
  const [written, setWritten] = useState<Score | undefined>(undefined);
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState("");

  if (data === null) return null;

  const scores = data.scoresOf(runId);
  const mine = written ?? viewerFeedbackOf(scores, data.viewer);
  const thumbs = thumbsOf(mine);
  const health = runHealthViewOf(scores);
  const judge = judgeViewOf(scores);
  const evalView = evalViewOf(scores);
  const org = data.orgOf(runId);
  const request = data.requestOf(runId);

  const rate = async (passed: boolean, note: string): Promise<void> => {
    try {
      const stored = await rateRun({ org, runId, passed, comment: note });
      setWritten(stored);
      data.refetch();
    } catch {
      // The hook keeps the error; the row shows it below.
    }
  };

  const onThumb = (passed: boolean): void => {
    const note = mine?.spec?.comment ?? "";
    setComment(note);
    setCommentOpen(true);
    void rate(passed, note);
  };

  // The note rides the thumb it was opened for; the form renders only
  // once a thumb is set, so it hands that thumb in.
  const onSubmitComment = (
    event: FormEvent<HTMLFormElement>,
    passed: boolean,
  ): void => {
    event.preventDefault();
    void rate(passed, comment.trim());
    setCommentOpen(false);
  };

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-1", className)}>
      <div className="stg:flex stg:items-center stg:gap-1">
        <ThumbButton
          up
          pressed={thumbs === true}
          disabled={isRating}
          onClick={() => onThumb(true)}
        />
        <ThumbButton
          up={false}
          pressed={thumbs === false}
          disabled={isRating}
          onClick={() => onThumb(false)}
        />
        <HealthChip view={health} />
        <JudgeChip view={judge} />
        <EvalChip view={evalView} />
        {request !== "" && (
          <MakeTestCaseButton
            onMake={() =>
              testCaseOfRun({
                request,
                scores,
                viewer: data.viewer,
                multiTurn: data.followsEarlierRun(runId),
              })
            }
          />
        )}
      </div>
      {commentOpen && thumbs !== undefined && (
        <form
          onSubmit={(event) => onSubmitComment(event, thumbs)}
          className="stg:flex stg:items-center stg:gap-2"
        >
          <input
            type="text"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={RATING_COMMENT_MAX_LENGTH}
            placeholder="Add a note (optional)"
            aria-label="Note on this answer"
            disabled={isRating}
            className={cn(
              "stg:h-7 stg:min-w-0 stg:flex-1 stg:rounded-md stg:border stg:border-border stg:bg-background stg:px-2 stg:text-xs stg:text-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          />
          <button
            type="submit"
            disabled={isRating}
            className="stg:h-7 stg:rounded-md stg:px-2 stg:text-xs stg:text-muted-foreground stg:hover:bg-accent-hover stg:hover:text-foreground"
          >
            Save
          </button>
        </form>
      )}
      {error !== null && (
        <p role="alert" className="stg:text-xs stg:text-destructive">
          {error.message}
        </p>
      )}
    </div>
  );
}

const QUIET_BUTTON_CLASSES = cn(
  "stg:inline-flex stg:h-6 stg:w-6 stg:items-center stg:justify-center stg:rounded-md stg:transition",
  "stg:hover:text-muted-foreground stg:hover:bg-accent-hover",
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
  "stg:disabled:cursor-not-allowed",
);

function ThumbButton({
  up,
  pressed,
  disabled,
  onClick,
}: {
  readonly up: boolean;
  readonly pressed: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={up ? "Good answer" : "Bad answer"}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        QUIET_BUTTON_CLASSES,
        pressed
          ? "stg:text-foreground"
          : "stg:text-muted-foreground-subtle stg:opacity-0 stg:group-hover:opacity-100 stg:focus-visible:opacity-100",
      )}
    >
      <ThumbIcon up={up} />
    </button>
  );
}

function HealthChip({ view }: { readonly view: RunHealthView }) {
  const [open, setOpen] = useState(false);
  if (view.kind === "pending" || view.kind === "healthy") return null;
  if (view.kind === "not-graded") {
    return (
      <span className="stg:ml-1 stg:text-xs stg:text-muted-foreground-subtle">
        Not graded{view.reason !== "" ? `: ${view.reason}` : ""}
      </span>
    );
  }
  // Narrowed to "flagged": a kind added to the union fails to compile here.
  const label = `${view.flags.length} ${view.flags.length === 1 ? "flag" : "flags"}`;
  return (
    <span className="stg:ml-1 stg:inline-flex stg:flex-col stg:gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "stg:inline-flex stg:h-6 stg:items-center stg:rounded-full stg:border stg:border-border stg:px-2 stg:text-xs stg:text-warning",
          "stg:hover:bg-accent-hover stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        )}
      >
        {label}
      </button>
      {open && (
        <ul
          className={cn(
            UNSTYLED_LIST,
            "stg:flex stg:flex-col stg:gap-0.5 stg:text-xs stg:text-muted-foreground",
          )}
        >
          {view.flags.map((flag) => (
            <li key={flag.name}>
              {flag.reason !== "" ? flag.reason : flag.name}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/** The rubric names, as a person reads them. */
const RUBRIC_LABELS: Readonly<Record<string, string>> = {
  "did-the-task": "Did the task",
  "made-nothing-up": "Made nothing up",
};

const RESULT_LABELS: Readonly<Record<CriterionResult, string>> = {
  [CriterionResult.unspecified]: "",
  [CriterionResult.passed]: "passed",
  [CriterionResult.failed]: "failed",
  [CriterionResult.not_applicable]: "not applicable",
};

function JudgeChip({ view }: { readonly view: JudgeView }) {
  const [open, setOpen] = useState(false);
  if (view.kind === "none") return null;
  if (view.kind === "grading") {
    return (
      <span
        role="status"
        className="stg:ml-1 stg:text-xs stg:text-muted-foreground-subtle"
      >
        Judge: grading…
      </span>
    );
  }
  if (view.kind === "not-graded") {
    return (
      <span className="stg:ml-1 stg:text-xs stg:text-muted-foreground-subtle">
        Judge: not graded{view.reason !== "" ? `: ${view.reason}` : ""}
      </span>
    );
  }
  // Narrowed to "graded": a kind added to the union fails to compile here.
  const label = view.passed
    ? "Judge: passed"
    : `Judge: ${view.failed} of ${view.criteria.length} failed`;
  return (
    <span className="stg:ml-1 stg:inline-flex stg:flex-col stg:gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "stg:inline-flex stg:h-6 stg:items-center stg:rounded-full stg:border stg:border-border stg:px-2 stg:text-xs",
          view.passed ? "stg:text-muted-foreground" : "stg:text-warning",
          "stg:hover:bg-accent-hover stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        )}
      >
        {label}
      </button>
      {open && (
        <ul
          className={cn(
            UNSTYLED_LIST,
            "stg:flex stg:flex-col stg:gap-0.5 stg:text-xs stg:text-muted-foreground",
          )}
        >
          {view.criteria.map((criterion) => (
            <li key={criterion.name}>
              {RUBRIC_LABELS[criterion.name] ?? criterion.name}:{" "}
              {RESULT_LABELS[criterion.result]}
              {criterion.reason !== "" ? ` — ${criterion.reason}` : ""}
            </li>
          ))}
          {view.model !== "" && (
            <li className="stg:text-muted-foreground-subtle">
              Graded by {view.model}
            </li>
          )}
        </ul>
      )}
    </span>
  );
}

function EvalChip({ view }: { readonly view: EvalView }) {
  const [open, setOpen] = useState(false);
  if (view.kind === "none") return null;
  if (view.kind === "not-graded") {
    return (
      <span className="stg:ml-1 stg:text-xs stg:text-muted-foreground-subtle">
        Eval: not graded{view.reason !== "" ? `: ${view.reason}` : ""}
      </span>
    );
  }
  // Narrowed to "graded": a kind added to the union fails to compile here.
  const label = view.passed
    ? "Eval: passed"
    : `Eval: ${view.failed} of ${view.criteria.length} failed`;
  return (
    <span className="stg:ml-1 stg:inline-flex stg:flex-col stg:gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "stg:inline-flex stg:h-6 stg:items-center stg:rounded-full stg:border stg:border-border stg:px-2 stg:text-xs",
          view.passed ? "stg:text-muted-foreground" : "stg:text-warning",
          "stg:hover:bg-accent-hover stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        )}
      >
        {label}
      </button>
      {open && (
        <ul
          className={cn(
            UNSTYLED_LIST,
            "stg:flex stg:flex-col stg:gap-0.5 stg:text-xs stg:text-muted-foreground",
          )}
        >
          {view.criteria.map((criterion) => (
            <li key={criterion.name}>
              {criterion.name}: {RESULT_LABELS[criterion.result]}
              {criterion.reason !== "" ? ` — ${criterion.reason}` : ""}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/**
 * Builds the run's test case when pressed and downloads it as a zip; a run
 * that continued a conversation says the case holds only its last request.
 */
function MakeTestCaseButton({
  onMake,
}: {
  readonly onMake: () => ReturnType<typeof testCaseOfRun>;
}) {
  const [note, setNote] = useState<string | null>(null);
  const onClick = (): void => {
    const testCase = onMake();
    downloadBinaryFile(
      zipTestCase(testCase),
      `${testCase.caseName}.zip`,
      "application/zip",
    );
    setNote(
      testCase.note === undefined
        ? null
        : `Test case ${testCase.caseName}: ${testCase.note}.`,
    );
  };
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "stg:ml-1 stg:inline-flex stg:h-6 stg:items-center stg:rounded-md stg:px-2 stg:text-xs stg:transition",
          "stg:hover:bg-accent-hover stg:hover:text-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          note === null
            ? "stg:text-muted-foreground-subtle stg:opacity-0 stg:group-hover:opacity-100 stg:focus-visible:opacity-100"
            : "stg:text-muted-foreground",
        )}
      >
        Make a test case
      </button>
      {note !== null && (
        <span
          role="status"
          className="stg:ml-1 stg:text-xs stg:text-muted-foreground-subtle"
        >
          {note}
        </span>
      )}
    </>
  );
}

function ThumbIcon({ up }: { readonly up: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={up ? undefined : "stg:rotate-180"}
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}
