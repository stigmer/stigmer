/**
 * Pins RefuseLocalPrograms (refuse-local-programs.ts), session create's half
 * of the local-program rule, over a real SQLite store and the real
 * RequestContext:
 *   - a conversation whose target the policy refuses is refused, naming the
 *     plugin and the server, when the agent version it pins lists a plugin
 *     with a stdio server, and when the conversation lists one itself (the
 *     built-in assistant included);
 *   - the plugins read are the pinned version's, not the agent's head: a
 *     conversation pinned to a version without the local program passes
 *     even when the head carries one;
 *   - plugins whose servers are all URLs pass, and a plugin that is gone is
 *     left to the turn to refuse;
 *   - a target the policy keeps passes without reading the store at all,
 *     with the conversation's target as the policy's question.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import type { LocalProgramPolicy } from "../../run/local-programs.js";

import { newRefuseLocalProgramsStep } from "../refuse-local-programs.js";

const ORG = "acme";
const HEAD = "a".repeat(64);
const OLDER = "b".repeat(64);

/** Refuses local programs on a CLOUD target only, recording each question. */
function cloudRefusing(asked: ExecutionTarget[] = []): LocalProgramPolicy {
  return {
    refusesLocalPrograms: (target) => {
      asked.push(target);
      return target === ExecutionTarget.CLOUD;
    },
  };
}

let dir: string;
let store: Store;

async function savePlugin(slug: string, stdio: boolean): Promise<void> {
  await store.saveResource(
    ApiResourceKind.plugin,
    `plg_${slug}`,
    PluginSchema,
    create(PluginSchema, {
      metadata: { id: `plg_${slug}`, org: ORG, slug, name: slug },
      status: {
        digest: HEAD,
        mcpServers: [
          stdio
            ? { name: `${slug}-local`, transport: { case: "stdio", value: { command: "npx" } } }
            : { name: `${slug}-remote`, transport: { case: "http", value: { url: `https://${slug}.example/mcp` } } },
        ],
      },
    }),
  );
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "refuse-local-programs-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  await savePlugin("files", true);
  await savePlugin("linear", false);
  // The agent's head lists the local program; its older version lists only URLs.
  await store.saveResource(
    ApiResourceKind.agent,
    "agt_1",
    AgentSchema,
    create(AgentSchema, {
      metadata: { id: "agt_1", org: ORG, slug: "reviewer" },
      spec: { plugins: [{ org: ORG, slug: "files" }] },
      status: { versionHash: HEAD },
    }),
  );
  await store.saveAudit(
    ApiResourceKind.agent,
    "agt_1",
    AgentSchema,
    create(AgentSchema, {
      metadata: { id: "agt_1", org: ORG, slug: "reviewer" },
      spec: { plugins: [{ org: ORG, slug: "linear" }] },
      status: { versionHash: OLDER },
    }),
    OLDER,
    "v1",
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function conversation(
  executionTarget: ExecutionTarget,
  opts: { pinned?: string; plugins?: { org: string; slug: string }[] } = {},
): Session {
  return create(SessionSchema, {
    metadata: { id: "ses_1", org: ORG, slug: "chat" },
    spec: { plugins: opts.plugins ?? [], executionTarget },
    status: opts.pinned === undefined ? {} : { agentId: "agt_1", agentVersionHash: opts.pinned },
  });
}

async function run(session: Session, policy: LocalProgramPolicy, over: Store = store): Promise<void> {
  const ctx = new RequestContext(SessionSchema, session, testCallerIdentity(), ApiResourceKind.session);
  await newRefuseLocalProgramsStep(over, policy).execute(ctx);
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("RefuseLocalPrograms", () => {
  it("refuses a hosted conversation whose pinned agent version lists a local program, naming the plugin and the server", async () => {
    const error = await refusal(run(conversation(ExecutionTarget.CLOUD, { pinned: HEAD }), cloudRefusing()));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain("plugin 'files'");
    expect(error.rawMessage).toContain("'files-local'");
  });

  it("refuses a conversation that lists a local program itself, with no agent", async () => {
    const error = await refusal(
      run(conversation(ExecutionTarget.CLOUD, { plugins: [{ org: ORG, slug: "files" }] }), cloudRefusing()),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain("plugin 'files'");
  });

  it("reads the pinned version's plugins, not the agent's head", async () => {
    await expect(run(conversation(ExecutionTarget.CLOUD, { pinned: OLDER }), cloudRefusing())).resolves.toBeUndefined();
  });

  it("passes plugins whose servers are all URLs, and leaves a plugin that is gone to the turn", async () => {
    await expect(
      run(
        conversation(ExecutionTarget.CLOUD, {
          plugins: [{ org: ORG, slug: "linear" }, { org: ORG, slug: "no-such-plugin" }],
        }),
        cloudRefusing(),
      ),
    ).resolves.toBeUndefined();
  });

  it("passes a target the policy keeps without reading the store, asking about the conversation's own target", async () => {
    const untouchable = new Proxy(store, {
      get() {
        throw new Error("a kept target reads nothing");
      },
    });
    const asked: ExecutionTarget[] = [];
    await run(conversation(ExecutionTarget.LOCAL, { pinned: HEAD }), cloudRefusing(asked), untouchable);
    expect(asked).toEqual([ExecutionTarget.LOCAL]);
  });
});
