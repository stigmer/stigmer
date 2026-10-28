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
// stored turn's session is read through the session_id arm alone; Slack,
// WhatsApp and web channels pin an agent version only when the caller passes
// one, and a WhatsApp channel binds its app only when given its slug.
// The slugs a parent lists in `subagents` are read off the agents the server
// returned, in order, and an agent with no slug is refused.
// Pure: hand-built resources, no target.
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { describe, expect, it } from "vitest";
import { WHATSAPP_FIXTURE_PHONE_NUMBER_ID, makeSlackChannel, makeWebChannel, makeWhatsAppChannel } from "../channels";
import { makeAgentExecution, sessionIdOf } from "../runs";
import { agentRefOf, makeAgentRef, subagentSlugsOf } from "../agents";
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
      sessionSpec: { harness: Harness.CLAUDE, subject: "review" },
    }).spec?.target;
    const spec = target?.case === "sessionSpec" ? target.value : undefined;
    expect(spec?.harness).toBe(Harness.CLAUDE);
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
});

describe("sessionIdOf", () => {
  it("reads the session a stored turn belongs to through the session_id arm alone", () => {
    expect(sessionIdOf(create(RunSchema, { spec: { target: { case: "sessionId", value: "ses_unit" } } }))).toBe(
      "ses_unit",
    );
    expect(sessionIdOf(create(RunSchema, { spec: { target: { case: "sessionSpec", value: {} } } }))).toBe("");
    expect(sessionIdOf(create(RunSchema, {}))).toBe("");
    expect(sessionIdOf(undefined)).toBe("");
  });
});

describe("channel agent versions", () => {
  it("pins the agent version a Slack channel's conversations start on only when given", () => {
    expect(makeSlackChannel("acme", "chan", "code-reviewer", { agentRefVersion: "stable" }).spec?.agentRef).toEqual({
      slug: "code-reviewer",
      kind: ApiResourceKind.agent,
      version: "stable",
    });
    expect(makeSlackChannel("acme", "chan", "code-reviewer").spec?.agentRef).not.toHaveProperty("version");
  });

  it("pins the agent version a web channel's conversations start on only when given", () => {
    expect(makeWebChannel("acme", "code-reviewer", { agentRefVersion: "stable" }).spec?.agentRef).toEqual({
      slug: "code-reviewer",
      kind: ApiResourceKind.agent,
      version: "stable",
    });
    expect(makeWebChannel("acme", "code-reviewer").spec?.agentRef).not.toHaveProperty("version");
  });

  it("pins the agent version a WhatsApp channel's conversations start on only when given, and binds its app only when named", () => {
    const pinned = makeWhatsAppChannel("acme", "chan", "code-reviewer", { agentRefVersion: "stable", appRefSlug: "byo" });
    expect(pinned.spec?.agentRef).toEqual({ slug: "code-reviewer", kind: ApiResourceKind.agent, version: "stable" });
    expect(pinned.spec?.type).toEqual({
      case: "whatsapp",
      value: { phoneNumberId: WHATSAPP_FIXTURE_PHONE_NUMBER_ID, appRef: { slug: "byo", kind: ApiResourceKind.channel_app } },
    });
    const bare = makeWhatsAppChannel("acme", undefined, "code-reviewer");
    expect(bare.metadata).toEqual({ org: "acme" });
    expect(bare.spec?.agentRef).not.toHaveProperty("version");
    expect(bare.spec?.type).toEqual({ case: "whatsapp", value: { phoneNumberId: WHATSAPP_FIXTURE_PHONE_NUMBER_ID } });
  });
});

describe("subagentSlugsOf", () => {
  it("answers each returned agent's slug, in order", () => {
    const agents = [
      create(AgentSchema, { metadata: { org: "acme", slug: "researcher" } }),
      create(AgentSchema, { metadata: { org: "acme", slug: "writer" } }),
    ];
    expect(subagentSlugsOf(agents)).toEqual(["researcher", "writer"]);
  });

  it("refuses an agent with no slug, which no server returns", () => {
    expect(() => subagentSlugsOf([create(AgentSchema, { metadata: { org: "acme" } })])).toThrow("slug set");
    expect(() => subagentSlugsOf([create(AgentSchema, {})])).toThrow("slug set");
  });
});
