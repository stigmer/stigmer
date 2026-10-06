// In-process test for the mutating verbs (delete / tag).
//
// Stands up a real Connect backend over h2c serving the query *and* command
// controllers these verbs call, points an SDK node client at it, and drives the
// resource layer (planDelete → perform, tagVersion for workflows and agents) end to end. Asserts the
// rendered result shape, the special-case routing (execution→cancel,
// already-terminal), and that backend errors map to the right CLI exit code.

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { AgentRunCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/command_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/query_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/command_pb";
import { AgentChannelQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/query_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppCommandController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/command_pb";
import { ChannelAppQueryController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/query_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleCommandController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/command_pb";
import { ScheduleQueryController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/query_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import type { Stigmer } from "@stigmer/sdk";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { classify, ExitCode } from "../../errors/index.js";
import { planDelete } from "../delete.js";
import { tagVersion } from "../tag.js";

const knownAgent = create(AgentSchema, {
  metadata: { name: "Reviewer", slug: "reviewer", org: "acme", id: "agt_1" },
});

const knownOrganization = create(OrganizationSchema, {
  metadata: { name: "Acme", slug: "acme", id: "org_01jacme00000000000000000000" },
});
let organizationDeleteIds: string[] = [];

const knownMcp = create(McpServerSchema, {
  metadata: { name: "Filesystem", slug: "filesystem", org: "acme", id: "mcp_1" },
});

const knownWorkflow = create(WorkflowSchema, {
  metadata: { name: "Deploy", slug: "deploy", org: "acme", id: "wfl_1" },
});

const knownEnvironment = create(EnvironmentSchema, {
  metadata: { name: "clinic-patient-db", slug: "clinic-patient-db", org: "acme", id: "env_1" },
});

const knownChannel = create(AgentChannelSchema, {
  metadata: { name: "clinic-patient-whatsapp", slug: "clinic-patient-whatsapp", org: "acme", id: "ach_1" },
});

const knownChannelApp = create(ChannelAppSchema, {
  metadata: { name: "clinic-meta-app", slug: "clinic-meta-app", org: "acme", id: "chapp_1" },
});

const knownSchedule = create(ScheduleSchema, {
  metadata: { name: "daily-fee-reminders", slug: "daily-fee-reminders", org: "acme", id: "sch_1" },
});

// Pending execution (cancellable) vs. an already-terminal one.
const pendingExecution = create(AgentRunSchema, {
  metadata: { id: "aex_run" },
  status: { phase: RunPhase.RUN_PENDING },
});
const cancelledExecution = create(AgentRunSchema, {
  metadata: { id: "aex_run" },
  status: { phase: RunPhase.RUN_CANCELLED },
});
const completedExecution = create(AgentRunSchema, {
  metadata: { id: "aex_done" },
  status: { phase: RunPhase.RUN_COMPLETED },
});

let backend: Http2Server;
let client: Stigmer;
const openSessions = new Set<ServerHttp2Session>();

// Spies for the command-side calls, reset per test.
let cancelCalls: string[] = [];
let tagCalls: { workflowId: string; versionHash: string; tag: string }[] = [];
let agentTagCalls: { agentId: string; versionHash: string; tag: string }[] = [];
// Force-carrying deletes record what actually rode the RPC.
let environmentDeletes: { resourceId: string; force: boolean }[] = [];
let channelAppDeletes: { resourceId: string; force: boolean }[] = [];
// agent_channel and schedule delete by typed ID — no force field exists on
// their wire contracts.
let channelDeleteIds: string[] = [];
let scheduleDeleteIds: string[] = [];

beforeEach(() => {
  cancelCalls = [];
  tagCalls = [];
  agentTagCalls = [];
  environmentDeletes = [];
  channelAppDeletes = [];
  channelDeleteIds = [];
  scheduleDeleteIds = [];
  organizationDeleteIds = [];
});

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(AgentQueryController, {
      get: (req) => {
        if (req.value !== "agt_1") throw new ConnectError("agent not found", Code.NotFound);
        return knownAgent;
      },
      getByReference: (req) => {
        if (req.slug !== "reviewer") throw new ConnectError("agent not found", Code.NotFound);
        return knownAgent;
      },
    });
    router.service(AgentCommandController, {
      delete: () => knownAgent,
      tagVersion: (req) => {
        agentTagCalls.push({ agentId: req.agentId, versionHash: req.versionHash, tag: req.tag });
        return knownAgent;
      },
    });

    router.service(McpServerQueryController, {
      getByReference: () => knownMcp,
    });
    router.service(McpServerCommandController, {
      delete: (req) => {
        if (req.resourceId !== "mcp_1") throw new ConnectError("bad id", Code.InvalidArgument);
        return knownMcp;
      },
    });

    router.service(EnvironmentQueryController, {
      getByReference: (req) => {
        if (req.slug !== "clinic-patient-db") throw new ConnectError("environment not found", Code.NotFound);
        return knownEnvironment;
      },
    });
    router.service(EnvironmentCommandController, {
      delete: (req) => {
        environmentDeletes.push({ resourceId: req.resourceId, force: req.force });
        return knownEnvironment;
      },
    });

    router.service(AgentChannelQueryController, {
      getByReference: (req) => {
        if (req.slug !== "clinic-patient-whatsapp") throw new ConnectError("agent channel not found", Code.NotFound);
        return knownChannel;
      },
    });
    router.service(AgentChannelCommandController, {
      delete: (req) => {
        channelDeleteIds.push(req.value);
        return knownChannel;
      },
    });

    router.service(ChannelAppQueryController, {
      getByReference: (req) => {
        if (req.slug !== "clinic-meta-app") throw new ConnectError("channel app not found", Code.NotFound);
        return knownChannelApp;
      },
    });
    router.service(ChannelAppCommandController, {
      delete: (req) => {
        channelAppDeletes.push({ resourceId: req.resourceId, force: req.force });
        return knownChannelApp;
      },
    });

    router.service(ScheduleQueryController, {
      getByReference: (req) => {
        if (req.slug !== "daily-fee-reminders") throw new ConnectError("schedule not found", Code.NotFound);
        return knownSchedule;
      },
    });
    router.service(ScheduleCommandController, {
      delete: (req) => {
        scheduleDeleteIds.push(req.value);
        return knownSchedule;
      },
    });

    router.service(WorkflowQueryController, {
      getByReference: (req) => {
        if (req.slug !== "deploy") throw new ConnectError("workflow not found", Code.NotFound);
        return knownWorkflow;
      },
    });
    router.service(WorkflowCommandController, {
      tagVersion: (req) => {
        tagCalls.push({ workflowId: req.workflowId, versionHash: req.versionHash, tag: req.tag });
        return knownWorkflow;
      },
    });

    router.service(OrganizationQueryController, {
      get: (req) => {
        if (req.value !== knownOrganization.metadata?.id) {
          throw new ConnectError("organization not found", Code.NotFound);
        }
        return knownOrganization;
      },
      findMyOrganizations: () => ({ entries: [knownOrganization] }),
    });
    router.service(OrganizationCommandController, {
      delete: (req) => {
        organizationDeleteIds.push(req.value);
        return knownOrganization;
      },
    });

    router.service(AgentRunQueryController, {
      get: (req) => {
        if (req.value === "aex_done") return completedExecution;
        if (req.value === "aex_run") return pendingExecution;
        throw new ConnectError("execution not found", Code.NotFound);
      },
    });
    router.service(AgentRunCommandController, {
      cancel: (req) => {
        cancelCalls.push(req.id);
        return cancelledExecution;
      },
    });
  };

  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;
  client = createNodeClient({ baseUrl: normalizeEndpoint(`127.0.0.1:${port}`) });
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("delete (standard kinds)", () => {
  it("describes then deletes an agent by ID", async () => {
    const plan = await planDelete(client, "agent", "agt_1", "acme");

    expect(plan.warning.status).toBe("warning");
    expect(plan.warning.sections[0].fields).toEqual([
      { key: "ID", value: "agt_1" },
      { key: "Name", value: "Reviewer" },
      { key: "Slug", value: "reviewer" },
      { key: "Org", value: "acme" },
    ]);

    const result = await plan.perform();
    expect(result.status).toBe("success");
    expect(result.message).toBe("Agent deleted successfully");
    expect(result.sections[0].title).toBe("Deleted Agent");
    expect(result.sections[0].fields).toContainEqual({ key: "ID", value: "agt_1" });
  });

  it("resolves an agent by org/slug for the pre-Get", async () => {
    const plan = await planDelete(client, "agent", "reviewer", "acme");
    expect((await plan.perform()).status).toBe("success");
  });

  it("refuses agent-instance as a type the CLI does not know", async () => {
    // The kind is gone: a conversation names its agent directly.
    const err = await planDelete(client, "agent-instance", "reviewer-default", "acme").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
  });

  it("deletes an MCP server via the DeleteResourceInput shape", async () => {
    const plan = await planDelete(client, "mcpserver", "filesystem", "acme");
    const result = await plan.perform();
    expect(result.status).toBe("success");
    expect(result.message).toBe("MCP Server deleted successfully");
  });

  it("maps a NotFound on the pre-Get to ExitCode.NotFound", async () => {
    const err = await planDelete(client, "agent", "missing", "acme").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.NotFound);
  });

  it("deletes a schedule via its typed ID (tears down the Temporal artifact server-side)", async () => {
    const plan = await planDelete(client, "schedule", "daily-fee-reminders", "acme");
    const result = await plan.perform();
    expect(result.status).toBe("success");
    expect(result.message).toBe("Schedule deleted successfully");
    expect(scheduleDeleteIds).toEqual(["sch_1"]);
  });

  it("refuses workflow-instance as a type the CLI does not know", async () => {
    // The kind is gone: a run names its workflow directly.
    const err = await planDelete(client, "workflow-instance", "deploy-default", "acme").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
  });

  it("rejects an unknown type and lists exactly the wired types", async () => {
    const err = await planDelete(client, "bogus", "x", "acme").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
    // The list is derived from DELETE_HANDLERS (+ the two special cases), so
    // it must name the wired kinds and never the narrowed ones (#354).
    const message = String(err.message);
    for (const wired of [
      "environment",
      "agentchannel",
      "channelapp",
      "schedule",
      "execution",
      "organization",
    ]) {
      expect(message).toContain(wired);
    }
    expect(message).not.toContain("session");
    expect(message).not.toContain("oauthapp");
    expect(message).not.toContain("agentinstance");
    expect(message).not.toContain("workflowinstance");
  });

  it("rejects a narrowed kind at the verb gate with a usage error", async () => {
    // session's delete verb is narrowed out of the matrix
    // (stigmer/stigmer#354), so the refusal now happens at the verb-support
    // gate ("does not support") rather than the dispatch fall-through.
    const err = await planDelete(client, "session", "ses_1", "acme").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
    expect(String(err.message)).toContain("does not support");
  });
});

describe("delete (organization)", () => {
  it("says the organization is being deleted, removed in the background, and its name released after", async () => {
    const plan = await planDelete(client, "organization", "acme", "");
    expect(plan.warning.hints).toContain(
      "This will delete the organization and everything it owns.",
    );

    const result = await plan.perform();
    expect(organizationDeleteIds).toEqual([knownOrganization.metadata?.id]);
    expect(result.status).toBe("success");
    expect(result.message).toBe("Organization is being deleted");
    expect(result.sections[0].fields).toContainEqual({ key: "Slug", value: "acme" });
    expect(result.hints).toEqual([
      "It no longer answers any request, and everything it owned is being removed in the background.",
      "Its name 'acme' is released once the removal finishes.",
    ]);
  });
});

describe("delete (cutover kinds: environment, agent channel, channel app)", () => {
  it("deletes an environment via the DeleteResourceInput shape", async () => {
    const plan = await planDelete(client, "environment", "clinic-patient-db", "acme");
    const result = await plan.perform();

    expect(result.status).toBe("success");
    expect(result.message).toBe("Environment deleted successfully");
    expect(environmentDeletes).toEqual([{ resourceId: "env_1", force: false }]);
  });

  it("threads --force through the environment delete (generic ack carrier)", async () => {
    const plan = await planDelete(client, "environment", "clinic-patient-db", "acme", true);
    await plan.perform();
    expect(environmentDeletes).toEqual([{ resourceId: "env_1", force: true }]);
  });

  it("deletes an agent channel via its typed-ID contract, ignoring force gracefully", async () => {
    const plan = await planDelete(client, "agent-channel", "clinic-patient-whatsapp", "acme", true);

    // The teardown-vs-pause distinction rides the warning (server doc contract).
    expect(plan.warning.hints).toContain(
      "Delete is the connection's full teardown; to pause instead, apply with spec.enabled: false.",
    );

    const result = await plan.perform();
    expect(result.status).toBe("success");
    expect(result.message).toBe("Agent Channel deleted successfully");
    expect(channelDeleteIds).toEqual(["ach_1"]);
  });

  it("deletes a channel app via the DeleteResourceInput shape", async () => {
    const plan = await planDelete(client, "channel-app", "clinic-meta-app", "acme");
    const result = await plan.perform();

    expect(result.status).toBe("success");
    expect(result.message).toBe("Channel App deleted successfully");
    expect(channelAppDeletes).toEqual([{ resourceId: "chapp_1", force: false }]);
  });
});

describe("delete execution (cancel special case)", () => {
  it("cancels a non-terminal execution", async () => {
    const plan = await planDelete(client, "execution", "aex_run", "");
    expect(plan.confirmPrompt).toContain("cancellation");

    const result = await plan.perform();
    expect(result.status).toBe("success");
    expect(result.message).toBe("Execution cancelled successfully");
    expect(result.sections[0].fields).toContainEqual({ key: "Status", value: "cancelled" });
    expect(cancelCalls).toEqual(["aex_run"]);
  });

  it("reports an already-terminal execution without issuing a cancel", async () => {
    const plan = await planDelete(client, "execution", "aex_done", "");
    const result = await plan.perform();
    expect(result.status).toBe("warning");
    expect(result.message).toBe("Execution was already in terminal state");
    expect(result.sections[0].fields).toContainEqual({ key: "Status", value: "completed" });
    expect(cancelCalls).toEqual([]);
  });

  it("rejects a non-execution ID with a usage error", async () => {
    const err = await planDelete(client, "execution", "agt_1", "").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
  });
});

describe("tag (workflow and agent versions)", () => {
  it("tags a workflow version and truncates the hash in the message", async () => {
    const result = await tagVersion(client, "workflow", "acme/deploy", "abcdef1234567890", "stable", "acme");
    expect(result.status).toBe("success");
    expect(result.message).toBe("Tagged version abcdef123456 as 'stable'");
    expect(tagCalls).toEqual([{ workflowId: "wfl_1", versionHash: "abcdef1234567890", tag: "stable" }]);
  });

  it("uses the org context for a bare slug", async () => {
    await tagVersion(client, "wf", "deploy", "abc", "v1", "acme");
    expect(tagCalls[0]?.workflowId).toBe("wfl_1");
  });

  it("tags an agent version, resolving the agent by reference", async () => {
    const result = await tagVersion(client, "agent", "acme/reviewer", "abcdef1234567890", "stable", "acme");
    expect(result.message).toBe("Tagged version abcdef123456 as 'stable'");
    expect(agentTagCalls).toEqual([{ agentId: "agt_1", versionHash: "abcdef1234567890", tag: "stable" }]);
    expect(tagCalls).toEqual([]);
  });

  it("rejects unsupported resource types with a usage error naming the supported ones", async () => {
    const err = await tagVersion(client, "skill", "acme/x", "abc", "v1", "acme").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
    expect((err as Error).message).toContain("Supported types: workflow, agent");
  });
});
