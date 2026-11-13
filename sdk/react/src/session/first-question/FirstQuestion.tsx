"use client";

// The launcher's first state for an organization where nothing has run: it
// asks what the newcomer's agent should do for their users, says in one line
// why they would make one at all, and offers four example jobs (each naming
// what a user hands over and what comes back), a way to describe their own,
// and a way to just chat. Under them, for a person who would rather hand
// setup to Claude Code, Cursor or Codex, one quiet line opens the prompt to
// paste into their coding agent, with this console's own address in it, so
// the coding agent sets up against this server. After a pick, the chosen bar
// says what was made and what is attached, with a way back to the cards.
//
// Built to the onboarding design's principles: room before size (14px text on
// 20px lines, 14px padding inside a card, gaps set by the layout), one primary
// act, state shown by form, hierarchy by weight and tone, a reading-width
// column, and words from the user's side. The data comes from
// `@stigmer/examples`, the one list every reader shares; the launcher loads
// this module only when it shows the question, so a launcher that never
// asks it (an embed, a returning person) never downloads the list.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, FileText, Loader2 } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import { EXAMPLES, type Example } from "@stigmer/examples";
import { Button } from "../../button/Button.js";
import { Notice } from "../../internal/surface/Notice.js";
import { CopyButton, useCopy } from "../../internal/CopyBlock.js";
import type { FirstChoice, FirstChoiceFailure, FirstChoicePending } from "./useStartFromExample.js";

/** The question, as the person reads it. */
export const FIRST_QUESTION_HEADING = "What should your agent do for your users?";
/** The line under it: why anyone would make an agent here. */
export const FIRST_QUESTION_WHY =
  "Stigmer runs agents inside your product, doing jobs for your users. Pick an example and watch one do its job on a sample file, or describe your own.";
/** The way out to today's launcher. */
export const JUST_CHAT = "Just chat with Stigmer";
/** The coding-agent door's link, under the cards. */
export const CODING_AGENT_LINK = "Let your coding agent set it up";
/** The prompt's body, the same words stigmer.ai's coding-agent page gives. */
export const CODING_AGENT_PROMPT =
  "Set up Stigmer for this project. Install its command line (`npm install -g @stigmer/cli`, or `brew install stigmer/tap/stigmer`), run `stigmer coding-agent`, and follow what it prints.";

/**
 * The prompt a person pastes into their coding agent: {@link CODING_AGENT_PROMPT},
 * then, when the console knows its public address, one sentence that sends
 * the coding agent to this server rather than asking where Stigmer runs.
 */
export function codingAgentPrompt(address: string | null | undefined): string {
  return address ? `${CODING_AGENT_PROMPT} Use the Stigmer at ${address}.` : CODING_AGENT_PROMPT;
}

