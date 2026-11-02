/**
 * The picture on the docs' Sessions page, Northwind Books' Session as its
 * log: the order of its events, who writes each one, the phase lane folded
 * from the log's own statuses, its words, its list and its stylesheet.
 *
 * The order the server keeps is asserted by the conformance suite
 * (test/conformance/src/suites-execution/session-events-managed-agents.conformance.test.ts),
 * which a site test may not read, so this holds the rows to the rules that
 * suite and docs/concepts/approval-flows.mdx both state: a run opens with the
 * person's message and the Session starting to work, and ends idle at
 * `end_turn`; a call that asks is followed by the Session stopping with
 * `requires_action`, then the person's answer. Who writes what follows the
 * server's event catalog: the server the person's events and every status,
 * a runner what the agent did. Every word is held to the docs page that
 * spells it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionLog } from "../SessionLog";
import {
  ATTRIBUTE,
  FOLLOW_UP,
  PHASES,
  RUNS,
  SESSION_LOG_CSS,
  WIDE_FROM,
  marks,
  sessionPhases,
  type LogEvent,
  type Writer,
} from "../session-log";

afterEach(cleanup);

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../docs");

function docs(file: string): string {
  return readFileSync(resolve(DOCS, file), "utf8");
}

/** The job's words the log uses, and the docs page that tells them. */
const TOLD_IN: [string, string][] = [
  ["post_adjustment", "concepts/approval-flows.mdx"],
  ["ledger.csv", "concepts/what-is-stigmer.mdx"],
  ["variance-report.md", "concepts/what-is-stigmer.mdx"],
  ["flagged accounts", "concepts/sessions.mdx"],
];

const types = (events: readonly LogEvent[]) => events.map((event) => event.type);

/** Who writes an event, by its type, as the server's event catalog rules. */
function writerOf(type: string): Writer {
  if (type.startsWith("agent.")) return "runner";
  if (type.startsWith("user.") || type.startsWith("session.status_")) return "server";
  throw new Error(`no writer rule for ${type}`);
}

describe("the Session's log", () => {
  it("opens each run with the person's message and the Session working, and ends it idle at end_turn", () => {
    expect(RUNS.map((run) => run.label)).toEqual(["Run 1", "Run 2"]);
    for (const { label, events } of RUNS) {
      expect(types(events).slice(0, 2), label).toEqual(["user.message", "session.status_running"]);
      expect(events.at(-1), label).toMatchObject({ type: "session.status_idle", stopReason: "end_turn" });
      expect(types(events).filter((type) => type === "user.message"), label).toHaveLength(1);
    }
  });

  it("follows a call that asks with the Session stopping for a person, then the person's answer, then work again", () => {
    const asks = RUNS.flatMap((run) => run.events.map((event, at) => ({ run, event, at }))).filter(
      ({ event }) => event.permission === "ask",
    );
    expect(asks).toHaveLength(1);
    for (const { run, event, at } of asks) {
      expect(event.type).toBe("agent.mcp_tool_use");
      expect(run.events.slice(at + 1, at + 4)).toMatchObject([
        { type: "session.status_idle", stopReason: "requires_action" },
        { type: "user.tool_confirmation", result: "allow" },
        { type: "session.status_running" },
      ]);
      expect(run.events.slice(at + 4).find((later) => later.type === "agent.mcp_tool_result")?.tool).toBe(event.tool);
    }
    for (const run of RUNS) {
      for (const [at, event] of run.events.entries()) {
        if (event.stopReason === "requires_action") expect(run.events[at - 1]?.permission, run.label).toBe("ask");
      }
    }
  });

  it("is the order the conformance suite asserts: nine events for the turn that asks, four for the plain one", () => {
    expect(types(RUNS[0].events)).toEqual([
      "user.message",
      "session.status_running",
      "agent.mcp_tool_use",
      "session.status_idle",
      "user.tool_confirmation",
      "session.status_running",
      "agent.mcp_tool_result",
      "agent.message",
      "session.status_idle",
    ]);
    expect(types(RUNS[1].events)).toEqual(["user.message", "session.status_running", "agent.message", "session.status_idle"]);
  });

  it("names who writes each event as the server's catalog does", () => {
    for (const run of RUNS) {
      for (const event of run.events) expect(event.writer, `${run.label} ${event.type}`).toBe(writerOf(event.type));
    }
  });

  it("folds each event's phase from the statuses at or above it", () => {
    expect(sessionPhases(RUNS)).toEqual([
      ["idle", "working", "working", "waiting", "waiting", "working", "working", "working", "idle"],
      ["idle", "working", "working", "idle"],
    ]);
  });

  it("names the ledger with the first message only, and hands the report back on the agent's message", () => {
    const [first, second] = RUNS;
    expect(marks(first.events[0])).toEqual(["ledger.csv"]);
    expect(first.events.find((event) => event.type === "agent.message")?.file).toBe("variance-report.md");
    for (const event of second.events) expect(event.file, event.type).toBeUndefined();
    expect(second.events[0].says).toContain(FOLLOW_UP);
  });

  it("holds no clock: no time, no duration, no figure in its words", () => {
    for (const run of RUNS) for (const event of run.events) expect(event.says, event.type).not.toMatch(/\d/);
  });
});

