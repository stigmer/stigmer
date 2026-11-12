"use client";

/**
 * `<FirstJob />`: the docs front page's first agent job, played.
 *
 * One box with two tabs over a shared bar. **Terminal** plays the terminal
 * kit's `first-job` recording, the quickstart's `stigmer run` as the terminal
 * draws it (src/components/visuals/TerminalScreen.tsx). **Your app** plays the
 * next page's program call by call beside a drawing of what Northwind Books
 * sees (src/components/visuals/FirstJobApp.tsx). Both tabs are one height and
 * run on the docs' playback engine (src/components/visuals/playback.ts): the
 * Terminal starts once the box scrolls into view, and a tab chosen plays from
 * its start. The bar names the program on the code tab, replays the tab
 * showing, and copies the program. The footer holds the install line and
 * both step-by-step pages, so a reader can start without scrolling, and on the
 * Terminal tab the line every recording carries.
 *
 * The tabs are fumadocs' unstyled ones (roles and arrow keys, no look), and
 * Copy is the hook the docs' code blocks use. The markdown exports carry the
 * block as text (`FirstJob` in src/lib/llms-pages.ts).
 */
import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Check, Copy, RotateCcw, SquareCode, SquareTerminal } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "fumadocs-ui/components/tabs.unstyled";
import { useCopyButton } from "fumadocs-ui/utils/use-copy-button";
import { cn } from "@/lib/utils";
import { RECORDED_LINE, recording } from "@/lib/recordings";
import { usePlayback } from "@/components/visuals/playback";
import { TerminalScreen } from "@/components/visuals/TerminalScreen";
import { FirstJobApp } from "@/components/visuals/FirstJobApp";
import { INSTALL, RECORDING, STEP_BY_STEP, TERMINAL_ALT } from "@/components/visuals/first-job";
import { MOMENTS, PROGRAM, PROGRAM_FILE } from "@/components/visuals/first-job-app";

type Tab = "terminal" | "app";

const TRIGGER =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium text-fd-muted-foreground outline-none hover:text-fd-foreground focus-visible:ring-2 focus-visible:ring-fd-ring data-[state=active]:bg-fd-accent data-[state=active]:text-fd-foreground";
const ICON_BUTTON =
  "inline-grid size-7 shrink-0 place-items-center rounded-md border border-transparent text-fd-muted-foreground outline-none hover:border-fd-border hover:text-fd-foreground focus-visible:ring-2 focus-visible:ring-fd-ring";
const LINK = "text-fd-foreground underline decoration-fd-border underline-offset-4 hover:decoration-fd-foreground";

export function FirstJob({ className }: { className?: string }) {
  const held = recording(RECORDING);
  const terminalTimes = useMemo(() => held.frames.map((frame) => frame.at), [held]);
  const appTimes = useMemo(() => MOMENTS.map((moment) => moment.at), []);
  const terminal = usePlayback(terminalTimes);
  const app = usePlayback(appTimes, { startInView: false });
  const [tab, setTab] = useState<Tab>("terminal");
  const [copied, copy] = useCopyButton(() => navigator.clipboard.writeText(`${PROGRAM.join("\n")}\n`));

  const showing = tab === "terminal" ? terminal : app;
  const choose = (value: string) => {
    const next = value as Tab;
    setTab(next);
    (next === "terminal" ? app : terminal).pause();
    (next === "terminal" ? terminal : app).replay();
  };
  // The panes share the terminal's height: its rows at 13px and 1.35 line height, and the screen's padding.
  const paneHeight = `calc(${held.rows} * 1.35 * 13px + 2rem)`;

  return (
    <figure
      ref={terminal.box}
      data-first-job=""
      className={cn("not-prose m-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card text-fd-foreground", className)}
    >
      <Tabs value={tab} onValueChange={choose}>
        <div className="flex items-center gap-2 border-b border-fd-border bg-fd-muted/50 py-1.5 pr-2 pl-1.5">
          <TabsList aria-label="Where you run the job" className="flex gap-0.5">
            <TabsTrigger value="terminal" className={TRIGGER}>
              <SquareTerminal aria-hidden="true" className="size-3.5" />
              Terminal
            </TabsTrigger>
            <TabsTrigger value="app" className={TRIGGER}>
              <SquareCode aria-hidden="true" className="size-3.5" />
              Your app
            </TabsTrigger>
          </TabsList>
          <span className="ml-auto min-w-0 truncate font-mono text-[11.5px] text-fd-muted-foreground max-sm:hidden">
            {tab === "app" ? PROGRAM_FILE : ""}
          </span>
          {!showing.reduced && (
            <button type="button" className={cn(ICON_BUTTON, "max-sm:ml-auto")} aria-label="Play again" title="Play again" onClick={showing.replay}>
              <RotateCcw aria-hidden="true" className="size-3.5" />
            </button>
          )}
          {tab === "app" && (
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label={copied ? "Copied" : `Copy ${PROGRAM_FILE}`}
              title={copied ? "Copied" : `Copy ${PROGRAM_FILE}`}
              onClick={copy}
            >
              {copied ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
            </button>
          )}
        </div>

        <TabsContent value="terminal" forceMount className="data-[state=inactive]:hidden">
          {/* A phone scrolls the terminal sideways, so the box takes focus for a keyboard to scroll it. */}
          <div tabIndex={0} role="region" aria-label="Terminal recording" className="overflow-x-auto bg-black" style={{ height: paneHeight }}>
            <TerminalScreen recording={held} index={terminal.index} alt={TERMINAL_ALT} />
          </div>
        </TabsContent>
        <TabsContent
          value="app"
          forceMount
          className="data-[state=inactive]:hidden min-[760px]:h-(--pane)"
          style={{ "--pane": paneHeight } as CSSProperties}
        >
          <FirstJobApp moment={MOMENTS[app.index]!} reduced={app.reduced} />
        </TabsContent>
      </Tabs>

      <figcaption className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 border-t border-fd-border px-3.5 py-2.5 text-[12.5px] text-fd-muted-foreground">
        <span className="font-mono text-xs">
          Install: <code className="text-fd-foreground">{INSTALL}</code>
        </span>
        <span className="sm:ml-auto">
          Step by step:{" "}
          {STEP_BY_STEP.map((page, i) => (
            <span key={page.href}>
              {i > 0 && " · "}
              <Link href={page.href} className={LINK}>
                {page.title}
              </Link>
            </span>
          ))}
        </span>
        {tab === "terminal" && <span className="basis-full text-xs">{RECORDED_LINE}</span>}
      </figcaption>
    </figure>
  );
}
