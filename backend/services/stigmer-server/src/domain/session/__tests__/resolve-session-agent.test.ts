/**
 * Pins ResolveSessionAgent (resolve-session-agent.ts), the rule that moves a
 * conversation's pin, over a real SQLite store and the real RequestContext,
 * with the agent ids the reference rule would have recorded:
 *   - a reference with no version pins the agent's current version;
 *   - `latest` pins the current version now, also over a stored pin, and is
 *     not stored: the reference keeps no version, so a later echo keeps the
 *     pin;
 *   - a tag and a content hash pin the version they name; a version the
 *     agent does not hold is FAILED_PRECONDITION naming it;
 *   - an update echoing the stored reference keeps the stored pin, even
 *     after the author saved or moved the tag it names; a changed reference
 *     does not;
 *   - no reference clears the pin (the built-in assistant);
 *   - an agent gone since the reference rule's scan is FAILED_PRECONDITION;
 *     a chain that ran without the recorded targets is Internal, and so is
 *     a failing read of the agent row;
 *   - a client-sent status never survives: the step writes both fields.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { LIST_INDEXES } from "../../../boot/list-indexes.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import {
  RESOLVED_REFERENCE_TARGETS_KEY,
  type ReferenceTargets,
} from "../../../pipeline/steps/references.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";

import { newResolveSessionAgentStep } from "../resolve-session-agent.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ORG = "org_01jz0000000000000000000000";
const HEAD = "a".repeat(64);
const OLDER = "b".repeat(64);

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "resolve-session-agent-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: LIST_INDEXES,
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** An agent at version HEAD whose earlier version OLDER carries the tag "v1". */
async function seedAgent(id: string, slug: string): Promise<void> {
  const agent = create(AgentSchema, {
    metadata: { id, org: ORG, slug },
    status: { versionHash: HEAD },
  });
  await store.saveResource(ApiResourceKind.agent, id, AgentSchema, agent);
  await store.saveAudit(
    ApiResourceKind.agent,
    id,
    AgentSchema,
    create(AgentSchema, {
      metadata: { id, org: ORG, slug },
      status: { versionHash: OLDER },
    }),
    OLDER,
    "v1",
  );
}

/** What ValidateReferences records: the ids its scan found, by org/slug. */
function targetsOf(ids: Record<string, string>): ReferenceTargets {
  return {
    idOf: (ref) => ids[`${ref.org}/${ref.slug}`],
    visibilityOf: () => undefined,
  };
}

function sessionNaming(
  slug: string,
  version = "",
  status?: { agentId: string; agentVersionHash: string },
): Session {
  return create(SessionSchema, {
    metadata: { id: "ses_1", org: ORG, slug: "chat" },
    spec:
      slug === ""
        ? {}
        : {
            agentRef: {
              kind: ApiResourceKind.agent,
              org: ORG,
              slug,
              version,
            },
          },
    status,
  });
}

async function pin(
  request: Session,
  options: {
    readonly stored?: Session;
    readonly targets?: ReferenceTargets;
    readonly store?: Store;
  } = {},
): Promise<Session> {
  const ctx = new RequestContext(
    SessionSchema,
    request,
    testCallerIdentity(),
    ApiResourceKind.session,
  );
  if (options.stored !== undefined) {
    ctx.set(EXISTING_RESOURCE_KEY, options.stored);
  }
  ctx.set(
    RESOLVED_REFERENCE_TARGETS_KEY,
    options.targets ?? targetsOf({ [`${ORG}/reviewer`]: "agt_1" }),
  );
  await newResolveSessionAgentStep(
    options.store ?? store,
    silentLogger,
  ).execute(ctx);
  return ctx.newState;
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the step to refuse");
}

