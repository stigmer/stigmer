"use client";

/**
 * The first-job block's "Your app" tab at one moment: the Getting Started
 * program, whole and in plain monochrome lines, beside a drawing of what
 * Northwind Books sees.
 *
 * The program is real text a reader can select. Its lit call stands out, the
 * others dim, and the column scrolls to the lit call; under it a console strip
 * shows the command and, once the files are back, what the program printed.
 * The drawing is the site's own boxes and lines, never a product screen: a
 * frame named for the customer, the ledger with its upload bar, the Agent's
 * working line with its clock, and the report table, flagged accounts first.
 * It is hidden from screen readers, and `CAPTION` says what it shows; nothing
 * here is a live region, so a screen reader is not read each moment. Below
 * 760px the code sits over the drawing.
 *
 * The words and moments are ./first-job-app.ts, held to their pages there.
 */
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { JOB } from "../../../../brand/job-story";
import { CALLS, CAPTION, COMMAND, PRINTS, PROGRAM, REPORT, REPORT_TITLE, WORKED_SECONDS, type AppMoment } from "./first-job-app";

/** Which call a line of the program belongs to: 1, 2 or 3, or 0 for none. */
export function callOf(line: number): 0 | 1 | 2 | 3 {
  const at = CALLS.findIndex((call) => line >= call.from && line <= call.to);
  return (at + 1) as 0 | 1 | 2 | 3;
}

const LABEL = "font-mono text-[10px] leading-[14px] tracking-[0.06em] uppercase";

export interface FirstJobAppProps {
  moment: AppMoment;
  /** The reader asked for less motion: the column jumps to the lit call instead of scrolling. */
  reduced: boolean;
}

export function FirstJobApp({ moment, reduced }: FirstJobAppProps) {
  const column = useRef<HTMLPreElement>(null);

  // The column scrolls so the lit call's first line sits near its top.
  useEffect(() => {
    if (moment.call === 0) return;
    const element = column.current!;
    const first = element.querySelector<HTMLElement>(`[data-call="${moment.call}"]`)!;
    element.scrollTo?.({ top: Math.max(0, first.offsetTop - 12), behavior: reduced ? "auto" : "smooth" });
  }, [moment.call, reduced]);

  const working = moment.seconds !== null && moment.seconds < WORKED_SECONDS;
  return (
    <div className="grid h-full grid-cols-1 min-[760px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="flex min-h-0 min-w-0 flex-col">
        <pre
          ref={column}
          className="m-0 max-h-56 flex-1 overflow-auto bg-transparent py-3 font-mono text-[11.5px] leading-[1.6] min-[760px]:max-h-none"
        >
          <code className="block min-w-max">
            {PROGRAM.map((line, i) => {
              const call = callOf(i);
              const lit = moment.call !== 0 && call === moment.call;
              return (
                <span
                  key={i}
                  data-call={call}
                  data-lit={lit || undefined}
                  className={cn(
                    "flex border-l-2 pr-4 pl-3 transition-opacity duration-300 motion-reduce:transition-none",
                    lit ? "border-fd-foreground bg-fd-accent text-fd-foreground" : "border-transparent text-fd-muted-foreground",
                    moment.call !== 0 && !lit && "opacity-40",
                  )}
                >
                  <span aria-hidden="true" className="inline-block w-7 shrink-0 text-fd-muted-foreground/50 select-none">
                    {i + 1}
                  </span>
                  <span data-code-line="">{line === "" ? " " : line}</span>
                </span>
              );
            })}
          </code>
        </pre>
        <div data-console="" className="border-t border-fd-border px-4 py-2 font-mono text-[11.5px] leading-[1.6]">
          <div className="text-fd-muted-foreground">$ {COMMAND}</div>
          <div className="min-h-[1lh] text-fd-foreground">{moment.printed ? PRINTS : ""}</div>
        </div>
      </div>

      <figure className="m-0 flex min-w-0 flex-col gap-2 overflow-auto border-t border-fd-border p-3.5 min-[760px]:border-t-0 min-[760px]:border-l">
        <div aria-hidden="true" data-first-job-drawing="" className="flex flex-col gap-2 font-sans text-foreground">
          <span className={cn(LABEL, "text-muted-foreground")}>In your product</span>
          <div className="flex flex-col rounded-lg border border-border bg-card">
            <span className="border-b border-border px-3 py-2 text-[12.5px] font-semibold">{JOB.customer}</span>
            <div className="flex flex-col gap-2.5 p-3 text-xs">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-7 shrink-0 items-end justify-center rounded border border-subtle pb-1 font-mono text-[8.5px] text-muted-foreground uppercase">
                  csv
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-mono text-[11.5px] font-medium">{JOB.ledger}</span>
                  <span className="text-[11px] text-muted-foreground">{REPORT.length} accounts, budget and actual</span>
                </span>
                <span data-upload={moment.upload} className="ml-auto font-mono text-[10.5px] text-muted-foreground">
                  {moment.upload}
                </span>
              </div>
              <span className="h-0.5 overflow-hidden rounded bg-border">
                <span
                  className={cn(
                    "block h-full bg-foreground motion-reduce:transition-none",
                    moment.upload === "ready" ? "w-0" : "w-full",
                    moment.upload === "uploading" && "transition-[width] duration-900 ease-out",
                  )}
                />
              </span>
              {moment.seconds !== null && (
                <span data-working={working ? "working" : "finished"} className="flex items-center gap-2 border-t border-border pt-2.5">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      working ? "animate-pulse bg-foreground motion-reduce:animate-none" : "border border-muted-foreground",
                    )}
                  />
                  <span>{working ? `${JOB.agent} is working` : `${JOB.agent} finished`}</span>
                  <span data-clock="" className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
                    {moment.seconds}s
                  </span>
                </span>
              )}
              {moment.rows !== null && (
                <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
                  <span className="flex items-baseline gap-2 text-[12.5px] font-semibold">
                    {REPORT_TITLE}
                    <span className="font-mono text-[10.5px] font-normal text-muted-foreground">{JOB.report}</span>
                  </span>
                  <table className="w-full border-collapse text-[11px] tabular-nums">
                    <tbody>
                      {REPORT.map((row, i) => (
                        <tr
                          key={row.account}
                          data-shown={i < moment.rows! || undefined}
                          className={cn("transition-opacity duration-300 motion-reduce:transition-none", i < moment.rows! ? "opacity-100" : "opacity-0")}
                        >
                          <td className="border-b border-border py-1">{row.account}</td>
                          <td className="border-b border-border py-1 pl-2 text-right text-muted-foreground">{row.variance}</td>
                          <td className="border-b border-border py-1 pl-2 text-right text-muted-foreground">{row.percent}</td>
                          <td className="border-b border-border py-1 pl-2 text-right">
                            {row.flag !== "" && (
                              <span className="rounded-sm border border-subtle px-1 font-mono text-[9.5px] tracking-[0.05em] uppercase">{row.flag}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
        <figcaption className="sr-only">{CAPTION}</figcaption>
      </figure>
    </div>
  );
}
