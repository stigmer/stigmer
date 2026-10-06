// Unit arms for how the fixture builders name a conversation's agent: by
// reference (organization, slug, optionally a version), never by an id.
// Domain: conformance support.
//
// Pinned: a reference read off a created agent carries its org and slug and
// a version only when asked, and refuses an agent the server never returned;
// the projected ApiResourceReference is of kind agent and sets a version only
// when the reference has one; a session spec names its agent only when given
// one (none is the built-in assistant); a turn's target oneof holds exactly
// one arm — an existing session, or a new conversation's session spec with
// the agent reference folded into the spec the caller shaped — and a fixture
// that asks for both arms is refused rather than silently dropping one; a
// stored turn's session is read through the session_id arm alone; channels
// and shares pin an agent version only when the caller passes one.
// Pure: hand-built resources, no target.
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { describe, expect, it } from "vitest";
import { makeSlackAgentChannel } from "../agentchannels";
import { makeAgentExecution, sessionIdOf } from "../agentruns";
import { agentRefOf, makeAgentRef } from "../agents";
import { makeAgentShare } from "../agentshares";
import { makeSessionSpec } from "../sessions";

const REF = { org: "acme", slug: "code-reviewer" };

describe("agentRefOf", () => {
  const agent = create(AgentSchema, { metadata: { id: "agt_unit", org: "acme", slug: "code-reviewer" } });

  it("answers the created agent's org and slug, with a version only when asked", () => {
    expect(agentRefOf(agent)).toEqual(REF);
    expect(agentRefOf(agent, "stable")).toEqual({ ...REF, version: "stable" });
  });

  it("refuses an agent with no org or slug, which no server returns", () => {
    expect(() => agentRefOf(create(AgentSchema, { metadata: { org: "acme" } }))).toThrow("org and slug set");
    expect(() => agentRefOf(create(AgentSchema, {}))).toThrow("org and slug set");
  });
});

describe("makeAgentRef", () => {
  it("projects a reference of kind agent, setting the version only when the reference has one", () => {
    expect(makeAgentRef(REF)).toEqual({ kind: ApiResourceKind.agent, org: "acme", slug: "code-reviewer" });
    expect(makeAgentRef({ ...REF, version: "latest" })).toEqual({
      kind: ApiResourceKind.agent,
      org: "acme",
      slug: "code-reviewer",
      version: "latest",
    });
  });
});

describe("makeSessionSpec", () => {
  it("names the agent it is given", () => {
    expect(makeSessionSpec({ agentRef: { ...REF, version: "v2" } }).agentRef).toEqual({
      kind: ApiResourceKind.agent,
      org: "acme",
      slug: "code-reviewer",
      version: "v2",
    });
  });

  it("names no agent when given none: the built-in assistant", () => {
    expect(makeSessionSpec()).not.toHaveProperty("agentRef");
  });
});

describe("makeAgentExecution's target", () => {
  const base = { org: "acme", name: "turn" };

  it("continues an existing session through the session_id arm", () => {
    expect(makeAgentExecution({ ...base, sessionId: "ses_unit" }).spec?.target).toEqual({
      case: "sessionId",
      value: "ses_unit",
    });
  });

  it("starts a conversation on the agent through a new session spec", () => {
    const target = makeAgentExecution({ ...base, agentRef: REF }).spec?.target;
    expect(target?.case).toBe("sessionSpec");
    expect(target?.case === "sessionSpec" ? target.value.agentRef : undefined).toMatchObject({
      kind: ApiResourceKind.agent,
      org: "acme",
      slug: "code-reviewer",
      version: "",
    });
  });

  it("folds the agent reference into the session spec the caller shaped", () => {
    const target = makeAgentExecution({
      ...base,
      agentRef: { ...REF, version: "stable" },
      sessionSpec: { harness: Harness.CURSOR, subject: "review" },
    }).spec?.target;
    const spec = target?.case === "sessionSpec" ? target.value : undefined;
    expect(spec?.harness).toBe(Harness.CURSOR);
    expect(spec?.subject).toBe("review");
    expect(spec?.agentRef).toMatchObject({ org: "acme", slug: "code-reviewer", version: "stable" });
  });

  it("carries a session spec with no agent as the caller shaped it", () => {
    const target = makeAgentExecution({ ...base, sessionSpec: { subject: "assistant" } }).spec?.target;
    expect(target?.case === "sessionSpec" ? target.value.agentRef : "unset").toBeUndefined();
  });

  it("sets no target with neither arm: a conversation with the built-in assistant", () => {
    expect(makeAgentExecution(base).spec).not.toHaveProperty("target");
  });

  it("refuses a session id beside an agent reference or a session spec", () => {
    expect(() => makeAgentExecution({ ...base, sessionId: "ses_unit", agentRef: REF })).toThrow("spec.target is a oneof");
    expect(() => makeAgentExecution({ ...base, sessionId: "ses_unit", sessionSpec: {} })).toThrow(
      "spec.target is a oneof",
    );
  });

  it("passes the labels and the workflow parent through verbatim", () => {
    const execution = makeAgentExecution({
      ...base,
      labels: { "stigmer.ai/lineage": "wfx_unit" },
      parent: { workflowRunId: "wfx_unit" },
    });
    expect(execution.metadata?.labels).toEqual({ "stigmer.ai/lineage": "wfx_unit" });
    expect(execution.spec?.parent).toEqual({ workflowRunId: "wfx_unit" });
    expect(makeAgentExecution(base).metadata).not.toHaveProperty("labels");
  });
});

describe("sessionIdOf", () => {
  it("reads the session a stored turn belongs to through the session_id arm alone", () => {
    expect(sessionIdOf(create(AgentRunSchema, { spec: { target: { case: "sessionId", value: "ses_unit" } } }))).toBe(
      "ses_unit",
    );
    expect(sessionIdOf(create(AgentRunSchema, { spec: { target: { case: "sessionSpec", value: {} } } }))).toBe("");
    expect(sessionIdOf(create(AgentRunSchema, {}))).toBe("");
    expect(sessionIdOf(undefined)).toBe("");
  });
});

describe("channel and share agent versions", () => {
  it("pins the agent version a Slack channel's conversations start on only when given", () => {
    expect(makeSlackAgentChannel("acme", "chan", "code-reviewer", { agentRefVersion: "stable" }).spec?.agentRef).toEqual({
      slug: "code-reviewer",
      kind: ApiResourceKind.agent,
      version: "stable",
    });
    expect(makeSlackAgentChannel("acme", "chan", "code-reviewer").spec?.agentRef).not.toHaveProperty("version");
  });

  it("pins the agent version a share's conversations start on only when given", () => {
    expect(makeAgentShare("acme", "code-reviewer", { agentRefVersion: "stable" }).spec?.agentRef).toEqual({
      slug: "code-reviewer",
      kind: ApiResourceKind.agent,
      version: "stable",
    });
    expect(makeAgentShare("acme", "code-reviewer").spec?.agentRef).not.toHaveProperty("version");
  });
});
