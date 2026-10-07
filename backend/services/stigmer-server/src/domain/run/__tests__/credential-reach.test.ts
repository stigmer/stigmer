/**
 * Whose credentials a run reaches, end to end through the ExecutionContext
 * builder (create-execution-context-step.ts over domain/credential/
 * resolve.ts), over a real store holding several people's credentials in
 * one organization and the same people's credentials in another.
 *
 * Two members each save their own credential serving the same agent, the
 * same MCP server and the same git host; each member's run receives that
 * member's values and never the other's, whichever row the organization's
 * read answers first. A member with nothing of their own receives the
 * organization's key only when they may use it. A run with no person (a
 * schedule fire, a shared-link guest's, a channel's) receives no one's,
 * even when every member holds a value. A member's credentials saved in
 * another organization never reach a run here. The person is read from the
 * persisted run (a recover by someone else rebuilds the same answer:
 * lifecycle.test.ts).
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { CredentialTarget } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { CredentialTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSignIn } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { SecretService } from "../../../encryption/encryption.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { credentialListIndex } from "../../credential/list-index.js";
import { CredentialValues } from "../../credential/values.js";

import type { ExecutionContextBuilderDeps } from "../create-execution-context-step.js";
import { buildAndPersistExecutionContext } from "../create-execution-context-step.js";
import {
  CHANNEL_ID_LABEL_KEY,
  SHARE_ID_LABEL_KEY,
} from "../run-credentials.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ORG = "acme";
const ELSEWHERE = "globex";
const ANA = "acc_ana";
const BEN = "acc_ben";
const CAROL = "acc_carol";
const DEE = "acc_dee";

/** The organization's own search key, which Carol may use and Dee may not. */
const TEAM_SEARCH = `cred_team_search`;

let dir: string;
let store: Store;

const AGENT = create(CredentialTargetSchema, {
  target: {
    case: "agent",
    value: { kind: ApiResourceKind.agent, org: ORG, slug: "researcher" },
  },
});
const NOTES = create(CredentialTargetSchema, {
  target: {
    case: "mcpServer",
    value: { kind: ApiResourceKind.mcp_server, org: ORG, slug: "notes" },
  },
});
const GITHUB = create(CredentialTargetSchema, {
  target: { case: "gitHost", value: "github.com" },
});

async function saveCredential(init: {
  id: string;
  org?: string;
  owner: { person: string } | { org: string };
  fields: Record<string, string>;
  serves: CredentialTarget[];
}): Promise<void> {
  const org = init.org ?? ORG;
  await store.saveResource(
    ApiResourceKind.credential,
    init.id,
    CredentialSchema,
    create(CredentialSchema, {
      metadata: { id: init.id, org, slug: init.id },
      spec: {
        owner:
          "person" in init.owner
            ? { case: "person", value: init.owner.person }
            : { case: "org", value: init.owner.org },
        fields: Object.fromEntries(
          Object.entries(init.fields).map(([name, value]) => [
            name,
            { value, plain: true },
          ]),
        ),
        serves: init.serves,
      },
    }),
  );
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "run-credential-reach-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: [credentialListIndex],
  });
  await store.saveResource(
    ApiResourceKind.mcp_server,
    "mcps_notes",
    McpServerSchema,
    create(McpServerSchema, {
      metadata: { id: "mcps_notes", org: ORG, slug: "notes" },
      spec: {
        env: { NOTES_TOKEN: { isSecret: true, optional: true } },
        signIn: McpServerSignIn.personal,
      },
    }),
  );

  // Ben saved his first and Ana hers after; neither order may decide.
  await saveCredential({
    id: "cred_ben",
    owner: { person: BEN },
    fields: {
      SEARCH_KEY: "sk-ben",
      NOTES_TOKEN: "nt-ben",
      GITHUB_TOKEN: "ghp-ben",
    },
    serves: [AGENT, NOTES, GITHUB],
  });
  await saveCredential({
    id: "cred_ana",
    owner: { person: ANA },
    fields: {
      SEARCH_KEY: "sk-ana",
      NOTES_TOKEN: "nt-ana",
      GITHUB_TOKEN: "ghp-ana",
    },
    serves: [AGENT, NOTES, GITHUB],
  });
  // The organization's search key for the agent.
  await saveCredential({
    id: TEAM_SEARCH,
    owner: { org: ORG },
    fields: { SEARCH_KEY: "sk-team" },
    serves: [AGENT],
  });
  // Dee keeps her keys in another organization, naming this one's agent.
  await saveCredential({
    id: "cred_dee_elsewhere",
    org: ELSEWHERE,
    owner: { person: DEE },
    fields: {
      SEARCH_KEY: "sk-dee",
      NOTES_TOKEN: "nt-dee",
      GITHUB_TOKEN: "ghp-dee",
    },
    serves: [AGENT, NOTES, GITHUB],
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Carol may use the organization's search key; nobody else holds any grant. */
const authorizer: Authorizer = {
  authorize: async (caller, check) =>
    caller.identityId === CAROL && check.resourceId === TEAM_SEARCH
      ? { kind: "allow" }
      : { kind: "deny", reason: "not granted" },
};

function deps(createdEcs: ExecutionContext[]): ExecutionContextBuilderDeps {
  return {
    store,
    logger: silentLogger,
    agentLoader: () => ({
      get: async () =>
        create(AgentSchema, {
          metadata: { id: "agt_researcher", org: ORG, slug: "researcher" },
          spec: {
            env: { SEARCH_KEY: { isSecret: true, optional: true } },
            mcpServerUsages: [{ mcpServerRef: { org: ORG, slug: "notes" } }],
          },
        }),
      getVersion: async () => {
        throw new Error("this turn records no agent version");
      },
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: ORG },
          spec: {
            workspaceEntries: [
              {
                name: "app",
                source: {
                  source: {
                    case: "gitRepo",
                    value: { url: "https://github.com/acme/app" },
                  },
                },
              },
            ],
          },
        }),
    }),
    executionContextCreator: () => ({
      create: async (ec) => {
        createdEcs.push(ec);
        return ec;
      },
    }),
    executionContextDeleter: () => ({
      delete: () => Promise.reject(new Error("unused here")),
    }),
    credentials: {
      store,
      logger: silentLogger,
      authorizer,
      values: new CredentialValues(
        SecretService.create(randomBytes(32)),
        silentLogger,
      ),
      signIns: {
        freshen: async () => {
          throw new ConnectError("no sign-in in this suite", Code.Internal);
        },
      },
    },
    platformClients: {
      findById: async () => {
        throw new Error("no run here was created through a platform client");
      },
    },
  };
}

