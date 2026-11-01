/**
 * The sandbox section's "sleep" artifact: what happens after the last reply,
 * in order, with no clock times (Stigmer Cloud's window is its own setting),
 * then the rule that holds it awake, set apart, and a link to the hard
 * parts' sandbox row, which prints the measured wake with its method.
 */
import { SANDBOX_SLEEP } from "../../../../../brand/sandbox";

export function SleepSteps() {
  return (
    <div className="flex flex-col gap-4">
      <ol className="m-0 p-0 list-none flex flex-col">
        {SANDBOX_SLEEP.steps.map((step, index) => (
          <li
            key={step}
            className="relative pl-9 pb-4 last:pb-0 text-sm leading-relaxed text-foreground"
          >
            <span
              aria-hidden="true"
              className="absolute left-0 top-0 grid size-6 place-items-center rounded-full border border-border font-mono text-xs text-subtle bg-card"
            >
              {index + 1}
            </span>
            {index < SANDBOX_SLEEP.steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute left-3 top-6 bottom-0 border-l border-border"
              />
            ) : null}
            {step}
          </li>
        ))}
      </ol>
      <p className="m-0 rounded-md border border-border px-4 py-3 text-sm text-foreground">
        {SANDBOX_SLEEP.never}
      </p>
      <a
        href={SANDBOX_SLEEP.wakeLink.href}
        className="self-start text-sm text-foreground underline underline-offset-4 hover:text-foreground/80"
      >
        {SANDBOX_SLEEP.wakeLink.label}
      </a>
    </div>
  );
}
