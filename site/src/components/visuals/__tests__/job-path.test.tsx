/**
 * The docs front page's picture of the job: its words, its figure and its loop.
 *
 * The picture's words are the docs' own: each name the job uses must still
 * be spelled the same on the page that runs or explains it, and its labels
 * are the "What each customer's agent gets" titles, each at its part. The
 * figure is one image with a caption and a pause button, and pausing only
 * flips its state. The loop is checked from the stylesheet `jobPathCss`
 * builds out of `PARTS` and `TIMELINE`, by the rules every looping picture
 * keeps (`@/__test-utils__/loop-checks`): it starts and ends on the finished
 * picture, clears to the stage, shows each part at its own step, animates
 * opacity only, and has a rule for every layer the render draws and nothing
 * else.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_GET_IDS, AGENT_GETS, type AgentGetId } from "@/lib/agent-gets";
import { JobPath } from "../JobPath";
import {
  expectFinishedAtBothEnds,
  expectLitAtTheirSteps,
  expectLongHold,
  expectNothingEscapable,
  expectOneCycle,
  expectOpacityOnly,
  expectPauseRules,
  expectRuleForEveryLayer,
  expectShownAtTheirSteps,
} from "@/__test-utils__/loop-checks";
import { JOB, JOB_PATH_LOOP, jobPathCss, type PartId } from "../job-path";

afterEach(cleanup);

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../docs");

/** The page that spells each of the job's names, as the docs publish it. */
const SPELLED_IN: Record<keyof typeof JOB, string> = {
  customer: "getting-started/one-organization-per-customer.mdx",
  agent: "getting-started/quickstart.mdx",
  ledger: "getting-started/quickstart.mdx",
  message: "getting-started/quickstart.mdx",
  tool: "concepts/approval-flows.mdx",
  report: "getting-started/quickstart.mdx",
};

/** The part each promise labels; the rest label the picture's static pieces. */
const LABELS: Record<AgentGetId, PartId | null> = {
  "own-computer": null,
  hours: "computer-work",
  "asks-first": "computer-ask",
  walls: null,
  keys: null,
};

const CSS = jobPathCss();

function drawing(): HTMLElement {
  const { container } = render(<JobPath />);
  return container.querySelector<HTMLElement>("[data-job-path-drawing]")!;
}

describe("JobPath", () => {
  it("labels its parts with what each customer's agent gets, each title once", () => {
    const picture = drawing();

    for (const id of AGENT_GET_IDS) {
      const { title } = AGENT_GETS[id];
      expect(picture.textContent?.split(title).length, title).toBe(2);
      const label = picture.querySelector(`[data-promise="${id}"]`);
      expect(label?.textContent, id).toBe(title);
      const part = LABELS[id];
      if (part) expect(label?.closest(`[data-part="${part}"]`), `${title} at ${part}`).not.toBeNull();
    }
  });

  it("names the job as the docs spell it", () => {
    const picture = drawing();
    const caption = document.querySelector("figcaption")?.textContent ?? "";

    for (const [key, word] of Object.entries(JOB) as [keyof typeof JOB, string][]) {
      const page = readFileSync(resolve(DOCS, SPELLED_IN[key]), "utf8");
      expect(page.includes(word), `docs/${SPELLED_IN[key]} spells ${word}`).toBe(true);
      expect(picture.textContent, word).toContain(word);
    }
    for (const word of [JOB.customer, JOB.ledger, JOB.report]) expect(caption).toContain(word);
  });

  it("is one figure with a caption, no heading and one button", () => {
    render(<JobPath />);

    const figure = screen.getByRole("figure");
    expect(figure.querySelector("figcaption")?.textContent).toMatch(/hours.*asks before.*behind a wall/);
    expect(figure.querySelector("[data-job-path-drawing]")?.getAttribute("aria-hidden")).toBe("true");
    expect(figure.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0);
    expect(figure.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(1);
  });

  it("pauses and plays again, its name the same either way", () => {
    render(<JobPath />);
    const figure = screen.getByRole("figure");
    const button = screen.getByRole("button", { name: "Pause animation" });

    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(figure.getAttribute("data-paused")).toBe("false");

    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Pause animation" })).toBe(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(figure.getAttribute("data-paused")).toBe("true");

    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(figure.getAttribute("data-paused")).toBe("false");
  });
});

describe("the job's loop", () => {
  it("runs every layer on the one cycle, with no delay, held at both ends", () => {
    expectOneCycle(JOB_PATH_LOOP, CSS);
  });

  it("starts and ends on the finished picture", () => {
    expectFinishedAtBothEnds(JOB_PATH_LOOP, CSS);
  });

  it("holds the finished picture for at least 30% of the cycle", () => {
    expectLongHold(JOB_PATH_LOOP, CSS);
  });

  it("clears to the stage, then shows each part at its own step, in the story's order", () => {
    expectShownAtTheirSteps(JOB_PATH_LOOP, CSS);
  });

  it("lights each part at its own steps only", () => {
    expectLitAtTheirSteps(JOB_PATH_LOOP, CSS);
  });

  it("animates opacity only", () => {
    expectOpacityOnly(JOB_PATH_LOOP, CSS);
  });

  it("has a rule for every layer the picture draws, and none for a layer it does not", () => {
    expectRuleForEveryLayer(JOB_PATH_LOOP, CSS, drawing());
  });

  it("pauses every layer, and hides the pause button when motion is reduced", () => {
    expectPauseRules(JOB_PATH_LOOP, CSS);
  });

  it("holds nothing an escaping step could change", () => {
    expectNothingEscapable(CSS);
  });
});