/** Props for {@link FirstQuestion}. */
export interface FirstQuestionProps {
  /** The jobs offered; Stigmer's examples unless a caller names its own. */
  readonly examples?: readonly Example[];
  /** What is being made right now: an example's id, `"own"`, or `null`. */
  readonly pending: FirstChoicePending;
  /** The last pick's failure, shown beside what failed. */
  readonly failure: FirstChoiceFailure | null;
  readonly onPick: (example: Example) => void;
  readonly onDescribe: (words: string) => void;
  /** Leaves the question for today's launcher, for this visit. */
  readonly onJustChat: () => void;
  /**
   * This console's public API address (`usePublicBaseUrl`), written into the
   * coding-agent prompt; without one the prompt leaves the coding agent to
   * ask where Stigmer runs.
   */
  readonly codingAgentAddress?: string | null;
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
    <Notice
      tone="failed"
      role="alert"
      headline={failure.title}
      act={{ label: "Try again", onClick: onRetry }}
      link={{ label: JUST_CHAT, onClick: onJustChat }}
    >
      <p className="stg:m-0">{failure.detail}</p>
    </Notice>
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

/** The coding-agent door: the line under the cards, and the prompt with Copy once opened. */
function CodingAgentDoor({ address, disabled, onJustChat }: { readonly address: string | null | undefined; readonly disabled: boolean; readonly onJustChat: () => void }) {
  const [open, setOpen] = useState(false);
  const prompt = codingAgentPrompt(address);
  const { copied, copy } = useCopy(prompt);
  const panelId = useId();
  const labelId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // The prompt opens under the cards, often below the fold: bring it into view.
  useEffect(() => {
    if (open) panel.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);
  return (
    <>
      <div role="separator" className="stg:flex stg:items-center stg:gap-2.5 stg:text-xs stg:text-muted-foreground stg:before:h-px stg:before:flex-1 stg:before:bg-border stg:after:h-px stg:after:flex-1 stg:after:bg-border">
        or
      </div>
      <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-x-4 stg:gap-y-1">
        <p className="stg:m-0 stg:text-xs stg:leading-5 stg:text-muted-foreground">
          Rather hand it to Claude Code, Cursor or Codex?{" "}
          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            aria-controls={panelId}
            className="stg:cursor-pointer stg:border-0 stg:bg-transparent stg:p-0 stg:text-xs stg:text-foreground stg:underline stg:decoration-border-prominent stg:underline-offset-[3px] stg:hover:decoration-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded-sm"
          >
            {CODING_AGENT_LINK}
          </button>
        </p>
        <Button variant="ghost" size="xs" onClick={onJustChat} disabled={disabled}>
          {JUST_CHAT}
        </Button>
      </div>
      {open && (
        <div ref={panel} id={panelId} className="stg:flex stg:flex-col stg:gap-2.5 stg:rounded-xl stg:border stg:border-border stg:bg-card stg:p-3.5">
          <p className="stg:m-0 stg:text-xs stg:leading-5 stg:text-muted-foreground">
            Paste this into your coding agent, in your app&apos;s folder. It installs Stigmer&apos;s command line, signs you in, suggests an agent from what your app does, runs it once, and puts its chat in your app with you.
          </p>
          <div className="stg:flex stg:items-center stg:justify-between">
            <p id={labelId} className="stg:m-0 stg:text-2xs stg:font-medium stg:text-muted-foreground">
              The prompt
            </p>
            <CopyButton copied={copied} onCopy={copy} />
          </div>
          <p
            aria-labelledby={labelId}
            className="stg:m-0 stg:rounded-lg stg:border stg:border-border stg:bg-muted-subtle stg:px-3 stg:py-2.5 stg:text-sm stg:leading-5 stg:text-foreground stg:whitespace-pre-wrap stg:break-words"
          >
            {prompt}
          </p>
        </div>
      )}
    </>
  );
}

/**
 * The launcher's first question: four example jobs, "Describe your own" and
 * "Just chat with Stigmer". Presentational; {@link useStartFromExample}
 * makes the agents.
 */
export function FirstQuestion({ examples = EXAMPLES, pending, failure, onPick, onDescribe, onJustChat, codingAgentAddress }: FirstQuestionProps) {
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
      <CodingAgentDoor address={codingAgentAddress} disabled={pending !== null} onJustChat={onJustChat} />
    </section>
  );
}

/** Props for {@link ChosenBar}. */
export interface ChosenBarProps {
  readonly choice: FirstChoice;
  /** Back to the cards; the agent stays made. */
  readonly onChange: () => void;
}

/** What a pick made and attached: "Variance Reporter is made. Its sample ledger is attached." */
export function chosenLine(choice: FirstChoice): string {
  const { example, agentName } = choice;
  if (example === undefined) return `${agentName} is made. Attach one of your own files to its first message.`;
  const verb = example.samples.length > 1 ? "are" : "is";
  return `${agentName} is made. Its sample ${example.sampleName} ${verb} attached.`;
}

/**
 * The bar above the key step or the composer once a pick has made its
 * agent. It takes focus when it appears, so a keyboard or screen-reader
 * user lands on what was made.
 */
export function ChosenBar({ choice, onChange }: ChosenBarProps): ReactNode {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bar.current?.focus();
  }, []);
  return (
    <div
      ref={bar}
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
      <Button variant="ghost" size="xs" onClick={onChange}>
        Change
      </Button>
    </div>
  );
}