describe("ResolveSessionAgent", () => {
  it("pins the agent's current version for a reference with no version", async () => {
    await seedAgent("agt_1", "reviewer");
    const session = await pin(sessionNaming("reviewer"));
    expect(session.status?.agentId).toBe("agt_1");
    expect(session.status?.agentVersionHash).toBe(HEAD);
  });

  it("pins the version a tag names", async () => {
    await seedAgent("agt_1", "reviewer");
    const session = await pin(sessionNaming("reviewer", "v1"));
    expect(session.status?.agentVersionHash).toBe(OLDER);
  });

  it("pins the version a content hash names", async () => {
    await seedAgent("agt_1", "reviewer");
    const session = await pin(sessionNaming("reviewer", OLDER));
    expect(session.status?.agentVersionHash).toBe(OLDER);
  });

  it("refuses a version the agent does not hold, naming it", async () => {
    await seedAgent("agt_1", "reviewer");
    const error = await refusal(pin(sessionNaming("reviewer", "v9")));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      `referenced agent '${ORG}/reviewer' has no version 'v9'; name one of its tags or content hashes, or 'latest' for its current version.`,
    );
  });

  it("keeps the stored pin when an update echoes the reference with no version", async () => {
    await seedAgent("agt_1", "reviewer");
    const stored = sessionNaming("reviewer", "", {
      agentId: "agt_1",
      agentVersionHash: OLDER,
    });
    // BuildUpdateState carries the stored status onto the merged state.
    const session = await pin(
      sessionNaming("reviewer", "", {
        agentId: "agt_1",
        agentVersionHash: OLDER,
      }),
      { stored },
    );
    expect(session.status?.agentVersionHash).toBe(OLDER);
  });

  it("moves a stored pin to the current version when the update names latest, and stores no version", async () => {
    await seedAgent("agt_1", "reviewer");
    const stored = sessionNaming("reviewer", "", {
      agentId: "agt_1",
      agentVersionHash: OLDER,
    });
    const session = await pin(sessionNaming("reviewer", "latest"), { stored });
    expect(session.status?.agentId).toBe("agt_1");
    expect(session.status?.agentVersionHash).toBe(HEAD);
    expect(session.spec?.agentRef?.version).toBe("");
  });

  it("keeps the pin when an update echoes a stored tag the author has since moved", async () => {
    await seedAgent("agt_1", "reviewer");
    // The session pinned "v1" when it named it; the tag now names HEAD's
    // audit row instead, but an echo names nothing new.
    await store.saveAudit(
      ApiResourceKind.agent,
      "agt_1",
      AgentSchema,
      create(AgentSchema, { metadata: { id: "agt_1", org: ORG } }),
      HEAD,
      "",
    );
    await store.setAuditTag(ApiResourceKind.agent, "agt_1", HEAD, "v1");
    const stored = sessionNaming("reviewer", "v1", {
      agentId: "agt_1",
      agentVersionHash: OLDER,
    });
    const session = await pin(
      sessionNaming("reviewer", "v1", {
        agentId: "agt_1",
        agentVersionHash: OLDER,
      }),
      { stored },
    );
    expect(session.status?.agentVersionHash).toBe(OLDER);
  });

  it("re-pins when an update names a different tag than the stored one", async () => {
    await seedAgent("agt_1", "reviewer");
    const stored = sessionNaming("reviewer", "", {
      agentId: "agt_1",
      agentVersionHash: HEAD,
    });
    const session = await pin(sessionNaming("reviewer", "v1"), { stored });
    expect(session.status?.agentVersionHash).toBe(OLDER);
  });

  it("pins the current version of an agent the update changes to", async () => {
    await seedAgent("agt_1", "reviewer");
    await seedAgent("agt_2", "writer");
    const stored = sessionNaming("reviewer", "", {
      agentId: "agt_1",
      agentVersionHash: OLDER,
    });
    const session = await pin(sessionNaming("writer"), {
      stored,
      targets: targetsOf({ [`${ORG}/writer`]: "agt_2" }),
    });
    expect(session.status?.agentId).toBe("agt_2");
    expect(session.status?.agentVersionHash).toBe(HEAD);
  });

  it("clears the pin when the write names no agent", async () => {
    const stored = sessionNaming("reviewer", "", {
      agentId: "agt_1",
      agentVersionHash: HEAD,
    });
    const session = await pin(
      sessionNaming("", "", { agentId: "agt_1", agentVersionHash: HEAD }),
      { stored },
    );
    expect(session.status?.agentId).toBe("");
    expect(session.status?.agentVersionHash).toBe("");
  });

  it("writes the resolved pin over a status the client sent", async () => {
    await seedAgent("agt_1", "reviewer");
    const session = await pin(
      sessionNaming("reviewer", "", {
        agentId: "agt_forged",
        agentVersionHash: OLDER,
      }),
    );
    expect(session.status?.agentId).toBe("agt_1");
    expect(session.status?.agentVersionHash).toBe(HEAD);
  });

  it("refuses an agent gone since the reference rule found it", async () => {
    const error = await refusal(pin(sessionNaming("reviewer")));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      `referenced agent '${ORG}/reviewer' no longer exists.`,
    );
  });

  it("fails Internal when the chain recorded no target for the reference", async () => {
    await seedAgent("agt_1", "reviewer");
    const error = await refusal(
      pin(sessionNaming("reviewer"), { targets: targetsOf({}) }),
    );
    expect(error.code).toBe(Code.Internal);
  });

  it("fails Internal when the agent row cannot be read", async () => {
    const failing: Store = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "getResource") {
          return () => Promise.reject(new Error("store is down"));
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const error = await refusal(
      pin(sessionNaming("reviewer"), { store: failing }),
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toContain(
      "failed to resolve the agent this conversation runs",
    );
  });
});
