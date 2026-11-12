"use client";

// The launcher's first state for an organization where nothing has run: it
// asks what the newcomer's agent should do for their users, says in one line
// why they would make one at all, and offers four example jobs (each naming
// what a user hands over and what comes back), a way to describe their own,
// and a way to just chat. After a pick, the chosen bar says what was made and
// what is attached, with a way back to the cards.
//
// Built to the onboarding design's principles: room before size (14px text on
// 20px lines, 14px padding inside a card, gaps set by the layout), one primary
// act, state shown by form, hierarchy by weight and tone, a reading-width
// column, and words from the user's side. The data comes from
// `@stigmer/examples`, the one list every reader shares.

import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { Check, FileText, Loader2 } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import type { Example } from "@stigmer/examples";
import { Button } from "../../button/Button.js";
import type { FirstChoice, FirstChoiceFailure, FirstChoicePending } from "./useStartFromExample.js";

/** The question, as the person reads it. */
export const FIRST_QUESTION_HEADING = "What should your agent do for your users?";
/** The line under it: why anyone would make an agent here. */
export const FIRST_QUESTION_WHY =
  "Stigmer runs agents inside your product, doing jobs for your users. Pick an example and watch one do its job on a sample file, or describe your own.";
/** The way out to today's launcher. */
export const JUST_CHAT = "Just chat with Stigmer";

/** Props for {@link FirstQuestion}. */
export interface FirstQuestionProps {
  readonly examples: readonly Example[];
  /** What is being made right now: an example's id, `"own"`, or `null`. */
  readonly pending: FirstChoicePending;
  /** The last pick's failure, shown beside what failed. */
  readonly failure: FirstChoiceFailure | null;
  readonly onPick: (example: Example) => void;
  readonly onDescribe: (words: string) => void;
  /** Leaves the question for today's launcher, for this visit. */
  readonly onJustChat: () => void;
}

/** A file's name in a chip, the way the composer shows an attachment. */
export function FileChip({ name }: { readonly name: string }) {
  return (
    <span className="stg:inline-flex stg:max-w-full stg:items-center stg:gap-1.5 stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-2 stg:py-0.5 stg:font-mono stg:text-2xs stg:text-foreground">
      <FileText aria-hidden="true" className="stg:size-3 stg:shrink-0 stg:text-muted-foreground" />
      <span className="stg:truncate">{name}</span>
    </span>
  );
}

/** A failed pick: what happened, why, and the one act. */
function PickFailure({ failure, onRetry, onJustChat }: { readonly failure: FirstChoiceFailure; readonly onRetry: () => void; readonly onJustChat: () => void }) {
  return (
    <div role="alert" className="stg:space-y-2 stg:rounded-lg stg:border stg:border-destructive-muted stg:bg-destructive-subtle stg:px-3.5 stg:py-3 stg:text-sm">
      <p className="stg:m-0 stg:font-medium stg:text-foreground">{failure.title}</p>
      <p className="stg:m-0 stg:leading-5 stg:text-muted-foreground">{failure.detail}</p>
      <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-3">
        <Button size="xs" onClick={onRetry}>
          Try again
        </Button>
        <button
          type="button"
          onClick={onJustChat}
          className="stg:text-xs stg:text-muted-foreground stg:underline stg:underline-offset-2 stg:hover:text-foreground"
        >
          {JUST_CHAT}
        </button>
      </div>
    </div>
  );
}

