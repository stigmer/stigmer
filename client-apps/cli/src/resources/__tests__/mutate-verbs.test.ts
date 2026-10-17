// In-process test for the mutating verbs (delete / tag).
//
// Stands up a real Connect backend over h2c serving the query *and* command
// controllers these verbs call, points an SDK node client at it, and drives the
// resource layer (planDelete → perform, tagVersion for agents) end to end. Asserts the
// rendered result shape, the special-case routing (run→cancel, which
// interrupts the run's session and names the turns it stopped;
// already-terminal), and that backend errors map to the right CLI exit code.

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { ChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/command_pb";
import { ChannelQueryController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/query_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppCommandController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/command_pb";
import { ChannelAppQueryController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/query_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { RoutineSchema } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineCommandController } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/command_pb";
import { RoutineQueryController } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/query_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
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

const knownVault = create(VaultSchema, {
  metadata: { name: "Clinic tools", slug: "clinic-tools", org: "acme", id: "vlt_1" },
});

const knownChannel = create(ChannelSchema, {
  metadata: { name: "clinic-patient-whatsapp", slug: "clinic-patient-whatsapp", org: "acme", id: "chn_1" },
});

const knownChannelApp = create(ChannelAppSchema, {
  metadata: { name: "clinic-meta-app", slug: "clinic-meta-app", org: "acme", id: "chapp_1" },
});

const knownRoutine = create(RoutineSchema, {
  metadata: { name: "daily-fee-reminders", slug: "daily-fee-reminders", org: "acme", id: "rtn_1" },
});

const knownPlugin = create(PluginSchema, {
  metadata: { name: "clinic-tools", slug: "clinic-tools", org: "acme", id: "plg_1" },
});

// Pending run (cancellable) vs. an already-terminal one.
const pendingExecution = create(RunSchema, {
  metadata: { id: "aex_run" },
  spec: { target: { case: "sessionId", value: "ses_run" } },
  status: { phase: RunPhase.RUN_PENDING },
});
const cancelledExecution = create(RunSchema, {
  metadata: { id: "aex_run" },
  status: { phase: RunPhase.RUN_CANCELLED },
});
const completedExecution = create(RunSchema, {
  metadata: { id: "aex_done" },
  status: { phase: RunPhase.RUN_COMPLETED },
});

let backend: Http2Server;
let client: Stigmer;
const openSessions = new Set<ServerHttp2Session>();

// Spies for the command-side calls, reset per test: the sessions interrupted.
let cancelCalls: string[] = [];
let agentTagCalls: { agentId: string; versionHash: string; tag: string }[] = [];
// Force-carrying deletes record what actually rode the RPC.
let vaultDeletes: { resourceId: string; force: boolean }[] = [];
let channelAppDeletes: { resourceId: string; force: boolean }[] = [];
// channel and routine delete by typed ID — no force field exists on
// their wire contracts.
let channelDeleteIds: string[] = [];
let routineDeleteIds: string[] = [];

beforeEach(() => {
  cancelCalls = [];
  agentTagCalls = [];
  vaultDeletes = [];
  channelAppDeletes = [];
  channelDeleteIds = [];
  routineDeleteIds = [];
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

    router.service(VaultQueryController, {
      getByReference: (req) => {
        if (req.slug !== "clinic-tools") throw new ConnectError("vault not found", Code.NotFound);
        return knownVault;
      },
    });
    router.service(VaultCommandController, {
      delete: (req) => {
        vaultDeletes.push({ resourceId: req.resourceId, force: req.force });
        return knownVault;
      },
    });

    router.service(ChannelQueryController, {
      getByReference: (req) => {
        if (req.slug !== "clinic-patient-whatsapp") throw new ConnectError("channel not found", Code.NotFound);
        return knownChannel;
      },
    });
    router.service(ChannelCommandController, {
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

    router.service(RoutineQueryController, {
      getByReference: (req) => {
        if (req.slug !== "daily-fee-reminders") throw new ConnectError("routine not found", Code.NotFound);
        return knownRoutine;
      },
    });
    router.service(RoutineCommandController, {
      delete: (req) => {
        routineDeleteIds.push(req.value);
        return knownRoutine;
      },
    });

    router.service(PluginQueryController, {
      getByReference: (req) => {
        if (req.slug !== "clinic-tools") throw new ConnectError("plugin not found", Code.NotFound);
        return knownPlugin;
      },
    });

    router.service(OrganizationQueryController, {
      get: (req) => {
        if (req.value !== knownOrganization.metadata?.id) {
          throw new ConnectError("organization not found", Code.NotFound);
        }
        return knownOrganization;
      },
      listMine: () => ({ entries: [knownOrganization] }),
    });
    router.service(OrganizationCommandController, {
      delete: (req) => {
        organizationDeleteIds.push(req.value);
        return knownOrganization;
      },
    });

    router.service(RunQueryController, {
      get: (req) => {
        if (req.value === "aex_done") return completedExecution;
        if (req.value === "aex_run" || req.value === "run_current") {
          return cancelCalls.length > 0 ? cancelledExecution : pendingExecution;
        }
        throw new ConnectError("execution not found", Code.NotFound);
      },
    });
    router.service(SessionCommandController, {
      interrupt: (req) => {
        cancelCalls.push(req.sessionId);
        return { stoppedRunIds: ["aex_run", "aex_other"] };
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

  it("maps a NotFound on the pre-Get to ExitCode.NotFound", async () => {
    const err = await planDelete(client, "agent", "missing", "acme").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.NotFound);
  });

  it("deletes a routine via its typed ID (tears down the Temporal artifact server-side)", async () => {
    const plan = await planDelete(client, "routine", "daily-fee-reminders", "acme");
    const result = await plan.perform();
    expect(result.status).toBe("success");
    expect(result.message).toBe("Routine deleted successfully");
    expect(routineDeleteIds).toEqual(["rtn_1"]);
  });

  it("refuses workflow-instance as a type the CLI does not know", async () => {
    // The kind is gone: a run starts on an agent.
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
      "vault",
      "channel",
      "channelapp",
      "routine",
      "run",
      "organization",
    ]) {
      expect(message).toContain(wired);
    }
    expect(message).not.toContain("session");
    expect(message).not.toContain("oauthapp");
    expect(message).not.toContain("agentinstance");
    expect(message).not.toContain("workflowinstance");
    expect(message).not.toContain("environment");
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

describe("delete (plugin)", () => {
  it("warns that it removes the plugin with what it carries, and is refused while an agent lists it", async () => {
    const plan = await planDelete(client, "plugin", "clinic-tools", "acme");
    expect(plan.warning.hints).toContain(
      "This removes the plugin with its skills, agents and MCP servers. " +
        "It is refused while an agent of the organization lists it.",
    );
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

describe("delete (cutover kinds: vault, channel, channel app)", () => {
  it("deletes a vault via the DeleteResourceInput shape", async () => {
    const plan = await planDelete(client, "vault", "clinic-tools", "acme");
    const result = await plan.perform();

    expect(result.status).toBe("success");
    expect(result.message).toBe("Vault deleted successfully");
    expect(vaultDeletes).toEqual([{ resourceId: "vlt_1", force: false }]);
  });

  it("threads --force through the vault delete (generic ack carrier)", async () => {
    const plan = await planDelete(client, "vault", "clinic-tools", "acme", true);
    await plan.perform();
    expect(vaultDeletes).toEqual([{ resourceId: "vlt_1", force: true }]);
  });

  it("deletes a channel via its typed-ID contract, ignoring force gracefully", async () => {
    const plan = await planDelete(client, "channel", "clinic-patient-whatsapp", "acme", true);

    // The teardown-vs-pause distinction rides the warning (server doc contract).
    expect(plan.warning.hints).toContain(
      "Delete is the connection's full teardown; to pause instead: stigmer channel disable <channel>",
    );

    const result = await plan.perform();
    expect(result.status).toBe("success");
    expect(result.message).toBe("Channel deleted successfully");
    expect(channelDeleteIds).toEqual(["chn_1"]);
  });

  it("deletes a channel app via the DeleteResourceInput shape", async () => {
    const plan = await planDelete(client, "channel-app", "clinic-meta-app", "acme");
    const result = await plan.perform();

    expect(result.status).toBe("success");
    expect(result.message).toBe("Channel App deleted successfully");
    expect(channelAppDeletes).toEqual([{ resourceId: "chapp_1", force: false }]);
  });
});

describe("delete run (cancel special case)", () => {
  it("cancels a non-terminal run", async () => {
    const plan = await planDelete(client, "run", "aex_run", "");
    expect(plan.confirmPrompt).toContain("cancellation");

    const result = await plan.perform();
    expect(result.status).toBe("success");
    expect(result.message).toBe("Run cancelled successfully");
    expect(result.sections[0].fields).toContainEqual({ key: "Status", value: "cancelled" });
    expect(result.sections[0].fields).toContainEqual({ key: "Stopped", value: "aex_run, aex_other" });
    expect(cancelCalls).toEqual(["ses_run"]);
  });

  it("reports an already-terminal run without issuing a cancel", async () => {
    const plan = await planDelete(client, "run", "aex_done", "");
    const result = await plan.perform();
    expect(result.status).toBe("warning");
    expect(result.message).toBe("Run was already in terminal state");
    expect(result.sections[0].fields).toContainEqual({ key: "Status", value: "completed" });
    expect(cancelCalls).toEqual([]);
  });

  it("cancels a run by its current id prefix too", async () => {
    const plan = await planDelete(client, "run", "run_current", "");
    await plan.perform();
    expect(cancelCalls).toEqual(["ses_run"]);
  });

  it("rejects a non-run ID with a usage error", async () => {
    const err = await planDelete(client, "run", "agt_1", "").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
  });
});

describe("tag (agent versions)", () => {
  it("tags an agent version, resolving the agent by reference, and truncates the hash in the message", async () => {
    const result = await tagVersion(client, "agent", "acme/reviewer", "abcdef1234567890", "stable", "acme");
    expect(result.status).toBe("success");
    expect(result.message).toBe("Tagged version abcdef123456 as 'stable'");
    expect(agentTagCalls).toEqual([{ agentId: "agt_1", versionHash: "abcdef1234567890", tag: "stable" }]);
  });

  it("uses the org context for a bare slug", async () => {
    await tagVersion(client, "agent", "reviewer", "abc", "v1", "acme");
    expect(agentTagCalls[0]?.agentId).toBe("agt_1");
  });

  it("rejects unsupported resource types with a usage error naming the supported ones", async () => {
    const err = await tagVersion(client, "skill", "acme/x", "abc", "v1", "acme").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
    expect((err as Error).message).toContain("Supported types: agent");
  });
});
