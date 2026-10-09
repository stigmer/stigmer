/**
 * Pins the Quality tab's conversions: a sample rate reads as "one in N
 * runs" and N writes back as 1/N, clamped to 1..100; a new evaluator's
 * input carries the agent and its organization, an update addresses the
 * stored evaluator by id; a stored rate that is not a whole one in N is
 * kept unless N changes; a limit is a positive, finite amount up to the
 * contract's ceiling, and one below a grade's maximum cost grades no run.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import {
  DEFAULT_GRADING_SETTINGS,
  evaluatorInputOf,
  gradesNoRun,
  isValidLimit,
  settingsOf,
} from "../grading-settings";

const AGENT = { id: "agt_1", org: "org_acme" };

describe("grading settings", () => {
  it("reads a sample rate as one in N runs", () => {
    const evaluator = create(EvaluatorSchema, {
      metadata: { id: "evl_1", org: "org_acme" },
      spec: { agentId: "agt_1", enabled: true, sampleRate: 0.1, monthlyLimitUsd: 25, modelName: "claude-haiku-4-5" },
    });
    expect(settingsOf(evaluator)).toEqual({
      enabled: true,
      oneIn: 10,
      monthlyLimitUsd: 25,
      modelName: "claude-haiku-4-5",
    });
  });

  it("writes N back as a rate, clamped to one in 1..100", () => {
    expect(evaluatorInputOf(AGENT, { ...DEFAULT_GRADING_SETTINGS, oneIn: 4 }, null).sampleRate).toBe(0.25);
    expect(evaluatorInputOf(AGENT, { ...DEFAULT_GRADING_SETTINGS, oneIn: 0 }, null).sampleRate).toBe(1);
    expect(evaluatorInputOf(AGENT, { ...DEFAULT_GRADING_SETTINGS, oneIn: 500 }, null).sampleRate).toBe(0.01);
    expect(evaluatorInputOf(AGENT, { ...DEFAULT_GRADING_SETTINGS, oneIn: Number.NaN }, null).sampleRate).toBe(0.1);
  });

  it("creates for the agent in its organization, and updates the stored evaluator by id", () => {
    const fresh = evaluatorInputOf(AGENT, DEFAULT_GRADING_SETTINGS, null);
    expect(fresh).toMatchObject({ org: "org_acme", agentId: "agt_1", enabled: true, monthlyLimitUsd: 10 });
    expect(fresh.id).toBeUndefined();
    const stored = create(EvaluatorSchema, { metadata: { id: "evl_1", name: "evl_1", org: "org_acme" } });
    expect(evaluatorInputOf(AGENT, DEFAULT_GRADING_SETTINGS, stored)).toMatchObject({ id: "evl_1", name: "evl_1" });
  });

  it("accepts only a positive, finite limit up to the ceiling", () => {
    expect(isValidLimit(10)).toBe(true);
    expect(isValidLimit(0)).toBe(false);
    expect(isValidLimit(Number.NaN)).toBe(false);
    expect(isValidLimit(100_001)).toBe(false);
  });

  it("says a limit below one grade's maximum cost grades no run", () => {
    expect(gradesNoRun(0.1)).toBe(true);
    expect(gradesNoRun(0.25)).toBe(false);
    expect(gradesNoRun(0)).toBe(false);
  });

  it("keeps a stored rate that is not a whole one in N unless N changes", () => {
    const evaluator = create(EvaluatorSchema, {
      metadata: { id: "evl_1", org: "org_acme" },
      spec: { agentId: "agt_1", enabled: true, sampleRate: 0.004, monthlyLimitUsd: 10 },
    });
    const shown = settingsOf(evaluator);
    expect(shown.oneIn).toBe(100);
    expect(evaluatorInputOf(AGENT, { ...shown, modelName: "claude-haiku-4-5" }, evaluator).sampleRate).toBe(0.004);
    expect(evaluatorInputOf(AGENT, { ...shown, oneIn: 50 }, evaluator).sampleRate).toBe(0.02);
  });
});