/** One example's card: whose product, the job, what goes in and what comes back, its sample. */
function ExampleCard({ example, busy, disabled, onPick }: { readonly example: Example; readonly busy: boolean; readonly disabled: boolean; readonly onPick: () => void }) {
  const forId = useId();
  const ioId = useId();
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-busy={busy || undefined}
      // The accessible name is the job's; whose product, what goes in and
      // what comes back are its description.
      aria-label={example.name}
      aria-describedby={`${forId} ${ioId}`}
      className={cn(
        "stg:flex stg:min-w-0 stg:flex-col stg:gap-2 stg:rounded-xl stg:border stg:border-border stg:bg-card stg:px-3.5 stg:pt-3.5 stg:pb-3 stg:text-left stg:text-foreground",
        "stg:transition-colors stg:hover:border-border-prominent stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        "stg:disabled:cursor-default",
        busy && "stg:border-primary stg:ring-1 stg:ring-primary",
        disabled && !busy && "stg:opacity-60",
      )}
    >
      <span id={forId} className="stg:text-2xs stg:text-muted-foreground">{example.for}</span>
      <span className="stg:flex stg:items-center stg:gap-2 stg:text-sm stg:font-semibold">
        {example.name}
        {busy && <Loader2 aria-hidden="true" className="stg:size-3.5 stg:animate-spin stg:text-muted-foreground" />}
      </span>
      <dl id={ioId} className="stg:m-0 stg:grid stg:grid-cols-[4.5rem_minmax(0,1fr)] stg:gap-x-2 stg:gap-y-1 stg:text-xs stg:leading-5">
        <dt className="stg:text-muted-foreground">They give</dt>
        <dd className="stg:m-0">{example.gives}</dd>
        <dt className="stg:text-muted-foreground">They get</dt>
        <dd className="stg:m-0">{example.gets}</dd>
      </dl>
      <span className="stg:flex stg:flex-wrap stg:gap-1.5">
        {example.samples.map((sample) => (
          <FileChip key={sample.name} name={sample.name} />
        ))}
      </span>
      {busy && <span className="stg:text-2xs stg:text-muted-foreground">Making {example.agent.name}{"…"}</span>}
    </button>
  );
}

/** The "Describe your own" row, which opens a text box in place. */
function DescribeOwn({ pending, failure, onDescribe, onJustChat }: Pick<FirstQuestionProps, "pending" | "failure" | "onDescribe" | "onJustChat">) {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState("");
  const fieldId = useId();
  const hintId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const busy = pending === "own";
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-3 stg:rounded-xl stg:border stg:border-border stg:bg-card stg:px-3.5 stg:py-3">
        <div className="stg:min-w-48 stg:flex-1">
          <p className="stg:m-0 stg:text-sm stg:font-medium stg:text-foreground">Describe your own</p>
          <p className="stg:m-0 stg:text-xs stg:leading-5 stg:text-muted-foreground">Say what it should do for your users, in a sentence or two.</p>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)} disabled={pending !== null}>
          Describe it
        </Button>
      </div>
    );
  }
  const submit = () => {
    if (words.trim() !== "" && pending === null) onDescribe(words);
  };
  return (
    <div className="stg:flex stg:flex-col stg:gap-2.5 stg:rounded-xl stg:border stg:border-border stg:bg-card stg:p-3.5">
      <label htmlFor={fieldId} className="stg:text-sm stg:font-medium stg:text-foreground">
        Describe your own
      </label>
      <textarea
        id={fieldId}
        ref={field}
        rows={3}
        value={words}
        onChange={(event) => setWords(event.target.value)}
        aria-describedby={hintId}
        placeholder="Read a user's shipping manifest and list every parcel that will miss its promised date, with the reason."
        className="stg:w-full stg:resize-y stg:rounded-lg stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:text-sm stg:leading-5 stg:text-foreground stg:placeholder:text-muted-foreground stg:focus:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
      />
      <p id={hintId} className="stg:m-0 stg:text-xs stg:leading-5 stg:text-muted-foreground">
        Stigmer uses your words as the agent&apos;s instructions, and adds one line so it saves what it makes as a file you can download. There&apos;s no sample for a job only you know, so its first message takes one of your own files. You can sharpen the instructions after it runs.
      </p>
      {failure !== null && failure.of === "own" && <PickFailure failure={failure} onRetry={submit} onJustChat={onJustChat} />}
      <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
        <Button onClick={submit} disabled={words.trim() === "" || pending !== null} aria-busy={busy || undefined}>
          {busy ? "Making your agent…" : "Make this agent"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Back to examples
        </Button>
      </div>
    </div>
  );
}

