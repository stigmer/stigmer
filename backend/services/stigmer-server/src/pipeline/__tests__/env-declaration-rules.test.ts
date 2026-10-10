/**
 * Pins the message rule on an env declaration (vault/v1/declaration.proto,
 * env_var_declaration.secret_has_no_value): a declaration marked secret may
 * not carry a plain value, because a secret is found by its name in a vault
 * when a run starts and a value written into a blueprint would be readable
 * by everyone who can read the blueprint.
 *
 * The agent, the blueprint a client writes env on, is driven through the
 * REAL stack (a composed server on an ephemeral port, a native gRPC client
 * and the full interceptor chain): its spec.env refuses a secret with a
 * value as InvalidArgument carrying the rule's message, and accepts the two
 * shapes the rule leaves alone (a secret with no value, a plain setting with
 * one), so the refusal is the rule and not some other check on the same
 * create. A plugin's env is read from its archive at install, not written
 * by a client, so no create of it is driven here.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import { seedOrganizations } from "../../domain/organization/__tests__/support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";
const RULE_MESSAGE =
  "a secret declaration cannot carry a value: save the secret in a vault";

interface Declaration {
  readonly isSecret: boolean;
  readonly value?: string;
  readonly description?: string;
}

let dir: string;
let server: ComposedServer;
let agents: Client<typeof AgentCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "env-declaration-rules-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so the boot's non-fatal connect fails fast and never
      // touches a live local Temporal.
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  await seedOrganizations(transport, [ORG]);
  agents = createClient(AgentCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;

function agentInput(env: Record<string, Declaration>) {
  counter += 1;
  return {
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: { name: `Env Rule Agent ${counter}`, org: ORG },
    spec: {
      instructions: "You are an agent used by the env declaration tests.",
      env,
    },
  };
}

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

const SECRET_WITH_VALUE: Record<string, Declaration> = {
  API_TOKEN: { isSecret: true, value: "tok-123", description: "the API token" },
};
const SECRET_WITHOUT_VALUE: Record<string, Declaration> = {
  API_TOKEN: { isSecret: true, description: "the API token" },
};
const PLAIN_WITH_VALUE: Record<string, Declaration> = {
  WORKSPACE: { isSecret: false, value: "support" },
};

describe("env declaration: a secret carries no value", () => {
  it("refuses an agent whose env declares a secret with a value", async () => {
    const error = await grpcError(() =>
      agents.create(agentInput(SECRET_WITH_VALUE)),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toContain(RULE_MESSAGE);
  });

  it("accepts an agent with a secret that has no value and a plain setting that has one", async () => {
    const created = await agents.create(
      agentInput({ ...SECRET_WITHOUT_VALUE, ...PLAIN_WITH_VALUE }),
    );
    expect(created.spec?.env.API_TOKEN?.isSecret).toBe(true);
    expect(created.spec?.env.WORKSPACE?.value).toBe("support");
  });
});
