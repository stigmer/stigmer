// Accessibility audit — the session view's new parts, in light and dark
// against the shipped stylesheet: the summary's status pill while a turn
// works and while a person is awaited (with how far the turn has got), the
// block that closes a turn, the finished conversation's summary, a finished
// turn's working folded under one "How it got there" line (closed and
// opened), and the run settings a builder and an end user open from the
// composer. The whole view, with its thread and composer, is
// audited on the gallery's session scenes (test/visual); these are the
// states a picture there does not reach.

import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Stigmer } from "@stigmer/client";
import { COLOR_MODES, auditA11y, renderAudited, resetAudit } from "../../__tests__/helpers/a11y-audit.js";
import { SCENARIO_CLOCK, conversationOf, scenarios } from "../../test/index.js";
import { MessageThread } from "../../run/MessageThread.js";
import { RunConfigSection } from "../facets/SetupTab.js";
import { SessionSummary } from "../SessionSummary.js";
import { TurnOutcome } from "../TurnOutcome.js";
import { turnOutcome } from "../turn-outcome.js";

const ROUTINE = create(RoutineSchema, { metadata: { id: "rtn_1", name: "Nightly billing check", slug: "nightly", org: "demo" } });
const CLIENT = { routine: { get: async () => ROUTINE } } as unknown as Stigmer;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(SCENARIO_CLOCK));
});

afterEach(() => {
  resetAudit();
  vi.useRealTimers();
});

const finished = scenarios.finished;

describe("Session view a11y", () => {
  it.each(COLOR_MODES)("the summary's status pill, at work and awaiting a person (%s)", async (mode) => {
    const busy = scenarios.busy;
    const approval = scenarios.approval;
    const container = renderAudited(
      <div className="stg:space-y-2 stg:p-4">
        <SessionSummary session={busy.session!} turns={busy.fold.turns} runs={busy.runs} files={busy.files} showCost />
        <SessionSummary session={approval.session!} turns={approval.fold.turns} runs={approval.runs} files={approval.files} showCost />
      </div>,
      mode,
      { width: 720, height: 240, client: CLIENT },
    );
    await screen.findByText(/^Working · /);
    await screen.findByText(/^Waiting for you · /);
    await screen.findByText("2 of 5 to-dos done");
    await auditA11y(container, `status pill · ${mode}`);
  });

  it.each(COLOR_MODES)("a turn's outcome and the finished conversation's summary (%s)", async (mode) => {
    const container = renderAudited(
      <div className="stg:space-y-4 stg:p-4">
        <SessionSummary
          session={finished.session!}
          turns={finished.fold.turns}
          runs={finished.runs}
          files={finished.files}
          showCost
          routineHref={(routine) => `/library/routines/demo/${routine.metadata?.slug}`}
        />
        <TurnOutcome
          outcome={turnOutcome(finished.fold.turns[0]!, finished.files, finished.runs[0])}
          onOpenFile={() => {}}
          onOpenChange={() => {}}
        />
      </div>,
      mode,
      { width: 720, height: 360, client: CLIENT },
    );
    await screen.findByRole("link", { name: "Nightly billing check" });
    await auditA11y(container, `outcome and summary · ${mode}`);
  });

  it.each(COLOR_MODES)("a finished turn's working folded under one line, closed and opened (%s)", async (mode) => {
    const conversation = conversationOf(finished);
    const container = renderAudited(
      <MessageThread turns={conversation.turns} runs={conversation.runs} contentColumn="center" />,
      mode,
      { width: 900, height: 720 },
    );
    const row = await screen.findByRole("button", { name: /^How it got there: read 1 file, edited invoice\.ts, wrote 2 files/ });
    await auditA11y(container, `how it got there closed · ${mode}`);
    fireEvent.click(row);
    await auditA11y(container, `how it got there opened · ${mode}`);
  });

  it.each(COLOR_MODES)("the run settings a builder and an end user open (%s)", async (mode) => {
    const container = renderAudited(
      <div className="stg:grid stg:grid-cols-2 stg:gap-6 stg:p-4">
        <RunConfigSection
          harness="stigmer"
          executionTarget="cloud"
          modelId="claude-sonnet-4.6"
          environment={undefined}
          autoApprove={{ armed: false, onChange: () => {} }}
        />
        <RunConfigSection
          harness="stigmer"
          executionTarget="cloud"
          modelId="claude-sonnet-4.6"
          environment={undefined}
          autoApprove={{ armed: true, onChange: () => {} }}
          curated
        />
      </div>,
      mode,
      { width: 720, height: 320 },
    );
    await auditA11y(container, `run settings · ${mode}`);
  });
});
