/**
 * The first-job block's words are its pages' own, and its "Your app" tab
 * draws each moment as the data says.
 *
 * The program is docs/getting-started/call-from-your-app.mdx's
 * `variance-report.ts` as `docSteps` reads it (the Getting Started smoke runs
 * that page as written), with its run command; what it prints is that page's
 * output block, and the report is the quickstart's sample report, both read
 * from the page itself because `docSteps` skips sample output. The install
 * line is the quickstart's first step, the recording types the quickstart's
 * own `stigmer run`, and the clock stops where the recording's last frame
 * says the Agent worked. The tab's moments light the three calls in order,
 * count the clock to that number and end with the job done; the drawing
 * shows each moment and is hidden from screen readers behind its caption.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docSteps } from "../../../../../test/install/lib/doc-steps.mjs";
import { JOB } from "../../../../../brand/job-story";
import { lastFrameText, recording } from "@/lib/recordings";
import { FirstJobApp, callOf } from "../FirstJobApp";
import { INSTALL, RECORDING, STEP_BY_STEP, TERMINAL_ALT } from "../first-job";
import { CALLS, CAPTION, COMMAND, MOMENTS, PRINTS, PROGRAM, PROGRAM_FILE, REPORT, REPORT_TITLE, WORKED_SECONDS, type AppMoment } from "../first-job-app";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const GETTING_STARTED = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../docs/getting-started");

function page(name: string): string {
  return readFileSync(resolve(GETTING_STARTED, name), "utf8");
}

type Step = { kind: "file"; path: string; content: string } | { kind: "command" | "harness"; line: string };

function steps(name: string): Step[] {
  return docSteps(page(name)) as Step[];
}

/** The body of the page's first fence opened with `opening`. */
function fence(mdx: string, opening: string): string[] {
  const lines = mdx.split("\n");
  const start = lines.indexOf(opening);
  if (start < 0) throw new Error(`no ${opening} fence`);
  const end = lines.indexOf("```", start + 1);
  return lines.slice(start + 1, end);
}

describe("the first-job block's words are its pages' own", () => {
  it("shows the app page's variance-report.ts line for line, run as that page runs it", () => {
    const program = steps("call-from-your-app.mdx").find((step) => step.kind === "file" && step.path === PROGRAM_FILE);
    if (program?.kind !== "file") throw new Error(`call-from-your-app.mdx writes ${PROGRAM_FILE}`);
    expect(PROGRAM).toEqual(program.content.replace(/\n$/, "").split("\n"));
    expect(steps("call-from-your-app.mdx")).toContainEqual({ kind: "command", line: COMMAND });
  });

  it("prints what the app page says it prints", () => {
    expect(fence(page("call-from-your-app.mdx"), "```text")).toEqual([PRINTS]);
  });

  it("draws the quickstart's sample report, flagged accounts first", () => {
    const report = fence(page("quickstart.mdx"), "```md");
    expect(report[0]).toBe(`# ${REPORT_TITLE}`);
    const rows = report
      .filter((line) => line.startsWith("| ") && !line.startsWith("| Account") && !line.startsWith("| ---"))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
      .map(([account, , , variance, percent, flag]) => ({ account, variance, percent, flag }));
    expect(REPORT).toEqual(rows);
    const flagged = REPORT.map((row) => row.flag !== "");
    expect(flagged).toEqual([...flagged].sort((a, b) => Number(b) - Number(a)));
  });

  it("offers the quickstart's first step as the install line, and its run as the recording's command", () => {
    const quickstart = steps("quickstart.mdx");
    expect(quickstart[0]).toMatchObject({ kind: "harness", line: INSTALL });
    expect(quickstart).toContainEqual({ kind: "command", line: recording(RECORDING).command });
  });

  it("stops the Agent's clock where the terminal says it worked", () => {
    expect(lastFrameText(RECORDING)).toContain(`Worked for ${WORKED_SECONDS}s`);
  });

  it("names the job as the brand's job story does, and links the two step-by-step pages", () => {
    for (const name of [JOB.agent, JOB.ledger, JOB.report]) {
      expect(TERMINAL_ALT).toContain(name);
      expect(CAPTION).toContain(name);
    }
    expect(TERMINAL_ALT).toContain(JOB.message);
    expect(CAPTION).toContain(JOB.customer);
    expect(CAPTION).toContain(PRINTS);
    expect(STEP_BY_STEP.map((link) => link.href)).toEqual(["/docs/getting-started/quickstart", "/docs/getting-started/call-from-your-app"]);
  });
});

