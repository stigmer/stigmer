/**
 * Pins the artifact mapping against Go's artifact_test.go: the id
 * contract, the drift-fingerprint note, the two-lever paused derivation,
 * and the baked policy (SKIP overlap, PauseOnFailure false, one action
 * arg) — every value here is cross-repo wire contract.
 */
import { create } from "@bufbuild/protobuf";
import { ScheduleOverlapPolicy } from "@temporalio/client";
import { describe, expect, it } from "vitest";

import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";

import { ScheduleArtifact, desiredPaused, note } from "../artifact.js";
import { ScheduleTemporalConfig } from "../config.js";
import { artifactId, resourceIdOf } from "../names.js";

const config = new ScheduleTemporalConfig(
  "schedule_stigmer",
  60,
  24,
  5,
  60,
  true,
  5,
  20,
  1.0,
  90,
);

function schedule(overrides?: {
  enabled?: boolean;
  pausedReason?: string;
  cron?: string;
  timeZone?: string;
}) {
  return create(ScheduleSchema, {
    metadata: { id: "sch_01test", org: "acme", slug: "daily" },
    spec: {
      cron: overrides?.cron ?? "0 9 * * *",
      timeZone: overrides?.timeZone ?? "Asia/Kolkata",
      enabled: overrides?.enabled ?? true,
      target: { case: "agent", value: { agentRef: { slug: "helper" } } },
    },
    status: { pausedReason: overrides?.pausedReason ?? "" },
  });
}

describe("artifact identity", () => {
  it("prefixes the resource id with schedule/tick/", () => {
    expect(artifactId("sch_01test")).toBe("schedule/tick/sch_01test");
  });

  it("resourceIdOf inverts artifactId", () => {
    expect(resourceIdOf("schedule/tick/sch_01test")).toBe("sch_01test");
  });
});

describe("note — the drift fingerprint", () => {
  it("renders cron=<cron> tz=<tz> byte-for-byte", () => {
    expect(note(schedule())).toBe("cron=0 9 * * * tz=Asia/Kolkata");
  });
});

describe("desiredPaused — two levers, one artifact state", () => {
  it("false when enabled and unlatched", () => {
    expect(desiredPaused(schedule())).toBe(false);
  });
  it("true when owner-disabled", () => {
    expect(desiredPaused(schedule({ enabled: false }))).toBe(true);
  });
  it("true when platform-paused", () => {
    expect(desiredPaused(schedule({ pausedReason: "Paused after 5..." }))).toBe(true);
  });
});

describe("createOptions — the baked policy", () => {
  const artifact = new ScheduleArtifact(config);
  const options = artifact.createOptions(schedule());

  it("pins the artifact id and cron spec", () => {
    expect(options.scheduleId).toBe("schedule/tick/sch_01test");
    expect(options.spec.cronExpressions).toEqual(["0 9 * * *"]);
    expect(options.spec.timezone).toBe("Asia/Kolkata");
  });

  it("pins overlap SKIP, catchup window, and PauseOnFailure=false", () => {
    expect(options.policies?.overlap).toBe(ScheduleOverlapPolicy.SKIP);
    expect(options.policies?.catchupWindow).toBe(60 * 60_000);
    expect(options.policies?.pauseOnFailure).toBe(false);
  });

  it("bakes the action: workflow id = artifact id, type schedule/tick, ONE arg, own queue, 24h backstop", () => {
    expect(options.action.type).toBe("startWorkflow");
    expect(options.action.workflowId).toBe("schedule/tick/sch_01test");
    expect(options.action.workflowType).toBe("schedule/tick");
    expect(options.action.args).toEqual(["sch_01test"]);
    expect(options.action.taskQueue).toBe("schedule_stigmer");
    expect(options.action.workflowRunTimeout).toBe(24 * 3_600_000);
    // No retry policy: a failed tick is a missed fire, not a hot loop.
    expect(options.action.retry).toBeUndefined();
  });

  it("derives the initial paused state and the note", () => {
    expect(options.state?.paused).toBe(false);
    expect(options.state?.note).toBe("cron=0 9 * * * tz=Asia/Kolkata");
    expect(artifact.createOptions(schedule({ enabled: false })).state?.paused).toBe(true);
  });
});

describe("applyDesiredState — the update half of ensure", () => {
  const artifact = new ScheduleArtifact(config);

  it("rewrites spec, action, policy, and state to the complete desired state", () => {
    const previous = {
      state: { paused: true, note: "cron=old tz=old", remainingActions: 0 },
      info: {},
    } as never;
    const update = artifact.applyDesiredState(
      previous,
      schedule({ cron: "30 8 * * *", timeZone: "UTC" }),
    );
    expect(update.spec?.cronExpressions).toEqual(["30 8 * * *"]);
    expect(update.spec?.timezone).toBe("UTC");
    expect(update.action.workflowType).toBe("schedule/tick");
    expect(update.policies?.overlap).toBe(ScheduleOverlapPolicy.SKIP);
    // The SDK's ScheduleUpdateOptions types `state` through an Omit over an
    // optional union; narrow for the assertions.
    const state = update.state as { paused: boolean; note: string };
    expect(state.paused).toBe(false);
    expect(state.note).toBe("cron=30 8 * * * tz=UTC");
  });

  it("preserves unrelated previous state fields (Go mutates desc.Schedule.State in place)", () => {
    const previous = {
      state: { paused: false, note: "x", remainingActions: 7 },
      info: {},
    } as never;
    const update = artifact.applyDesiredState(previous, schedule());
    expect((update.state as { remainingActions?: number }).remainingActions).toBe(7);
  });
});