describe("its words", () => {
  it("spells each event type and stop reason as the docs do", () => {
    const spelled = `${docs("sdk/streaming.mdx")}\n${docs("concepts/approval-flows.mdx")}`;
    const words = new Set(RUNS.flatMap((run) => run.events.flatMap((event) => [event.type, event.stopReason, event.permission])));
    for (const word of words) if (word) expect(spelled, word).toContain(`\`${word}\``);
    expect(docs("sdk/streaming.mdx")).toMatch(/^\| `session\.status_running` \|/m);
  });

  it("tells the job as the docs do", () => {
    for (const [word, file] of TOLD_IN) expect(docs(file).toLowerCase(), `docs/${file} spells ${word}`).toContain(word.toLowerCase());
  });

  it("says who writes what where the Sessions page does", () => {
    const sessions = docs("concepts/sessions.mdx");
    const sentence = "Stigmer's server writes the messages, the answers and the Session's status; the runner writes what the Agent did.";
    expect(sessions.replace(/\s+/g, " ")).toContain(sentence);
  });
});

describe("SessionLog", () => {
  function figure(): HTMLElement {
    render(<SessionLog />);
    return screen.getByRole("figure");
  }

  it("is one figure of ordered lists, one per run, each named by its run and read in order", () => {
    const picture = figure();

    const lists = within(picture).getAllByRole("list");
    expect(lists).toHaveLength(RUNS.length);
    RUNS.forEach((run, index) => {
      expect(lists[index].tagName).toBe("OL");
      expect(lists[index].getAttribute("aria-labelledby")).toBe(`${ATTRIBUTE}-${run.id}`);
      expect(picture.querySelector(`#${ATTRIBUTE}-${run.id}`)?.textContent).toBe(run.label);
      const rows = within(lists[index]).getAllByRole("listitem");
      expect(rows.map((row) => row.querySelector("code")?.textContent)).toEqual(types(run.events));
    });
    expect(picture.querySelectorAll("h1, h2, h3, h4, h5, h6, a, button, input, [tabindex]")).toHaveLength(0);
  });

  it("puts each row's words, writer and phase in page text, and the phase in the lane's look", () => {
    const picture = figure();
    const phases = sessionPhases(RUNS).flat();
    const rows = [...picture.querySelectorAll("li")];

    rows.forEach((row, index) => {
      const event = RUNS.flatMap((run) => run.events)[index];
      expect(row.closest("[aria-hidden]"), event.type).toBeNull();
      expect(row.getAttribute("data-phase")).toBe(phases[index]);
      expect(row.querySelector("[data-cell=says]")?.textContent).toBe(event.says);
      expect(row.querySelector("[data-cell=writer]")?.textContent).toBe(event.writer);
      expect(row.querySelector("[data-cell=lane]")?.textContent).toBe(`The Session is ${PHASES[phases[index]]}.`);
      for (const mark of marks(event)) expect(row.querySelector("[data-cell=type]")?.textContent, mark).toContain(mark);
    });
    for (const phase of Object.keys(PHASES)) expect(picture.querySelector(`[data-swatch=${phase}]`), phase).not.toBeNull();
  });
});

describe("the stylesheet", () => {
  it("goes wide in one container query, every selector inside the figure, with no <", () => {
    const [compact, wide, ...rest] = SESSION_LOG_CSS.split("@container");
    expect(rest).toHaveLength(0);
    expect(wide.startsWith(` (min-width:${WIDE_FROM}px){`)).toBe(true);
    expect(compact).toContain(`[data-${ATTRIBUTE}-head]{display:none}`);
    expect(wide).toContain('grid-template-areas:"type says writer lane"');
    expect(SESSION_LOG_CSS).not.toContain("<");

    const selectors = SESSION_LOG_CSS.replace(/@container[^{]*\{/, "")
      .split("}")
      .map((rule) => rule.split("{")[0].trim())
      .filter(Boolean)
      .flatMap((selector) => selector.split(","));
    for (const selector of selectors) expect(selector, selector).toMatch(new RegExp(`^\\[data-${ATTRIBUTE}\\] `));
  });

  it("leaves the words at least 280px when it goes wide", () => {
    const wide = /grid-template-columns:(\d+)px minmax\(0,1fr\) (\d+)px (\d+)px;column-gap:(\d+)px/.exec(SESSION_LOG_CSS)!;
    const [type, writer, lane, gap] = wide.slice(1).map(Number);
    expect(WIDE_FROM - (type + writer + lane + 3 * gap)).toBeGreaterThanOrEqual(280);
  });
});