/**
 * The launcher's first question: four example jobs, "Describe your own" and
 * "Just chat with Stigmer". Presentational; {@link useStartFromExample}
 * makes the agents.
 */
export function FirstQuestion({ examples, pending, failure, onPick, onDescribe, onJustChat }: FirstQuestionProps) {
  const headingId = useId();
  const failedExample = failure !== null ? examples.find((example) => example.id === failure.of) : undefined;
  return (
    <section aria-labelledby={headingId} className="stg:flex stg:w-full stg:flex-col stg:gap-4">
      <div className="stg:text-center">
        <h1 id={headingId} className="stg:m-0 stg:text-xl stg:font-semibold stg:tracking-tight stg:text-balance stg:text-foreground">
          {FIRST_QUESTION_HEADING}
        </h1>
        <p className="stg:mx-auto stg:mt-1.5 stg:mb-0 stg:max-w-[60ch] stg:text-sm stg:leading-5 stg:text-muted-foreground">{FIRST_QUESTION_WHY}</p>
      </div>
      <div className="stg:grid stg:grid-cols-1 stg:gap-2.5 stg:sm:grid-cols-2">
        {examples.map((example) => (
          <ExampleCard
            key={example.id}
            example={example}
            busy={pending === example.id}
            disabled={pending !== null}
            onPick={() => onPick(example)}
          />
        ))}
      </div>
      {failedExample !== undefined && failure !== null && (
        <PickFailure failure={failure} onRetry={() => onPick(failedExample)} onJustChat={onJustChat} />
      )}
      <DescribeOwn pending={pending} failure={failure} onDescribe={onDescribe} onJustChat={onJustChat} />
      <div className="stg:flex stg:justify-end">
        <button
          type="button"
          onClick={onJustChat}
          disabled={pending !== null}
          className="stg:text-xs stg:text-muted-foreground stg:underline-offset-2 stg:hover:text-foreground stg:hover:underline stg:disabled:opacity-60"
        >
          {JUST_CHAT}
        </button>
      </div>
    </section>
  );
}

/** Props for {@link ChosenBar}. */
export interface ChosenBarProps {
  readonly choice: FirstChoice;
  /** Back to the cards; the agent stays made. */
  readonly onChange: () => void;
  /** Receives focus after the pick, so a keyboard or screen-reader user lands on what was made. */
  readonly focusRef?: Ref<HTMLDivElement>;
}

/** What a pick made and attached: "Variance Reporter is made. Its sample ledger is attached." */
export function chosenLine(choice: FirstChoice): string {
  const { example, agentName } = choice;
  if (example === undefined) return `${agentName} is made. Attach one of your own files to its first message.`;
  const verb = example.samples.length > 1 ? "are" : "is";
  return `${agentName} is made. Its sample ${example.sampleName} ${verb} attached.`;
}

/** The bar above the key step or the composer once a pick has made its agent. */
export function ChosenBar({ choice, onChange, focusRef }: ChosenBarProps): ReactNode {
  return (
    <div
      ref={focusRef}
      tabIndex={-1}
      className="stg:flex stg:flex-wrap stg:items-center stg:gap-2.5 stg:rounded-xl stg:border stg:border-border stg:bg-card stg:px-3 stg:py-2.5 stg:focus:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
    >
      <span aria-hidden="true" className="stg:flex stg:size-[18px] stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-success stg:text-background">
        <Check className="stg:size-3" strokeWidth={3} />
      </span>
      <div className="stg:min-w-44 stg:flex-1">
        <p className="stg:m-0 stg:text-sm stg:font-semibold stg:text-foreground">{choice.example?.name ?? choice.agentName}</p>
        <p className="stg:m-0 stg:text-xs stg:leading-5 stg:text-muted-foreground">{chosenLine(choice)}</p>
      </div>
      {choice.files.map((file) => (
        <FileChip key={file.name} name={file.name} />
      ))}
      <button
        type="button"
        onClick={onChange}
        className="stg:text-xs stg:text-muted-foreground stg:underline-offset-2 stg:hover:text-foreground stg:hover:underline"
      >
        Change
      </button>
    </div>
  );
}
