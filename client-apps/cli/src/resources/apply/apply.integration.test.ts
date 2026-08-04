// In-process integration test for file-mode apply.
//
// The keystone assertion (the reason this wave drives the raw command
// controllers instead of the high-level SDK `apply(input)`): a resource carrying
// fields the SDK's lossy `*Input` would drop — notably `metadata.id`, which
// distinguishes an update from a create — must reach the backend intact. We
// apply an Agent YAML with an id set plus spec fields and assert the server
// received every one. Also covers dependency ordering, org injection, dry-run,
// and the created-vs-updated signal.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConnectRouter, createClient } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppCommandController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/command_pb";
import type { Datastore } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import { DatastoreCommandController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/command_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { createNodeTransport, normalizeEndpoint } from "@stigmer/sdk/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyItem, requiresOrgContext, resolveApplyItems } from "./apply.js";
import type { ControllerFn } from "./handlers.js";

let backend: Http2Server;
let controllerFn: ControllerFn;
const openSessions = new Set<ServerHttp2Session>();

let appliedAgents: Agent[] = [];
let appliedMcps: McpServer[] = [];
let appliedDatastores: Datastore[] = [];
let appliedChannelApps: ChannelApp[] = [];

beforeEach(() => {
  appliedAgents = [];
  appliedMcps = [];
  appliedDatastores = [];
  appliedChannelApps = [];
});

function writeYaml(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(AgentCommandController, {
      apply: (req) => {
        appliedAgents.push(req);
        return req; // echo back the full proto the server received
      },
    });
    router.service(McpServerCommandController, {
      apply: (req) => {
        appliedMcps.push(req);
        return req;
      },
    });
    router.service(DatastoreCommandController, {
      apply: (req) => {
        appliedDatastores.push(req);
        return req;
      },
    });
    router.service(ChannelAppCommandController, {
      apply: (req) => {
        appliedChannelApps.push(req);
        return req;
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
  const transport = createNodeTransport({ baseUrl: normalizeEndpoint(`127.0.0.1:${port}`) });
  controllerFn = (service) => createClient(service, transport);
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

const AGENT_WITH_ID = [
  "apiVersion: agentic.stigmer.ai/v1",
  "kind: Agent",
  "metadata:",
  "  id: agt_existing",
  "  name: Reviewer",
  "  slug: reviewer",
  "  org: acme",
  "spec:",
  "  description: A code reviewer",
  "  instructions: Review pull requests carefully",
  "",
].join("\n");

describe("file-mode apply — fidelity (raw controller preserves full proto)", () => {
  it("preserves metadata.id and spec fields the SDK input would drop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-it-"));
    try {
      writeYaml(dir, "agent.yaml", AGENT_WITH_ID);
      const items = resolveApplyItems(dir);
      expect(items).toHaveLength(1);

      const outcome = await applyItem(controllerFn, items[0], "acme", false);

      // The keystone: id (lossy in AgentInput) and spec round-trip intact.
      expect(appliedAgents).toHaveLength(1);
      expect(appliedAgents[0].metadata?.id).toBe("agt_existing");
      expect(appliedAgents[0].metadata?.slug).toBe("reviewer");
      expect(appliedAgents[0].spec?.description).toBe("A code reviewer");
      expect(appliedAgents[0].spec?.instructions).toBe("Review pull requests carefully");

      // id present → treated as an update.
      expect(outcome.result.status).toBe("success");
      expect(outcome.result.message).toBe("Agent updated successfully");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats a resource without metadata.id as a create", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-it-"));
    try {
      writeYaml(
        dir,
        "agent.yaml",
        ["kind: Agent", "metadata:", "  name: New", "  slug: new", "spec:", "  description: d", ""].join("\n"),
      );
      const items = resolveApplyItems(dir);
      const outcome = await applyItem(controllerFn, items[0], "acme", false);
      expect(outcome.result.message).toBe("Agent created successfully");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("injects the resolved org when the document omits it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-it-"));
    try {
      writeYaml(
        dir,
        "agent.yaml",
        ["kind: Agent", "metadata:", "  name: NoOrg", "  slug: no-org", "spec:", "  description: d", ""].join("\n"),
      );
      const items = resolveApplyItems(dir);
      await applyItem(controllerFn, items[0], "acme", false);
      expect(appliedAgents[0].metadata?.org).toBe("acme");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const DATASTORE_YAML = [
  "apiVersion: agentic.stigmer.ai/v1",
  "kind: Datastore",
  "metadata:",
  "  name: clinic-records",
  "  slug: clinic-records",
  "spec:",
  "  timezone: Asia/Kolkata",
  "  authorization:",
  "    roles:",
  "      - name: patient",
  "    default_role: patient",
  "  collections:",
  "    - name: bookings",
  "      fields:",
  "        - name: slot_start",
  "          type: timestamp",
  "          required: true",
  "      uniques:",
  "        - name: one_per_slot",
  "          fields: [slot_start]",
  '          message: "that slot is already booked"',
  "",
].join("\n");

describe("file-mode apply — datastore", () => {
  it("applies a Datastore through the raw controller with the spec intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-it-"));
    try {
      writeYaml(dir, "datastore.yaml", DATASTORE_YAML);
      const items = resolveApplyItems(dir);
      expect(items).toHaveLength(1);

      const outcome = await applyItem(controllerFn, items[0], "acme", false);
      expect(outcome.result.message).toBe("Datastore created successfully");

      expect(appliedDatastores).toHaveLength(1);
      const spec = appliedDatastores[0].spec;
      expect(spec?.timezone).toBe("Asia/Kolkata");
      expect(spec?.authorization?.defaultRole).toBe("patient");
      expect(spec?.collections[0]?.uniques[0]?.message).toBe("that slot is already booked");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sorts a Datastore before the Agent that references it", () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-it-"));
    try {
      writeYaml(dir, "agent.yaml", AGENT_WITH_ID);
      writeYaml(dir, "datastore.yaml", DATASTORE_YAML);
      const items = resolveApplyItems(dir);
      expect(items.map((i) => i.handler.displayName)).toEqual(["Datastore", "Agent"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The stigmer/stigmer#353 regression block: ChannelApp apply used to fail
// with "apply not implemented for Channel App" because the CLI's handler
// table was a drifted copy of the SDK manifest registry. The handlers now
// COME FROM that registry, so this suite pins the whole class: the kind
// applies, secrets round-trip verbatim, and the ordering the registry
// encodes (app before the channel that references it) is honored.
const CHANNEL_APP_YAML = [
  "apiVersion: agentic.stigmer.ai/v1",
  "kind: ChannelApp",
  "metadata:",
  "  name: demo-whatsapp",
  "  slug: demo-whatsapp",
  "spec:",
  "  whatsapp:",
  "    app_id: '108954'",
  "    app_secret: '***REDACTED***'",
  "    access_token: '***REDACTED***'",
  "    verify_token: '***REDACTED***'",
  "",
].join("\n");

const AGENT_CHANNEL_YAML = [
  "apiVersion: agentic.stigmer.ai/v1",
  "kind: AgentChannel",
  "metadata:",
  "  name: isc-whatsapp",
  "  slug: isc-whatsapp",
  "spec:",
  "  enabled: true",
  "  agent_ref: { kind: 40, org: acme, slug: clinic-assistant }",
  "  whatsapp: { phone_number_id: '106540352242922' }",
  "",
].join("\n");

const SCHEDULE_YAML = [
  "apiVersion: agentic.stigmer.ai/v1",
  "kind: Schedule",
  "metadata:",
  "  name: daily-fee-reminders",
  "  slug: daily-fee-reminders",
  "spec:",
  "  cron: '0 9 * * *'",
  "  time_zone: Asia/Kolkata",
  "  enabled: false",
  "  agent:",
  "    agent_ref: { kind: 40, org: acme, slug: clinic-assistant }",
  "    message: run the reminders",
  "",
].join("\n");

describe("file-mode apply — channel app (#353)", () => {
  it("applies a ChannelApp through the raw controller with the redaction markers intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-it-"));
    try {
      writeYaml(dir, "chapp.yaml", CHANNEL_APP_YAML);
      const items = resolveApplyItems(dir);
      expect(items).toHaveLength(1);

      const outcome = await applyItem(controllerFn, items[0], "acme", false);
      expect(outcome.result.message).toBe("Channel App created successfully");

      expect(appliedChannelApps).toHaveLength(1);
      const spec = appliedChannelApps[0].spec;
      expect(spec?.providerConfig.case).toBe("whatsapp");
      if (spec?.providerConfig.case !== "whatsapp") throw new Error("unreachable");
      expect(spec.providerConfig.value.appId).toBe("108954");
      // The redaction markers must reach the server verbatim — that is the
      // convention by which applying a fetched manifest preserves stored
      // secrets (verb-support's OAuthApp marker note).
      expect(spec.providerConfig.value.appSecret).toBe("***REDACTED***");
      expect(spec.providerConfig.value.accessToken).toBe("***REDACTED***");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats a ChannelApp carrying metadata.id as an update", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-it-"));
    try {
      writeYaml(
        dir,
        "chapp.yaml",
        CHANNEL_APP_YAML.replace("metadata:", "metadata:\n  id: chapp_existing"),
      );
      const items = resolveApplyItems(dir);
      const outcome = await applyItem(controllerFn, items[0], "acme", false);
      expect(outcome.result.message).toBe("Channel App updated successfully");
      expect(appliedChannelApps[0].metadata?.id).toBe("chapp_existing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("orders one bundle app → channel → schedule regardless of file order", () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-it-"));
    try {
      // File names chosen so lexical file order is exactly WRONG — before
      // the registry unification all three kinds fell to a shared default
      // priority and applied in this (broken) file order.
      writeYaml(dir, "a-schedule.yaml", SCHEDULE_YAML);
      writeYaml(dir, "b-channel.yaml", AGENT_CHANNEL_YAML);
      writeYaml(dir, "c-chapp.yaml", CHANNEL_APP_YAML);
      const items = resolveApplyItems(dir);
      expect(items.map((i) => i.handler.displayName)).toEqual(["Channel App", "Agent Channel", "Schedule"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("file-mode apply — project special case", () => {
  it("refuses a Project manifest with a pointer to the stigmer.yaml flow", () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-it-"));
    try {
      writeYaml(dir, "project.yaml", ["kind: Project", "metadata:", "  name: Demo", "  slug: demo", ""].join("\n"));
      expect(() => resolveApplyItems(dir)).toThrow(/stigmer\.yaml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("file-mode apply — orchestration", () => {
  it("sorts items into dependency order (mcp_server before agent)", () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-it-"));
    try {
      writeYaml(dir, "agent.yaml", AGENT_WITH_ID);
      writeYaml(
        dir,
        "mcp.yaml",
        ["kind: McpServer", "metadata:", "  name: fs", "  slug: fs", "spec:", "  stdio:", "    command: node", ""].join(
          "\n",
        ),
      );
      const items = resolveApplyItems(dir);
      expect(items.map((i) => i.handler.displayName)).toEqual(["MCP Server", "Agent"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requiresOrgContext is false for an Organization-only set", () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-it-"));
    try {
      writeYaml(dir, "org.yaml", ["kind: Organization", "metadata:", "  name: Acme", "  slug: acme", ""].join("\n"));
      const items = resolveApplyItems(dir);
      expect(requiresOrgContext(items)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-run previews without touching the backend", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-it-"));
    try {
      writeYaml(dir, "agent.yaml", AGENT_WITH_ID);
      const items = resolveApplyItems(dir);
      const before = appliedAgents.length;
      const outcome = await applyItem(controllerFn, items[0], "acme", true);
      expect(outcome.result.message).toBe("Dry run: Reviewer is valid");
      expect(appliedAgents.length).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unknown YAML fields under strict marshalling", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apply-it-"));
    try {
      writeYaml(
        dir,
        "agent.yaml",
        ["kind: Agent", "metadata:", "  name: Bad", "spec:", "  bogus_field: nope", ""].join("\n"),
      );
      const items = resolveApplyItems(dir);
      await expect(applyItem(controllerFn, items[0], "acme", false)).rejects.toThrow(/invalid Agent/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