describe("the program's three calls and the tab's moments", () => {
  it("spans each call from the line that makes it to the line that closes it, in order", () => {
    for (const call of CALLS) {
      expect(PROGRAM[call.from]).toContain(`${call.opens}(`);
      expect(["});", "}"]).toContain(PROGRAM[call.to]);
    }
    expect(CALLS.every((call, i) => i === 0 || call.from > CALLS[i - 1]!.to)).toBe(true);
    expect(PROGRAM.map((_, i) => callOf(i)).filter((call, i, all) => call !== 0 && call !== all[i - 1])).toEqual([1, 2, 3]);
  });

  it("moves forward in time, lights the calls in order, counts the clock to the Agent's time and ends with the job done", () => {
    expect(MOMENTS[0]).toEqual({ at: 0, call: 0, upload: "ready", seconds: null, rows: null, printed: false });
    expect(MOMENTS.every((moment, i) => i === 0 || moment.at > MOMENTS[i - 1]!.at)).toBe(true);
    const lit = MOMENTS.map((moment) => moment.call).filter((call, i, all) => call !== 0 && call !== all[i - 1]);
    expect(lit).toEqual([1, 2, 3]);
    const clock = [...new Set(MOMENTS.flatMap((moment) => (moment.seconds === null ? [] : [moment.seconds])))];
    expect(clock).toEqual(Array.from({ length: WORKED_SECONDS + 1 }, (_, i) => i));
    expect(MOMENTS.at(-1)).toMatchObject({ call: 0, upload: "uploaded", seconds: WORKED_SECONDS, rows: REPORT.length, printed: true });
  });
});

describe("FirstJobApp", () => {
  const at = (change: Partial<AppMoment>): AppMoment => ({ ...MOMENTS.at(-1)!, ...change });

  it("shows the whole program as text, the lit call standing out and the others dimmed", () => {
    const { container } = render(<FirstJobApp moment={at({ call: 2 })} reduced={false} />);
    expect([...container.querySelectorAll("[data-code-line]")].map((line) => line.textContent)).toEqual(PROGRAM.map((line) => (line === "" ? " " : line)));
    const lit = [...container.querySelectorAll("[data-lit]")].map((line) => Number(line.getAttribute("data-call")));
    expect(lit).toEqual(Array.from({ length: CALLS[1].to - CALLS[1].from + 1 }, () => 2));
    expect(container.querySelector('[data-call="1"]')!.className).toContain("opacity-40");
  });

  it("scrolls the column to the lit call, at once under reduced motion, and dims nothing when no call is lit", () => {
    const scrolled = vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
    const { container, rerender } = render(<FirstJobApp moment={at({ call: 0 })} reduced={false} />);
    expect(scrolled).not.toHaveBeenCalled();
    expect(container.querySelector(".opacity-40")).toBeNull();
    rerender(<FirstJobApp moment={at({ call: 3 })} reduced={false} />);
    expect(scrolled).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "smooth" }));
    rerender(<FirstJobApp moment={at({ call: 1 })} reduced />);
    expect(scrolled).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("draws the ledger going up, the Agent working with its clock, and the report coming back row by row", () => {
    const { container, rerender } = render(<FirstJobApp moment={MOMENTS[0]!} reduced={false} />);
    const drawing = () => container.querySelector("[data-first-job-drawing]")!;
    expect(drawing().querySelector("[data-upload]")!.textContent).toBe("ready");
    expect(drawing().querySelector("[data-working]")).toBeNull();
    expect(container.querySelector("[data-console]")!.textContent).toBe(`$ ${COMMAND}`);

    rerender(<FirstJobApp moment={at({ upload: "uploading", seconds: 12, rows: null, printed: false })} reduced={false} />);
    expect(drawing().querySelector("[data-working]")!.getAttribute("data-working")).toBe("working");
    expect(drawing().querySelector("[data-clock]")!.textContent).toBe("12s");
    expect(drawing().textContent).not.toContain(REPORT_TITLE);

    rerender(<FirstJobApp moment={at({ rows: 2 })} reduced={false} />);
    expect(drawing().querySelector("[data-working]")!.getAttribute("data-working")).toBe("finished");
    expect(drawing().querySelectorAll("[data-shown]")).toHaveLength(2);
    expect(container.querySelector("[data-console]")!.textContent).toBe(`$ ${COMMAND}${PRINTS}`);
  });

  it("hides the drawing from screen readers and says what it shows instead", () => {
    const { container } = render(<FirstJobApp moment={MOMENTS.at(-1)!} reduced />);
    expect(container.querySelector("[data-first-job-drawing]")!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText(CAPTION).tagName).toBe("FIGCAPTION");
    expect(container.querySelector("[aria-live]")).toBeNull();
  });
});
