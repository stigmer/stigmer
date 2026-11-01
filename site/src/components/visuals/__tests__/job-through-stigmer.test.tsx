/**
 * The picture under "How it fits", one job through Stigmer with Stigmer
 * opened up: its words, its figure, its maps, lines and frame, its loop, and
 * the list under it.
 *
 * Each word the picture uses is held to a file that spells it: the docs page
 * it comes from, or, for a technology named in a box, the server source that
 * proves it holds in every edition. The maps, lines and frame are held to the
 * rules every drawn picture keeps (`@/__test-utils__/drawing-checks`), and
 * the loop to the rules every looping picture keeps
 * (`@/__test-utils__/loop-checks`). The list's links are titles the homepage
 * already uses, each to an in-page id; the homepage's own test proves each id
 * is on the page.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expectDrawingStylesheet,
  expectFrame,
  expectLine,
  expectWellFormedMap,
  expectWideFits,
  type LineSpec,
} from "@/__test-utils__/drawing-checks";
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
import { AGENT_GETS } from "@/lib/agent-gets";
import { HowItFits } from "@/components/sections/HowItFits";
import { LAYOUTS, type Layout } from "../drawing/grid";
import { JobThroughStigmer } from "../JobThroughStigmer";
import {
  AREAS,
  AREA_NAMES,
  ATTRIBUTE,
  BOXES,
  CAPTION,
  CHAT,
  CONNECTORS,
  DRAWING_CSS,
  FRAME,
  JOB,
  LOOP,
  LOOP_CSS,
  PLACES,
  PROVEN_AT,
  WIDE_FROM,
  type PlaceId,
} from "../job-through-stigmer";

afterEach(cleanup);

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

/** Each word the picture draws, and the file that spells it. */
const SPELLED_IN: [string, string][] = [
  ["your app", "docs/concepts/what-is-stigmer.mdx"],
  ["your backend", "docs/getting-started/embed-agent.mdx"],
  ["your database", "docs/concepts/what-is-stigmer.mdx"],
  ["your model provider", "docs/concepts/what-is-stigmer.mdx"],
  [CHAT, "docs/getting-started/embed-agent.mdx"],
  ["access", "docs/concepts/sharing-and-access.mdx"],
  ["sandbox", "docs/concepts/environments.mdx"],
  ["conversation", "docs/vocabulary.md"],
  ["job", "docs/vocabulary.md"],
  ["gRPC", "backend/services/stigmer-server/src/transport/demux.ts"],
  ["Connect", "backend/services/stigmer-server/src/transport/demux.ts"],
  ["REST", "backend/services/stigmer-server/src/transport/demux.ts"],
  ["OpenFGA", "backend/services/stigmer-server/src/authorization/README.md"],
  ["Temporal", "docs/concepts/runners.mdx"],
];

/** Each line: the box it leaves, the boxes it points at, and its pieces, in each layout. */
const SHARED_LINES: LineSpec[] = [
  { from: "app", to: ["backend"], through: ["l-app"], dashed: false },
  { from: "api", to: ["access"], through: ["l-api"], dashed: false },
  { from: "access", to: ["job"], through: ["l-access"], dashed: false },
  { from: "job", to: ["sandbox"], through: ["l-job"], dashed: false },
  { from: "sandbox", to: ["provider"], through: ["l-provider"], dashed: false },
  { from: "app", to: ["api"], through: ["chat-from", "chat-turn", "chat-run", "chat-into", "chat-in"], dashed: true },
];
const LINES: Record<Layout, LineSpec[]> = {
  wide: [
    ...SHARED_LINES,
    { from: "backend", to: ["api"], through: ["l-backend"], dashed: false },
    { from: "backend", to: ["database"], through: ["l-database"], dashed: false },
  ],
  compact: [
    ...SHARED_LINES,
    { from: "backend", to: ["api", "database"], through: ["l-backend", "l-database"], dashed: false },
  ],
};

function figure(): HTMLElement {
  render(<JobThroughStigmer />);
  return screen.getByRole("figure");
}

function drawing(): HTMLElement {
  return figure().querySelector<HTMLElement>(`[data-${ATTRIBUTE}-drawing]`)!;
}

