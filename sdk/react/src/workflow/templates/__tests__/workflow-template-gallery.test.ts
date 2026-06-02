import { describe, it, expect } from "vitest";
import { WORKFLOW_TEMPLATES } from "../../../resource-creation/templates/workflow-templates";
import { deriveTemplateMeta } from "../derive-template-metadata";

describe("WORKFLOW_TEMPLATES", () => {
  it("has 8 templates", () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(8);
  });

  it("every template has a unique id", () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every template has required fields", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.category).toBeTruthy();
      expect(template.data.yaml).toBeTruthy();
    }
  });

  it("every template YAML parses to non-zero task count", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const meta = deriveTemplateMeta(template.data.yaml ?? "");
      expect(meta.taskCount).toBeGreaterThan(0);
    }
  });

  it("every template has at least one detected pattern", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const meta = deriveTemplateMeta(template.data.yaml ?? "");
      expect(meta.patterns.length).toBeGreaterThan(0);
    }
  });

  it("templates cover expected categories", () => {
    const categories = new Set(WORKFLOW_TEMPLATES.map((t) => t.category));
    expect(categories.has("data-analysis")).toBe(true);
    expect(categories.has("customer-support")).toBe(true);
    expect(categories.has("content")).toBe(true);
    expect(categories.has("integration")).toBe(true);
  });

  it("templates collectively cover key task kinds", () => {
    const allKinds = new Set<string>();
    for (const template of WORKFLOW_TEMPLATES) {
      const meta = deriveTemplateMeta(template.data.yaml ?? "");
      for (const kind of meta.taskKinds) allKinds.add(kind);
    }

    expect(allKinds.has("llm_call")).toBe(true);
    expect(allKinds.has("agent_call")).toBe(true);
    expect(allKinds.has("http_call")).toBe(true);
    expect(allKinds.has("switch_case")).toBe(true);
    expect(allKinds.has("fork")).toBe(true);
    expect(allKinds.has("for_each")).toBe(true);
    expect(allKinds.has("try_catch")).toBe(true);
    expect(allKinds.has("transform")).toBe(true);
    expect(allKinds.has("human_input")).toBe(true);
    expect(allKinds.has("set_vars")).toBe(true);
  });

  it("templates collectively cover key patterns", () => {
    const allPatterns = new Set<string>();
    for (const template of WORKFLOW_TEMPLATES) {
      const meta = deriveTemplateMeta(template.data.yaml ?? "");
      for (const p of meta.patterns) allPatterns.add(p);
    }

    expect(allPatterns.has("parallel")).toBe(true);
    expect(allPatterns.has("branching")).toBe(true);
    expect(allPatterns.has("hitl")).toBe(true);
    expect(allPatterns.has("loop")).toBe(true);
    expect(allPatterns.has("error-handling")).toBe(true);
    expect(allPatterns.has("batch")).toBe(true);
    expect(allPatterns.has("ai-pipeline")).toBe(true);
    expect(allPatterns.has("http-integration")).toBe(true);
  });
});

describe("individual template metadata", () => {
  it("research-and-summarize has parallel and hitl patterns", () => {
    const template = WORKFLOW_TEMPLATES.find(
      (t) => t.id === "research-and-summarize",
    )!;
    const meta = deriveTemplateMeta(template.data.yaml ?? "");
    expect(meta.patterns).toContain("parallel");
    expect(meta.patterns).toContain("hitl");
    expect(meta.taskCount).toBe(5);
  });

  it("support-ticket-triage has branching and hitl patterns", () => {
    const template = WORKFLOW_TEMPLATES.find(
      (t) => t.id === "support-ticket-triage",
    )!;
    const meta = deriveTemplateMeta(template.data.yaml ?? "");
    expect(meta.patterns).toContain("branching");
    expect(meta.patterns).toContain("hitl");
    expect(meta.taskCount).toBe(6);
  });

  it("content-review-pipeline has loop and hitl patterns", () => {
    const template = WORKFLOW_TEMPLATES.find(
      (t) => t.id === "content-review-pipeline",
    )!;
    const meta = deriveTemplateMeta(template.data.yaml ?? "");
    expect(meta.patterns).toContain("loop");
    expect(meta.patterns).toContain("hitl");
  });

  it("batch-data-enrichment has batch and http-integration patterns", () => {
    const template = WORKFLOW_TEMPLATES.find(
      (t) => t.id === "batch-data-enrichment",
    )!;
    const meta = deriveTemplateMeta(template.data.yaml ?? "");
    expect(meta.patterns).toContain("batch");
    expect(meta.patterns).toContain("http-integration");
  });

  it("multi-agent-pipeline has ai-pipeline pattern", () => {
    const template = WORKFLOW_TEMPLATES.find(
      (t) => t.id === "multi-agent-pipeline",
    )!;
    const meta = deriveTemplateMeta(template.data.yaml ?? "");
    expect(meta.patterns).toContain("ai-pipeline");
  });

  it("error-resilient-integration has error-handling pattern", () => {
    const template = WORKFLOW_TEMPLATES.find(
      (t) => t.id === "error-resilient-integration",
    )!;
    const meta = deriveTemplateMeta(template.data.yaml ?? "");
    expect(meta.patterns).toContain("error-handling");
  });

  it("webhook-event-processor has branching and http-integration", () => {
    const template = WORKFLOW_TEMPLATES.find(
      (t) => t.id === "webhook-event-processor",
    )!;
    const meta = deriveTemplateMeta(template.data.yaml ?? "");
    expect(meta.patterns).toContain("branching");
    expect(meta.patterns).toContain("http-integration");
  });
});
