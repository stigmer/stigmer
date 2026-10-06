// Unit arms for makeArtifactInput, the builder every artifact suite creates
// through. What it pins: exactly one run is named as the artifact's source
// (a workflow run when asked, else an agent run, with a fixed fabricated id by
// default), and the defaults and the retention override land on the spec.
// Pure: the builder's output, no target.
// Domain: conformance support.
import { describe, expect, it } from "vitest";
import { ARTIFACT_DEFAULT_CONTENT, makeArtifactInput } from "../artifacts";

describe("makeArtifactInput", () => {
  it("defaults to an agent-run source, a text file and the default content, with no retention", () => {
    const input = makeArtifactInput();
    expect(input.spec?.source).toEqual({ agentRunId: "aexec_01conformancefixture" });
    expect(input.spec?.displayName).toBe("conformance-artifact.txt");
    expect(input.spec?.contentType).toBe("text/plain");
    expect(input.spec).not.toHaveProperty("retention");
    expect(input.content).toBe(ARTIFACT_DEFAULT_CONTENT);
  });

  it("names the given agent run as the source", () => {
    expect(makeArtifactInput({ agentExecutionId: "aex_given" }).spec?.source).toEqual({ agentRunId: "aex_given" });
  });

  it("names a workflow run as the only source when one is given, even beside an agent run", () => {
    const input = makeArtifactInput({ workflowExecutionId: "wex_given", agentExecutionId: "aex_ignored" });
    expect(input.spec?.source).toEqual({ workflowRunId: "wex_given" });
  });

  it("carries the retention TTL and the overrides it is given", () => {
    const content = new TextEncoder().encode("x");
    const input = makeArtifactInput({ displayName: "a.json", contentType: "application/json", content, ttlDays: -1 });
    expect(input.spec?.retention).toEqual({ ttlDays: -1 });
    expect(input.spec?.displayName).toBe("a.json");
    expect(input.spec?.contentType).toBe("application/json");
    expect(input.content).toBe(content);
  });
});
