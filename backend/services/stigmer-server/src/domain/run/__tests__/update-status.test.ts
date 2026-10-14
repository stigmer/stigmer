/**
 * Pins the updateStatus merge (../update-status.ts) directly on a clone,
 * mirroring the freshly-loaded run the merge mutates in place inside the
 * write lock:
 *
 *   - the phase latch: a terminal phase is final against a straggler, and
 *     a PAUSED run moves only on the platform's own write (stigmer#1370);
 *     completed_at and the stop cause clear once the turn works again;
 *   - the run's file record (file_changes) is merged by change set id: a
 *     set the write carries replaces the one with its id where it stands,
 *     a new one is added after the others, and no stored set is removed,
 *     so a write that carries only a new set keeps the first;
 *   - the policy keeps run only in a write handed the run's review log (a
 *     write that carries a captured set), return their decided events, and
 *     never decide one target twice in one write; the live progress clears
 *     once its set is captured;
 *   - the agent a turn ran (status.agent_id, agent_version_hash) is the
 *     create pipeline's stamp alone; the files a plugin-eval try's graders
 *     read (eval_files) are kept on a try's run only; and what a run
 *     loaded (loaded_versions) is merged by union over (id, version), never
 *     replaced, an entry with no id refused by the shared validator before
 *     any merge.
 */
