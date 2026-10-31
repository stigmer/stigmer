// Goldens of the `list` tables as a person sees them on an 80- and a
// 120-column terminal, and piped (CLI-09). On a terminal the free-text
// columns (an agent's description, a session's subject) give up width and
// end in "…" so a row stays on one line; ids and `org/slug` names keep every
// character, since a person copies them into the next command. Piped,
// nothing is cut, so a script reads every cell whole. Free text is folded
// onto one line either way. The terminal is a stream given to the render
// layer, so no test depends on the terminal it runs in; colour is off and
// nothing reads the clock (the samples are stamped from one frozen instant).
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionListSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { sampleDate, samples } from "@stigmer/react-sdk/test";
import stringWidth from "string-width";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectGolden } from "../../__test-utils__/golden.js";
import { libraryTable, SESSION_TABLE } from "../../resources/list.js";
import { renderCollection, renderListMessage } from "../../resources/render.js";
import type { TerminalStream } from "../table.js";

let noColor: string | undefined;
beforeAll(() => {
  noColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});
afterAll(() => {
  if (noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = noColor;
});

const ORG_LABELS = new Map([["demo", "demo"]]);

/** An agent as a library lists it: shared with its organization, created on the sample day. */
function listed(agent: Agent): Agent {
  if (agent.metadata !== undefined)
    agent.metadata.visibility = ApiResourceVisibility.visibility_org;
  agent.status = create(AgentStatusSchema, {
    audit: { specAudit: { createdAt: timestampFromDate(sampleDate()) } },
  });
  return agent;
}

const agents = [
  listed(samples.agent()),
  listed(
    samples.agent({
      id: "agt_00000000000000000000000002",
      name: "Release Notes",
      slug: "release-notes",
      description:
        "Drafts release notes from the merged pull requests of a milestone,\ngrouped   by area.",
    }),
  ),
  listed(
    samples.agent({
      id: "agt_00000000000000000000000003",
      name: "Translator",
      slug: "translator",
      description:
        "日本語のサポート窓口に届いた問い合わせを英語に翻訳して担当者に渡します",
    }),
  ),
  listed(
    samples.agent({
      id: "agt_00000000000000000000000004",
      name: "Triage",
      slug: "triage",
      description: "Labels issues.",
    }),
  ),
];

const sessions = [
  samples.session(),
  samples.session({
    id: "ses_00000000000000000000000002",
    subject:
      "Why does the invoice total round down when a discount and a tax apply to the same line?",
    agentRef: null,
  }),
  samples.session({
    id: "ses_00000000000000000000000003",
    subject: "Ship the 🚀 launch checklist",
  }),
];

/** The widest line of a rendered table, in terminal columns. */
function widest(table: string): number {
  return Math.max(...table.split("\n").map((line) => stringWidth(line)));
}

const TERMINALS: ReadonlyArray<
  readonly [string, TerminalStream, number | undefined]
> = [
  ["80", { isTTY: true, columns: 80 }, 80],
  ["120", { isTTY: true, columns: 120 }, 120],
  ["piped", { isTTY: false, columns: 80 }, undefined],
];

describe("CLI-09 a list fits the terminal it is drawn on, and piped it is whole", () => {
  it.each(TERMINALS)(
    "lists agents and sessions at %s",
    async (name, stream, width) => {
      const agentTable = renderCollection(
        AgentSchema,
        agents,
        "table",
        libraryTable("agents"),
        ORG_LABELS,
        stream,
      );
      const sessionTable = renderCollection(
        SessionSchema,
        sessions,
        "table",
        SESSION_TABLE,
        ORG_LABELS,
        stream,
      );
      await expectGolden(agentTable, `list-agents-${name}`);
      await expectGolden(sessionTable, `list-sessions-${name}`);

      if (width !== undefined)
        expect(widest(agentTable)).toBeLessThanOrEqual(width);
      // What a person copies is never cut, at any width.
      for (const copied of [
        "demo/release-notes",
        "demo/translator",
        "ses_00000000000000000000000002",
      ]) {
        expect(`${agentTable}${sessionTable}`).toContain(copied);
      }
    },
  );

  it("stops a subject at the floor even when the row still overflows, rather than cut what a person copies", () => {
    const sessionTable = renderCollection(
      SessionSchema,
      sessions,
      "table",
      SESSION_TABLE,
      ORG_LABELS,
      { isTTY: true, columns: 80 },
    );
    // SESSION ID, STATE, AGENT and CREATED take 69 columns with the four gaps; SUBJECT at its floor of 12 makes 81.
    expect(widest(sessionTable)).toBe(81);
    expect(sessionTable).toContain("   Why does th…   ");
  });

  it("fits a list message (a page with its envelope) to the terminal the same way", () => {
    const page = create(SessionListSchema, { entries: sessions });
    for (const [, stream] of TERMINALS) {
      expect(
        renderListMessage(
          SessionListSchema,
          page,
          "table",
          SESSION_TABLE,
          stream,
        ),
      ).toBe(
        renderCollection(
          SessionSchema,
          sessions,
          "table",
          SESSION_TABLE,
          ORG_LABELS,
          stream,
        ),
      );
    }
  });

  it("keeps every word of the free text piped, folded onto one line", () => {
    const piped = { isTTY: false } as const;
    const agentTable = renderCollection(
      AgentSchema,
      agents,
      "table",
      libraryTable("agents"),
      ORG_LABELS,
      piped,
    );
    const sessionTable = renderCollection(
      SessionSchema,
      sessions,
      "table",
      SESSION_TABLE,
      ORG_LABELS,
      piped,
    );
    expect(agentTable).toContain(
      "Drafts release notes from the merged pull requests of a milestone, grouped by area.",
    );
    expect(sessionTable).toContain(
      "Why does the invoice total round down when a discount and a tax apply to the same line?",
    );
    expect(`${agentTable}${sessionTable}`).not.toContain("…");
  });
});
