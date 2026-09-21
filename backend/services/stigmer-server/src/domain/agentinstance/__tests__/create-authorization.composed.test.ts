/**
 * Pins the instance create lane's authorization at the wire, on a real boot
 * under the require-authentication posture with no unit Authorizer (the
 * self-host's shape, the built-in Authorizer composed):
 *
 *   - a member creates a personal instance of an org-visible agent in their
 *     organization (can_create_agent_instance is member-level; the parent's
 *     can_create_instance is its viewer set);
 *   - a member is refused an instance of a PRIVATE agent with the parent's
 *     copy — the organization's bar passed, the agent's did not;
 *   - an outsider naming an organization they hold no row in is refused
 *     with the organization's copy, before anything about the agent;
 *   - a member's wire request carrying the reserved default-instance label
 *     is refused: the label buys nothing from the wire (the reserved-label
 *     guard refuses it after the caller passes the personal bar);
 *   - the SAME labelled request the server composes in-process for the
 *     member (the default-instance self-heal's exact shape: the in-process
 *     transport, the propagated caller, the parent's organization) is
 *     admitted with no caller check and attributed to the member — the
 *     arm that keeps every lane whose run was already admitted (a guest, a
 *     channel turn, a schedule fire) working when the agent has no default
 *     instance yet.
 *
 * Every negative arm sits beside a positive one so the file cannot pass
 * vacuously. The resolver's own table is create-authorization.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/command_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import {
  DEFAULT_INSTANCE_LABEL,
  RESERVED_LABEL_TRUE,
} from "../../../pipeline/apiresource-labels.js";
import {
  IN_PROCESS_CALLER_HEADER,
  encodeInProcessCaller,
} from "../../../pipeline/interceptors/auth.js";
import { buildDefaultInstanceRequest } from "../defaultinstance.js";
import {
  INSTANCE_ORGANIZATION_DENIED_MESSAGE,
  INSTANCE_PARENT_DENIED_MESSAGE,
} from "../steps.js";

const FOUNDER = "fake|founder";
const MEMBER = "fake|member";
const STRANGER = "fake|stranger";
const ORG = "instance-authz-org";

function organizationInput(slug: string) {
  return {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug, org: "" },
    spec: { description: slug },
  };
}

function agentInput(name: string, visibility: ApiResourceVisibility) {
  return {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: { name, org: ORG, visibility },
    spec: { instructions: "a conformant instruction body" },
  };
}

function instanceInput(
  name: string,
  agentId: string,
  org: string = ORG,
  labels: Record<string, string> = {},
) {
  return {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "AgentInstance",
    metadata: { name, org, labels },
    spec: { agentId, description: name },
  };
}

async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the call to fail");
}

describe("agent instance create under the built-in authorizer", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let orgAgent: Agent;
  let privateAgent: Agent;

  const asFounder = () =>
    transportFor(port, fakeJwt(FOUNDER, "founder@example.com"));
  const asMember = () =>
    transportFor(port, fakeJwt(MEMBER, "member@example.com"));
  const asStranger = () =>
    transportFor(port, fakeJwt(STRANGER, "stranger@example.com"));

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "instance-create-authz-"));
    const unit: ServerExtension = {
      name: "fake-oidc-only",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();

    // The membership rules of a self-host: a person who provisions while
    // the organization exists joins it as a member; a person provisioned
    // BEFORE it was founded holds no row on it. So the stranger provisions
    // first, the founder founds, and the member provisions after.
    await createClient(
      IdentityAccountCommandController,
      asFounder(),
    ).provisionMyAccount({});
    await createClient(
      IdentityAccountCommandController,
      asStranger(),
    ).provisionMyAccount({});
    await createClient(OrganizationCommandController, asFounder()).create(
      organizationInput(ORG),
    );
    await createClient(
      IdentityAccountCommandController,
      asMember(),
    ).provisionMyAccount({});

    const founderAgents = createClient(AgentCommandController, asFounder());
    orgAgent = await founderAgents.create(
      agentInput("Org Agent", ApiResourceVisibility.visibility_org),
    );
    privateAgent = await founderAgents.create(
      agentInput("Private Agent", ApiResourceVisibility.visibility_private),
    );
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a member creates a personal instance of an org-visible agent in their organization", async () => {
    const created = await createClient(
      AgentInstanceCommandController,
      asMember(),
    ).create(instanceInput("member-personal", orgAgent.metadata!.id));
    expect(created.metadata?.org).toBe(ORG);
    expect(created.status?.audit?.specAudit?.createdBy?.id).toBe(MEMBER);
  });

  it("a member is refused an instance of a PRIVATE agent with the parent's copy", async () => {
    const error = await failureOf(
      createClient(AgentInstanceCommandController, asMember()).create(
        instanceInput("member-on-private", privateAgent.metadata!.id),
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(INSTANCE_PARENT_DENIED_MESSAGE);
  });

  it("an outsider naming the organization is refused with the organization's copy, before the agent is named", async () => {
    const error = await failureOf(
      createClient(AgentInstanceCommandController, asStranger()).create(
        instanceInput("stranger-instance", orgAgent.metadata!.id),
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(INSTANCE_ORGANIZATION_DENIED_MESSAGE);
  });

  it("the reserved default-instance label buys nothing from the wire", async () => {
    const error = await failureOf(
      createClient(AgentInstanceCommandController, asMember()).create(
        instanceInput("wire-default", orgAgent.metadata!.id, ORG, {
          [DEFAULT_INSTANCE_LABEL]: RESERVED_LABEL_TRUE,
        }),
      ),
    );
    // The personal bar admits a member on an org-visible agent; the label
    // guard then refuses the reserved label a wire caller may not write.
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toContain(DEFAULT_INSTANCE_LABEL);
  });

  it("the same labelled request composed in-process for the member is admitted and attributed to them (the self-heal's shape)", async () => {
    const member = await fakeVerifier.verify(
      fakeJwt(MEMBER, "member@example.com"),
    );
    if (member === null) {
      throw new Error("the fake verifier must admit the member");
    }
    // The agent's own default instance already exists (agent create made
    // it); the self-heal's request is the same shape under a slug the store
    // does not hold yet, which is what a legacy agent without one presents.
    const request = buildDefaultInstanceRequest(orgAgent.metadata!);
    request.metadata!.name = "org-agent-default-healed";
    const created = await createClient(
      AgentInstanceCommandController,
      server.inProcessTransport,
    ).create(request, {
      headers: { [IN_PROCESS_CALLER_HEADER]: encodeInProcessCaller(member) },
    });
    expect(created.metadata?.labels?.[DEFAULT_INSTANCE_LABEL]).toBe(
      RESERVED_LABEL_TRUE,
    );
    expect(created.metadata?.org).toBe(ORG);
    expect(created.status?.audit?.specAudit?.createdBy?.id).toBe(MEMBER);
  });
});