import { clone, create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { TurnCommandProvenanceSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { RunUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { toolUseEventId } from "../../session/events/ids.js";
import { EMPTY_RUN_REVIEW_LOG } from "../filereview/logged.js";
import type { RunReviewLog } from "../filereview/logged.js";
import { applyUpdateStatusMerge } from "../update-status.js";
import { validator } from "../../../pipeline/steps/validation.js";
import type { StatusWriter } from "../update-status.js";
import { capturedSet } from "./file-review-seed.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/**
 * Applies the merge to a clone of the existing run and returns the merged
 * result; `reviewLog` stands for a write that carries a captured set.
 */
function runBuildStep(
  existing: Run,
  incoming: MessageInitShape<typeof RunStatusSchema>,
  writer: StatusWriter = "wire",
  options: { readonly outdatedTurn?: boolean; readonly reviewLog?: RunReviewLog } = {},
): Run {
  return merge(existing, incoming, writer, options).run;
}

function merge(
  existing: Run,
  incoming: MessageInitShape<typeof RunStatusSchema>,
  writer: StatusWriter = "wire",
  options: { readonly outdatedTurn?: boolean; readonly reviewLog?: RunReviewLog } = {},
): { run: Run; decided: SessionEvent[] } {
  const input = create(RunUpdateStatusInputSchema, {
    runId: existing.metadata?.id ?? "",
    status: incoming,
  });
  const merged = clone(RunSchema, existing);
  const decided = applyUpdateStatusMerge(
    merged,
    input,
    silentLogger,
    writer,
    options.outdatedTurn ?? false,
    options.reviewLog,
  );
  return { run: merged, decided };
}

function existingWith(phase: RunPhase): Run {
  return create(RunSchema, {
    metadata: { id: "exec-guard", name: "exec-guard" },
    spec: {},
    status: { phase },
  });
}

describe("the phase latch", () => {
  it("latches a terminal phase against a straggler IN_PROGRESS persist", () => {
    const existing = create(RunSchema, {
      metadata: { id: "exec-latch", name: "exec-latch" },
      spec: {},
      status: {
        phase: RunPhase.RUN_TERMINATED,
        completedAt: "2026-08-24T10:00:00Z",
      },
    });
    const merged = runBuildStep(existing, { phase: RunPhase.RUN_IN_PROGRESS });

    expect(
      merged.status?.phase,
      "the terminal phase is final (Recover is the sanctioned un-terminalizer)",
    ).toBe(RunPhase.RUN_TERMINATED);
    expect(merged.status?.completedAt).toBe("2026-08-24T10:00:00Z");
  });

  it("leaves the run as it is for a direct call with no status, and decides nothing", () => {
    const existing = existingWith(RunPhase.RUN_IN_PROGRESS);
    const merged = clone(RunSchema, existing);
    const decided = applyUpdateStatusMerge(
      merged,
      create(RunUpdateStatusInputSchema, { runId: "exec-guard" }),
      silentLogger,
      "wire",
      true,
      EMPTY_RUN_REVIEW_LOG,
    );
    expect(decided).toEqual([]);
    expect(merged.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
  });

  it("builds a status for a run that has none from the runner's first write", () => {
    const merged = runBuildStep(create(RunSchema, { metadata: { id: "exec-new" } }), { phase: RunPhase.RUN_IN_PROGRESS });
    expect(merged.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
  });

  it("clears completed_at when the merged phase is non-terminal (resume defense-in-depth)", () => {
    const existing = create(RunSchema, {
      metadata: { id: "exec-resume", name: "exec-resume" },
      spec: {},
      status: {
        phase: RunPhase.RUN_WAITING_FOR_APPROVAL,
        completedAt: "2026-08-24T10:00:00Z"
      },
    });
    const merged = runBuildStep(existing, {
      phase: RunPhase.RUN_IN_PROGRESS
    });
    expect(merged.status?.completedAt).toBe("");
  });

  it("keeps the stop cause a terminal write sends, and drops it once the turn works again", () => {
    const existing = create(RunSchema, {
      metadata: { id: "exec-stop", name: "exec-stop" },
      spec: {},
      status: { phase: RunPhase.RUN_IN_PROGRESS },
    });
    const stopped = runBuildStep(existing, {
      phase: RunPhase.RUN_PAUSED,
      stopCause: "user"
    });
    expect(stopped.status?.stopCause).toBe("user");
    const unchanged = runBuildStep(stopped, { phase: RunPhase.RUN_PAUSED });
    expect(unchanged.status?.stopCause, "an empty cause never clears a stated one").toBe("user");
    const resumed = runBuildStep(stopped, { phase: RunPhase.RUN_IN_PROGRESS }, "platform");
    expect(resumed.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
    expect(resumed.status?.stopCause, "the resumed turn has not stopped").toBe("");
  });
});

describe("the run's file record (file_changes)", () => {
  const ids = (run: Run) => run.status?.fileChanges.map((cs) => cs.id);

  it("keeps the first set when a second write carries only a new one", () => {
    const first = runBuildStep(existingWith(RunPhase.RUN_IN_PROGRESS), { fileChanges: [capturedSet("exec-guard:0")] });
    const second = runBuildStep(first, { fileChanges: [capturedSet("exec-guard:1")] });
    expect(ids(second)).toEqual(["exec-guard:0", "exec-guard:1"]);
  });

  it("replaces a set the write carries again by its id, where it stands", () => {
    const first = runBuildStep(existingWith(RunPhase.RUN_IN_PROGRESS), {
      fileChanges: [capturedSet("exec-guard:0", [], false), capturedSet("exec-guard:1")],
    });
    const recaptured = runBuildStep(first, { fileChanges: [capturedSet("exec-guard:0")] });
    expect(ids(recaptured)).toEqual(["exec-guard:0", "exec-guard:1"]);
    expect(recaptured.status?.fileChanges[0]?.candidateSnapshot).toBeDefined();
  });

  it("keeps the record across a write that carries none, a terminal one included", () => {
    const first = runBuildStep(existingWith(RunPhase.RUN_IN_PROGRESS), { fileChanges: [capturedSet("exec-guard:0")] });
    const done = runBuildStep(first, { phase: RunPhase.RUN_COMPLETED });
    expect(ids(done)).toEqual(["exec-guard:0"]);
  });

  it("keeps the live progress until its set is captured, and clears it once the run finishes", () => {
    const progress = { changeSetId: "exec-guard:0", filesChanged: 1 };
    const live = runBuildStep(existingWith(RunPhase.RUN_IN_PROGRESS), { fileChangeProgress: progress });
    expect(live.status?.fileChangeProgress?.filesChanged).toBe(1);
    const captured = runBuildStep(live, { fileChanges: [capturedSet("exec-guard:0")] });
    expect(captured.status?.fileChangeProgress).toBeUndefined();
    const finished = runBuildStep(live, { phase: RunPhase.RUN_COMPLETED });
    expect(finished.status?.fileChangeProgress).toBeUndefined();
  });
});

describe("the policy keeps in the write that captures", () => {
  const consented = (): RunReviewLog => ({
    decisions: [],
    allowed: new Set([toolUseEventId("exec-guard", "tc-shell")]),
  });
  const withProvenance = () => {
    const set = capturedSet("exec-guard:0");
    set.commandProvenance = create(TurnCommandProvenanceSchema, { consentToolCallIds: ["tc-shell"] });
    return set;
  };
  const origins = (decided: ReadonlyArray<SessionEvent>) =>
    decided.map((event) => (event.event.case === "stigmerFileReviewDecided" ? event.event.value.origin : event.event.case));

  it("decides nothing in a write handed no review log", () => {
    expect(merge(existingWith(RunPhase.RUN_IN_PROGRESS), { fileChanges: [withProvenance()] }).decided).toEqual([]);
  });

  it("returns the approved-command keep of a captured set whose consent the log shows", () => {
    const { decided } = merge(existingWith(RunPhase.RUN_IN_PROGRESS), { fileChanges: [withProvenance()] }, "wire", {
      reviewLog: consented(),
    });
    expect(origins(decided)).toEqual(["approved_command"]);
    expect(decided[0]?.runId).toBe("exec-guard");
  });

  it("closes an outdated turn's undecided set, and never decides a set twice in one write", () => {
    const outdated = merge(existingWith(RunPhase.RUN_COMPLETED), { fileChanges: [capturedSet("exec-guard:0")] }, "wire", {
      outdatedTurn: true,
      reviewLog: EMPTY_RUN_REVIEW_LOG,
    });
    expect(origins(outdated.decided)).toEqual(["next_turn"]);

    const both = merge(existingWith(RunPhase.RUN_COMPLETED), { fileChanges: [withProvenance()] }, "wire", {
      outdatedTurn: true,
      reviewLog: consented(),
    });
    expect(origins(both.decided)).toEqual(["approved_command"]);
  });

  it("keeps a plugin eval's try's set by the try's rule, and only once with the outdated close", () => {
    const tryRun = create(RunSchema, {
      metadata: { id: "exec-guard", labels: { "stigmer.ai/eval-run": "true" } },
      spec: {},
      status: { phase: RunPhase.RUN_IN_PROGRESS },
    });
    const { decided } = merge(tryRun, { fileChanges: [capturedSet("exec-guard:0")] }, "wire", {
      outdatedTurn: true,
      reviewLog: EMPTY_RUN_REVIEW_LOG,
    });
    expect(origins(decided)).toEqual(["eval_try"]);
  });
});

describe("the files a plugin-eval try's graders read (eval_files)", () => {
  const files = {
    files: [{ path: "app.txt", content: { case: "text" as const, value: "version = 1\n" } }],
  };

  it("keeps the runner's files on a try's run, and across a write without them", () => {
    const existing = existingWith(RunPhase.RUN_IN_PROGRESS);
    existing.spec = create(RunSchema, {
      spec: { evalCase: { pluginId: "plg_1", pluginDigest: "a".repeat(64), suiteDir: "evals", caseDir: "evals/fix" } },
    }).spec;
    const merged = runBuildStep(existing, { phase: RunPhase.RUN_COMPLETED, evalFiles: files });
    expect(merged.status?.evalFiles?.files.map((f) => [f.path, f.content.value])).toEqual([["app.txt", "version = 1\n"]]);
    const again = runBuildStep(merged, { phase: RunPhase.RUN_COMPLETED });
    expect(again.status?.evalFiles?.files).toHaveLength(1);
  });

  it("drops them on any other run", () => {
    const merged = runBuildStep(existingWith(RunPhase.RUN_IN_PROGRESS), {
      phase: RunPhase.RUN_COMPLETED,
      evalFiles: files,
    });
    expect(merged.status?.evalFiles).toBeUndefined();
  });
});

describe("what a run loaded (loaded_versions)", () => {
  const v1 = "1".repeat(64);
  const v2 = "2".repeat(64);
  const digest = "d".repeat(64);
  const skillAt = (version: string, slug = "") => ({ org: "org_a", kind: ApiResourceKind.skill, id: "skl_1", slug, version });
  const plugin = { org: "org_a", kind: ApiResourceKind.plugin, id: "plg_1", version: digest };
  const write = (loaded?: MessageInitShape<typeof RunStatusSchema>["loadedVersions"]) => ({
    phase: RunPhase.RUN_IN_PROGRESS,
    loadedVersions: loaded,
  });
  const pairs = (run: Run) => ({
    skills: run.status?.loadedVersions?.skills.map((r) => [r.id, r.version]),
    plugins: run.status?.loadedVersions?.plugins.map((r) => [r.id, r.version]),
  });

  it("stores the first write in its stored form: the list's kind, no slug", () => {
    const merged = runBuildStep(existingWith(RunPhase.RUN_IN_PROGRESS), write({
      skills: [{ ...skillAt(v1, "refunds"), kind: ApiResourceKind.agent }],
      plugins: [plugin],
    }));
    const [skill] = merged.status?.loadedVersions?.skills ?? [];
    expect([skill?.org, skill?.kind, skill?.id, skill?.slug, skill?.version]).toEqual(["org_a", ApiResourceKind.skill, "skl_1", "", v1]);
    expect(pairs(merged).plugins).toEqual([["plg_1", digest]]);
  });

  it("adds nothing on a resend, and keeps the list across a write without it", () => {
    const first = runBuildStep(existingWith(RunPhase.RUN_IN_PROGRESS), write({ skills: [skillAt(v1)], plugins: [plugin] }));
    const resent = runBuildStep(first, write({ skills: [skillAt(v1)], plugins: [plugin] }));
    expect(pairs(resent)).toEqual({ skills: [["skl_1", v1]], plugins: [["plg_1", digest]] });
    const without = runBuildStep(resent, write());
    expect(pairs(without)).toEqual({ skills: [["skl_1", v1]], plugins: [["plg_1", digest]] });
  });

  it("appends a moved version after the one before, in the order sent, and never removes one", () => {
    const first = runBuildStep(existingWith(RunPhase.RUN_IN_PROGRESS), write({ skills: [skillAt(v1)], plugins: [plugin] }));
    const resumed = runBuildStep(first, write({
      skills: [skillAt(v2), { org: "org_a", kind: ApiResourceKind.skill, id: "skl_2", version: v1 }],
      plugins: [],
    }));
    expect(pairs(resumed)).toEqual({
      skills: [["skl_1", v1], ["skl_1", v2], ["skl_2", v1]],
      plugins: [["plg_1", digest]],
    });
  });

  it("refuses an entry with no id at the boundary, in either list", () => {
    const ruleIds = (loaded: MessageInitShape<typeof RunStatusSchema>["loadedVersions"]) => {
      const result = validator().validate(
        RunUpdateStatusInputSchema,
        create(RunUpdateStatusInputSchema, { runId: "run_1", status: write(loaded) }),
      );
      if (result.kind === "error") {
        throw result.error;
      }
      return result.kind === "valid" ? [] : result.error.violations.map((v) => v.ruleId);
    };
    expect(ruleIds({ skills: [{ ...skillAt(v1), id: "" }] })).toContain("loaded_versions.skill_id");
    expect(ruleIds({ plugins: [{ ...plugin, id: "" }] })).toContain("loaded_versions.plugin_id");
    expect(ruleIds({ skills: [skillAt(v1)], plugins: [plugin] }).filter((id) => id.startsWith("loaded_versions."))).toEqual([]);
  });

  it("leaves a run with no list untouched by a write without one, the platform's included", () => {
    const merged = runBuildStep(existingWith(RunPhase.RUN_IN_PROGRESS), write(), "platform");
    expect(merged.status?.loadedVersions).toBeUndefined();
  });
});

describe("a paused execution stays paused until Resume (stigmer#1370)", () => {
  const paused = (): Run => existingWith(RunPhase.RUN_PAUSED);

  it("keeps PAUSED against a wire phase-only IN_PROGRESS write", () => {
    const merged = runBuildStep(paused(), { phase: RunPhase.RUN_IN_PROGRESS });
    expect(merged.status?.phase).toBe(RunPhase.RUN_PAUSED);
  });

  it("lets the platform's own write move a paused execution (the workflow's resume heal)", () => {
    const merged = runBuildStep(paused(), { phase: RunPhase.RUN_IN_PROGRESS }, "platform");
    expect(merged.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);
  });

  it("leaves a wire write on a running execution as it was (the latch is PAUSED's alone)", () => {
    const merged = runBuildStep(existingWith(RunPhase.RUN_IN_PROGRESS), {
      phase: RunPhase.RUN_WAITING_FOR_APPROVAL,
    });
    expect(merged.status?.phase).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
  });
});

describe("the agent a turn ran is the server's stamp alone", () => {
  it("a status write carrying agent_id and agent_version_hash changes neither, on any writer", () => {
    const stamped = create(RunSchema, {
      metadata: { id: "exec-stamp", name: "exec-stamp" },
      spec: {},
      status: {
        phase: RunPhase.RUN_IN_PROGRESS,
        agentId: "agt_ran",
        agentVersionHash: "a".repeat(64),
      },
    });
    for (const writer of ["wire", "platform"] as const) {
      const merged = runBuildStep(
        stamped,
        {
          phase: RunPhase.RUN_IN_PROGRESS,
          agentId: "agt_other",
          agentVersionHash: "b".repeat(64),
        },
        writer,
      );
      expect(merged.status?.agentId, writer).toBe("agt_ran");
      expect(merged.status?.agentVersionHash, writer).toBe("a".repeat(64));
    }
  });
});