function run(
  id: string,
  person: string,
  labels: Record<string, string> = {},
): Run {
  return create(RunSchema, {
    metadata: { id, org: ORG, labels },
    spec: { target: { case: "sessionId", value: `ses_${id}` }, message: "hi" },
    status: { agentId: "agt_researcher", credentials: { person } },
  });
}

/** The values a run receives, as key → value. */
async function valuesOf(turn: Run): Promise<Record<string, string>> {
  const createdEcs: ExecutionContext[] = [];
  await buildAndPersistExecutionContext(deps(createdEcs), turn);
  expect(createdEcs).toHaveLength(1);
  return Object.fromEntries(
    Object.entries(createdEcs[0]?.spec?.data ?? {}).map(([key, value]) => [
      key,
      value.value,
    ]),
  );
}

describe("whose credentials a run reaches", () => {
  it("a member's run receives that member's own values, never a teammate's saved first", async () => {
    expect(await valuesOf(run("run_ana", ANA))).toEqual({
      SEARCH_KEY: "sk-ana",
      NOTES_TOKEN: "nt-ana",
      GITHUB_TOKEN: "ghp-ana",
    });
  });

  it("each member's run receives their own: the other member's run receives his", async () => {
    expect(await valuesOf(run("run_ben", BEN))).toEqual({
      SEARCH_KEY: "sk-ben",
      NOTES_TOKEN: "nt-ben",
      GITHUB_TOKEN: "ghp-ben",
    });
  });

  it("a member with nothing of their own receives the organization's key only when they may use it", async () => {
    expect(await valuesOf(run("run_carol", CAROL))).toEqual({
      SEARCH_KEY: "sk-team",
    });
  });

  it("a member's credentials in another organization never reach a run here", async () => {
    expect(await valuesOf(run("run_dee", DEE))).toEqual({});
  });

  it("a run with no person receives no one's: a schedule fire, a guest's, a channel's", async () => {
    expect(await valuesOf(run("run_fire", ""))).toEqual({});
    expect(
      await valuesOf(
        run("run_guest", "", { [SHARE_ID_LABEL_KEY]: "shr_gone" }),
      ),
    ).toEqual({});
    expect(
      await valuesOf(
        run("run_channel", "", { [CHANNEL_ID_LABEL_KEY]: "ach_gone" }),
      ),
    ).toEqual({});
  });
});