describe("JobThroughStigmer", () => {
  it("names each place once, in the order the job goes through them", () => {
    const picture = drawing();

    for (const { name } of Object.values(PLACES)) expect(picture.textContent?.split(name).length, name).toBe(2);
    expect([...picture.querySelectorAll("[data-box]")].map((box) => box.getAttribute("data-area"))).toEqual(
      Object.keys(PLACES),
    );
    expect(picture.textContent).toContain(`${JOB.tool}: approve?`);
    for (const word of [JOB.customer, JOB.ledger, JOB.report]) expect(picture.textContent, word).toContain(word);
  });

  it("spells each word as the file that proves it does", () => {
    const drawn = `${drawing().textContent} ${CAPTION}`.toLowerCase();
    for (const [word, file] of SPELLED_IN) {
      expect(drawn, `the picture says ${word}`).toContain(word.toLowerCase());
      expect(readFileSync(resolve(REPO, file), "utf8").toLowerCase(), `${file} spells ${word}`).toContain(word.toLowerCase());
    }
  });

  it("is one figure with a caption telling every step in order, its drawing hidden, and one button", () => {
    const picture = figure();

    expect(picture.querySelector(`[data-${ATTRIBUTE}-drawing]`)?.getAttribute("aria-hidden")).toBe("true");
    expect(picture.querySelector("figcaption")?.textContent).toBe(CAPTION);
    expect(CAPTION).toMatch(
      /Northwind Books.*hands over.*Your backend.*API.*your database.*Access checks.*The job starts.*Temporal.*sandbox.*your model provider.*asks Northwind Books.*post_adjustment.*the chat.*variance-report\.md comes back/,
    );
    expect(picture.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0);
    expect(picture.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(1);
    expect(picture.querySelector(`[data-${ATTRIBUTE}-drawing]`)?.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
  });

  it("pauses and plays again, its name the same either way", () => {
    const picture = figure();
    const button = screen.getByRole("button", { name: "Pause animation" });

    expect(picture.getAttribute("data-paused")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(picture.getAttribute("data-paused")).toBe("true");
    fireEvent.click(button);
    expect(picture.getAttribute("data-paused")).toBe("false");
  });

  it("draws every area the maps name, each layout's segments, and the frame round Stigmer", () => {
    const picture = drawing();

    const drawn = [...picture.querySelectorAll("[data-area]")].map((area) => area.getAttribute("data-area"));
    expect(drawn.sort()).toEqual([...AREA_NAMES].sort());
    for (const layout of LAYOUTS) {
      const segments = Object.values(CONNECTORS).flatMap((connector) => connector.segments[layout]);
      expect(picture.querySelectorAll(`[data-layout=${layout}]`), layout).toHaveLength(segments.length);
    }
    expect(picture.querySelector(`[data-frame=${FRAME.id}]`)?.textContent).toBe(FRAME.label);
  });

  it("sits between the heading and the steps under How it fits, its list after it", () => {
    render(<HowItFits />);

    const heading = screen.getByRole("heading", { level: 2 });
    const picture = screen.getByRole("figure");
    const list = screen.getByRole("list");
    const firstStep = screen.getAllByRole("heading", { level: 3 })[0];
    expect(heading.compareDocumentPosition(picture) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(picture.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(list.compareDocumentPosition(firstStep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the list under the picture", () => {
  it("sends each opened-up part to its proof higher up the page, by the title the page gives it", () => {
    render(<JobThroughStigmer />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(PROVEN_AT.length);
    PROVEN_AT.forEach((item, index) => {
      const link = items[index].querySelector("a")!;
      expect(link.textContent).toBe(AGENT_GETS[item.proof].title);
      expect(link.getAttribute("href")).toBe(item.href);
      expect(item.href).toMatch(/^#[\w-]+$/);
      expect(items[index].textContent).toContain(item.part === "sandbox" ? "sandbox" : PLACES[item.part as PlaceId].name);
    });
  });
});

describe.each(LAYOUTS)("the %s map", (layout) => {
  const grid = AREAS[layout];
  const connectorIds = Object.keys(CONNECTORS);

  it("has a cell per track in every row, makes each name one rectangle, and names every area drawn", () => {
    expectWellFormedMap(grid, AREA_NAMES);
  });

  it("holds Stigmer's parts in its frame, and nothing but crossing lines in the frame's gutters", () => {
    expectFrame(grid, FRAME.holds, BOXES, connectorIds);
  });

  it.each(LINES[layout])("runs a line from $from to $to, joined at every turn", (spec) => {
    expectLine(grid, layout, CONNECTORS, BOXES, spec);
  });
});

describe("the stylesheet", () => {
  it("goes wide in one container query, at a width the wide map fits in", () => {
    expectWideFits(AREAS.wide, WIDE_FROM);
    expectDrawingStylesheet(DRAWING_CSS, ATTRIBUTE, AREAS, WIDE_FROM);
  });
});

describe("the job's loop through Stigmer", () => {
  it("runs every layer on the one cycle, with no delay, held at both ends", () => {
    expectOneCycle(LOOP, LOOP_CSS);
  });

  it("starts and ends on the finished picture: the sandbox and the report lit", () => {
    expectFinishedAtBothEnds(LOOP, LOOP_CSS);
    const lit = Object.entries(LOOP.parts)
      .filter(([, part]) => part.litAtHold)
      .map(([id]) => id);
    expect(lit.sort()).toEqual(["app-report", "sandbox"]);
  });

  it("holds the finished picture for at least 30% of the cycle", () => {
    expectLongHold(LOOP, LOOP_CSS);
  });

  it("clears to the stage, then shows and hands on each part at its own steps", () => {
    expectShownAtTheirSteps(LOOP, LOOP_CSS);
  });

  it("lights each part at its own steps only", () => {
    expectLitAtTheirSteps(LOOP, LOOP_CSS);
  });

  it("animates opacity only", () => {
    expectOpacityOnly(LOOP, LOOP_CSS);
  });

  it("has a rule for every layer the picture draws, and none for a layer it does not", () => {
    expectRuleForEveryLayer(LOOP, LOOP_CSS, drawing());
  });

  it("pauses every layer, and hides the pause button when motion is reduced", () => {
    expectPauseRules(LOOP, LOOP_CSS);
  });

  it("holds nothing an escaping step could change", () => {
    expectNothingEscapable(LOOP_CSS);
  });
});
