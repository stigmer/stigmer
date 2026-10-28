/**
 * Pins which Environment a conversation runs in
 * (../resolve-session-environment.ts), the session create's admission of it
 * (../admit-session-environment.ts), and their wiring in the session chains
 * (../controller.ts).
 *
 * Over a real SQLite store and the real RequestContext:
 *   - under a governing policy the order is the conversation's own
 *     spec.environment_ref (source session, or routine when status.routine_id
 *     is set), then its agent's default at the PINNED version (not the
 *     head), then the organization's preferences.default_environment_ref,
 *     else none; the stamp is held by id in the conversation's organization;
 *   - without a governing policy the agent's and organization's defaults
 *     are ignored, and a conversation naming its own Environment is refused
 *     with LOCAL_ENVIRONMENT_MESSAGE;
 *   - ResolveSessionEnvironment re-resolves until the conversation has run
 *     (a run row in it, ../has-run.ts), then keeps the stored stamp and
 *     source; ValidateEnvironmentImmutability refuses a changed or dropped
 *     spec.environment_ref once it has run, and passes before it and for an
 *     echo;
 *   - AdmitSessionEnvironment reads the pinned agent tree and refuses an
 *     unlisted MCP host of a limited Environment, and reads nothing for a
 *     conversation with no Environment.
 *
 * Through a composed server under the require-authentication posture (the
 * built-in evaluator) with a sandbox lane whose driver supports both, with
 * Carol, the founder (an admin), and Dave, a member:
 *   - a hosted conversation naming no Environment records the
 *     organization's default (source organization), and one whose agent
 *     names a default records the agent's (source agent);
 *   - a conversation on the person's own machine (LOCAL) records none, and
 *     one naming its own Environment there is refused with
 *     LOCAL_ENVIRONMENT_MESSAGE;
 *   - Dave may name an organization-visible Environment (source session),
 *     and may not name Carol's private one (PERMISSION_DENIED: the
 *     reference rule's writer clause);
 *   - session create refuses an agent default whose MCP server's host the
 *     limited Environment does not list;
 *   - once a turn has run, an update naming another Environment is refused;
 *   - a conversation with no organization takes no organization default, and
 *     a store that cannot read the organization answers INTERNAL.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/command_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { EnvironmentSource, ExecutionTarget } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { IdentityAccountCommandController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationPreferencesSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/spec_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import { errorOf, testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";
import { FAKE_SANDBOX_DRIVER, environmentInput, sandboxUnit } from "../../environment/__tests__/support.js";
import { LOCAL_ENVIRONMENT_MESSAGE, unlistedMcpHostMessage } from "../../run/environment-admission.js";
import { agentExecutionListIndex } from "../../run/list-index.js";
import type { EnvironmentPolicy } from "../../run/environment-admission.js";
import { newAdmitSessionEnvironmentStep } from "../admit-session-environment.js";
import {
  newResolveSessionEnvironmentStep,
  newValidateEnvironmentImmutabilityStep,
  resolveSessionEnvironment,
} from "../resolve-session-environment.js";

const IMMUTABLE_MESSAGE =
  "a conversation's environment cannot be changed after its first turn: start a new conversation to use another";

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

describe("resolveSessionEnvironment and its steps, over a real store", () => {
  const ORG = "org_1";
  const BARE_ORG = "org_bare";
  const HEAD = "a".repeat(64);
  const OLDER = "b".repeat(64);

  const GOVERNING: EnvironmentPolicy = {
    governs: (target) => target === ExecutionTarget.CLOUD,
    support: { limitedNetworking: true, packages: true },
  };

  let dir: string;
  let store: Store;

  function ref(id: string) {
    return { kind: ApiResourceKind.environment, org: ORG, id };
  }

  /** The session that has run: a run row in it, the fact the locks read. */
  const RUN_SESSION = "ses_run";
  /** The session that has not. */
  const FRESH_SESSION = "ses_fresh";

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "resolve-session-environment-test-"));
    store = namingSaves(SqliteStore.open(path.join(dir, "stigmer.db"), undefined, { listIndexes: [agentExecutionListIndex] }));
    await store.saveResource(
      ApiResourceKind.run,
      "run_1",
      RunSchema,
      create(RunSchema, {
        metadata: { id: "run_1", org: ORG },
        spec: { target: { case: "sessionId", value: RUN_SESSION } },
      }),
    );
    await store.saveResource(
      ApiResourceKind.organization,
      ORG,
      OrganizationSchema,
      create(OrganizationSchema, {
        metadata: { id: ORG, slug: "acme" },
        spec: { preferences: { defaultEnvironmentRef: ref("env_01org") } },
      }),
    );
    await store.saveResource(
      ApiResourceKind.organization,
      BARE_ORG,
      OrganizationSchema,
      create(OrganizationSchema, { metadata: { id: BARE_ORG, slug: "bare" } }),
    );
    // The agent's head names one default; the version a conversation pinned names another.
    await store.saveResource(
      ApiResourceKind.agent,
      "agt_1",
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: "agt_1", org: ORG, slug: "reviewer" },
        spec: { environmentRef: ref("env_01head") },
        status: { versionHash: HEAD },
      }),
    );
    await store.saveAudit(
      ApiResourceKind.agent,
      "agt_1",
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: "agt_1", org: ORG, slug: "reviewer" },
        spec: {
          environmentRef: ref("env_01pinned"),
          mcpServers: [{ name: "search", url: "https://search.example.org/mcp" }],
        },
        status: { versionHash: OLDER },
      }),
      OLDER,
      "v1",
    );
    await store.saveResource(
      ApiResourceKind.agent,
      "agt_plain",
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: "agt_plain", org: ORG, slug: "plain" },
        status: { versionHash: HEAD },
      }),
    );
    await store.saveResource(
      ApiResourceKind.environment,
      "env_01fenced",
      EnvironmentSchema,
      create(EnvironmentSchema, {
        metadata: { id: "env_01fenced", org: ORG, slug: "fenced" },
        spec: { networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com"] } },
      }),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function conversation(opts: {
    org?: string;
    target?: ExecutionTarget;
    own?: MessageInitShape<typeof ApiResourceReferenceSchema>;
    agentId?: string;
    pinned?: string;
    routineId?: string;
  }): Session {
    return create(SessionSchema, {
      metadata: { id: "ses_1", org: opts.org ?? ORG, slug: "chat" },
      spec: {
        executionTarget: opts.target ?? ExecutionTarget.CLOUD,
        ...(opts.own === undefined ? {} : { environmentRef: opts.own }),
      },
      status: {
        agentId: opts.agentId ?? "",
        agentVersionHash: opts.pinned ?? "",
        routineId: opts.routineId ?? "",
      },
    });
  }

  describe("under a governing policy", () => {
    it("takes the conversation's own choice first, stamped by id in its organization, source session", async () => {
      const resolved = await resolveSessionEnvironment(
        store,
        GOVERNING,
        conversation({ own: { id: "env_01own" }, agentId: "agt_1", pinned: OLDER }),
      );
      expect(resolved?.source).toBe(EnvironmentSource.SESSION);
      expect(resolved?.ref).toEqual(
        create(ApiResourceReferenceSchema, { kind: ApiResourceKind.environment, org: ORG, id: "env_01own" }),
      );
    });

    it("records a routine's choice as source routine when the conversation was made by a routine's fire", async () => {
      const resolved = await resolveSessionEnvironment(
        store,
        GOVERNING,
        conversation({ own: { id: "env_01routine" }, routineId: "rtn_01daily" }),
      );
      expect(resolved?.source).toBe(EnvironmentSource.ROUTINE);
      expect(resolved?.ref.id).toBe("env_01routine");
    });

    it("then the agent's default at the version the conversation pinned, not the agent's head", async () => {
      const pinned = await resolveSessionEnvironment(store, GOVERNING, conversation({ agentId: "agt_1", pinned: OLDER }));
      expect(pinned?.source).toBe(EnvironmentSource.AGENT);
      expect(pinned?.ref.id).toBe("env_01pinned");
      const head = await resolveSessionEnvironment(store, GOVERNING, conversation({ agentId: "agt_1", pinned: HEAD }));
      expect(head?.ref.id).toBe("env_01head");
    });

    it("then the organization's default", async () => {
      const resolved = await resolveSessionEnvironment(
        store,
        GOVERNING,
        conversation({ agentId: "agt_plain", pinned: HEAD }),
      );
      expect(resolved?.source).toBe(EnvironmentSource.ORGANIZATION);
      expect(resolved?.ref.id).toBe("env_01org");
      const assistant = await resolveSessionEnvironment(store, GOVERNING, conversation({}));
      expect(assistant?.source).toBe(EnvironmentSource.ORGANIZATION);
    });

    it("else none", async () => {
      expect(await resolveSessionEnvironment(store, GOVERNING, conversation({ org: BARE_ORG }))).toBeUndefined();
      expect(await resolveSessionEnvironment(store, GOVERNING, conversation({ org: "org_missing" }))).toBeUndefined();
      expect(await resolveSessionEnvironment(store, GOVERNING, conversation({ org: "" }))).toBeUndefined();
    });

    it("answers INTERNAL when the store cannot read the organization's default", async () => {
      const faulty = Object.assign(Object.create(store) as Store, {
        getResource: async () => Promise.reject(new Error("disk unreadable")),
      });
      const failed = await errorOf(() => resolveSessionEnvironment(faulty, GOVERNING, conversation({})));
      expect(failed.code).toBe(Code.Internal);
      expect(failed.rawMessage).toBe("failed to read the organization's default environment");
    });
  });

  describe("without a governing policy", () => {
    it("ignores the agent's and the organization's defaults", async () => {
      expect(
        await resolveSessionEnvironment(
          store,
          GOVERNING,
          conversation({ target: ExecutionTarget.LOCAL, agentId: "agt_1", pinned: OLDER }),
        ),
      ).toBeUndefined();
      expect(
        await resolveSessionEnvironment(store, { ...GOVERNING, governs: () => false }, conversation({})),
      ).toBeUndefined();
    });

    it("refuses a conversation that names its own Environment", async () => {
      for (const own of [{ id: "env_01own" }, { slug: "box" }]) {
        const error = await refusal(
          resolveSessionEnvironment(store, GOVERNING, conversation({ target: ExecutionTarget.LOCAL, own })),
        );
        expect(error.code).toBe(Code.FailedPrecondition);
        expect(error.rawMessage).toBe(LOCAL_ENVIRONMENT_MESSAGE);
      }
    });
  });

  describe("ResolveSessionEnvironment", () => {
    function stored(sessionId: string): Session {
      return create(SessionSchema, {
        metadata: { id: sessionId, org: ORG },
        spec: { executionTarget: ExecutionTarget.CLOUD, environmentRef: ref("env_01first") },
        status: {
          environment: ref("env_01first"),
          environmentSource: EnvironmentSource.SESSION,
        },
      });
    }

    async function resolveOver(existing: Session | undefined, next: Session): Promise<Session> {
      const ctx = new RequestContext(SessionSchema, next, testCallerIdentity(), ApiResourceKind.session);
      if (existing !== undefined) {
        ctx.set(EXISTING_RESOURCE_KEY, existing);
      }
      await newResolveSessionEnvironmentStep(store, GOVERNING).execute(ctx);
      return ctx.newState;
    }

    it("keeps the stamp once the conversation has run, whatever the write names", async () => {
      const kept = await resolveOver(stored(RUN_SESSION), conversation({ own: { id: "env_01other" } }));
      expect(kept.status?.environment?.id).toBe("env_01first");
      expect(kept.status?.environmentSource).toBe(EnvironmentSource.SESSION);
    });

    it("re-resolves on every write before the conversation has run, and on create", async () => {
      const before = await resolveOver(stored(FRESH_SESSION), conversation({ agentId: "agt_plain", pinned: HEAD }));
      expect(before.status?.environment?.id).toBe("env_01org");
      expect(before.status?.environmentSource).toBe(EnvironmentSource.ORGANIZATION);
      const created = await resolveOver(undefined, conversation({ org: BARE_ORG }));
      expect(created.status?.environment).toBeUndefined();
      expect(created.status?.environmentSource).toBe(EnvironmentSource.UNSPECIFIED);
    });
  });

  describe("ValidateEnvironmentImmutability", () => {
    async function run(storedRef: string, sessionId: string, nextRef: string | undefined): Promise<void> {
      const existing = create(SessionSchema, {
        metadata: { id: sessionId, org: ORG },
        spec: { environmentRef: ref(storedRef) },
      });
      const ctx = new RequestContext(
        SessionSchema,
        create(SessionSchema, {
          metadata: { id: sessionId, org: ORG },
          spec: nextRef === undefined ? {} : { environmentRef: ref(nextRef) },
        }),
        testCallerIdentity(),
        ApiResourceKind.session,
      );
      ctx.set(EXISTING_RESOURCE_KEY, existing);
      await newValidateEnvironmentImmutabilityStep(store).execute(ctx);
    }

    async function refusalOf(call: () => Promise<void>): Promise<ConnectError> {
      try {
        await call();
      } catch (error) {
        if (error instanceof ConnectError) {
          return error;
        }
        throw error;
      }
      throw new Error("expected a refusal");
    }

    it("refuses another Environment, or dropping it, once the conversation has run", async () => {
      for (const next of ["env_01second", undefined]) {
        const error = await refusalOf(() => run("env_01first", RUN_SESSION, next));
        expect(error.code).toBe(Code.FailedPrecondition);
        expect(error.rawMessage).toBe(IMMUTABLE_MESSAGE);
      }
    });

    it("passes an echo, and any change before the conversation has run", async () => {
      await expect(run("env_01first", RUN_SESSION, "env_01first")).resolves.toBeUndefined();
      await expect(run("env_01first", FRESH_SESSION, "env_01second")).resolves.toBeUndefined();
      await expect(run("env_01first", FRESH_SESSION, undefined)).resolves.toBeUndefined();
    });
  });

  describe("AdmitSessionEnvironment", () => {
    async function admit(session: Session, over: Store = store): Promise<void> {
      const ctx = new RequestContext(SessionSchema, session, testCallerIdentity(), ApiResourceKind.session);
      await newAdmitSessionEnvironmentStep(over, GOVERNING).execute(ctx);
    }

    it("refuses an MCP server of the pinned agent whose host the limited Environment does not list", async () => {
      const session = conversation({ agentId: "agt_1", pinned: OLDER });
      session.status!.environment = create(ApiResourceReferenceSchema, ref("env_01fenced"));
      session.status!.environmentSource = EnvironmentSource.AGENT;
      const error = await refusal(admit(session));
      expect(error.code).toBe(Code.FailedPrecondition);
      expect(error.rawMessage).toBe(unlistedMcpHostMessage("fenced", "search", "search.example.org"));
      // The head lists no server: a conversation pinned to it passes.
      const atHead = conversation({ agentId: "agt_1", pinned: HEAD });
      atHead.status!.environment = create(ApiResourceReferenceSchema, ref("env_01fenced"));
      await expect(admit(atHead)).resolves.toBeUndefined();
    });

    it("reads nothing for a conversation with no Environment", async () => {
      const untouchable = new Proxy(store, {
        get() {
          throw new Error("a conversation with no Environment reads nothing");
        },
      });
      await expect(admit(conversation({ agentId: "agt_1", pinned: OLDER }), untouchable)).resolves.toBeUndefined();
    });
  });
});

describe("the session chains' Environment, composed under an authentication posture with a sandbox lane", () => {
  const CAROL = "fake|session-env-carol";
  const DAVE = "fake|session-env-dave";
  const ORG = "session-env-org";
  const API_VERSION = "agentic.stigmer.ai/v1";
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let orgId: string;
  let orgBox: Environment;
  let carolsBox: Environment;
  let agentBox: Environment;
  let fenced: Environment;

  const asCarol = (): Transport => transportFor(port, fakeJwt(CAROL, "carol@example.com"));
  const asDave = (): Transport => transportFor(port, fakeJwt(DAVE, "dave@example.com"));

  let sessionCounter = 0;
  function sessionInput(spec: MessageInitShape<typeof SessionSpecSchema>): Session {
    sessionCounter += 1;
    return create(SessionSchema, {
      apiVersion: API_VERSION,
      kind: "Session",
      metadata: { name: `Environment session ${sessionCounter}`, org: ORG },
      spec,
    });
  }

  function environmentRef(slug: string) {
    return { kind: ApiResourceKind.environment, org: ORG, slug };
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "session-environment-composed-"));
    vi.stubEnv("STIGMER_ACTIVITY_ROUTING", "session");
    server = await composeServer({
      config: loadConfig({ ...baseConfig(dir), SANDBOX_PROVISIONER_TYPE: FAKE_SANDBOX_DRIVER }),
      logger: silentLogger,
      extensions: [
        sandboxUnit(
          { limitedNetworking: true, packages: true },
          { requireAuthentication: true, identityVerifiers: [fakeVerifier] },
        ),
      ],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
    await createClient(IdentityAccountCommandController, asCarol()).provisionMyAccount({});
    const org = await createClient(OrganizationCommandController, asCarol()).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: ORG, slug: ORG, org: "" },
      spec: { description: ORG },
    });
    orgId = org.metadata!.id;
    await createClient(IdentityAccountCommandController, asDave()).provisionMyAccount({});

    const environments = createClient(EnvironmentCommandController, asCarol());
    orgBox = await environments.create(environmentInput(ORG, "Org Box"));
    carolsBox = await environments.create(
      environmentInput(ORG, "Carols Box", {}, ApiResourceVisibility.visibility_private),
    );
    agentBox = await environments.create(environmentInput(ORG, "Agent Box"));
    fenced = await environments.create(
      environmentInput(ORG, "Fenced", {
        networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com"] },
      }),
    );
    // The organization's default, written as its preferences hold it.
    const stored = await server.store.getResource(ApiResourceKind.organization, orgId, OrganizationSchema);
    const preferences = (stored.spec!.preferences ??= create(OrganizationPreferencesSchema));
    preferences.defaultEnvironmentRef = create(ApiResourceReferenceSchema, {
      kind: ApiResourceKind.environment,
      org: orgId,
      id: orgBox.metadata!.id,
    });
    await server.store.saveResource(ApiResourceKind.organization, orgId, OrganizationSchema, stored);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records the organization's default for a hosted conversation that names none", async () => {
    const session = await createClient(SessionCommandController, asCarol()).create(
      sessionInput({ executionTarget: ExecutionTarget.CLOUD }),
    );
    expect(session.status?.environment?.id).toBe(orgBox.metadata!.id);
    expect(session.status?.environmentSource).toBe(EnvironmentSource.ORGANIZATION);
    expect(session.spec?.environmentRef).toBeUndefined();
  });

  it("records the agent's default ahead of the organization's", async () => {
    await createClient(AgentCommandController, asCarol()).create({
      apiVersion: API_VERSION,
      kind: "Agent",
      metadata: { name: "Boxed Agent", org: ORG },
      spec: { instructions: "You answer in a box.", environmentRef: environmentRef("agent-box") },
    });
    const session = await createClient(SessionCommandController, asCarol()).create(
      sessionInput({
        executionTarget: ExecutionTarget.CLOUD,
        agentRef: { kind: ApiResourceKind.agent, org: ORG, slug: "boxed-agent" },
      }),
    );
    expect(session.status?.environment?.id).toBe(agentBox.metadata!.id);
    expect(session.status?.environmentSource).toBe(EnvironmentSource.AGENT);
  });

  it("records none for a conversation on the person's own machine, and refuses one that names its own there", async () => {
    const sessions = createClient(SessionCommandController, asCarol());
    const local = await sessions.create(sessionInput({ executionTarget: ExecutionTarget.LOCAL }));
    expect(local.status?.environment).toBeUndefined();
    expect(local.status?.environmentSource).toBe(EnvironmentSource.UNSPECIFIED);
    const refused = await errorOf(() =>
      sessions.create(sessionInput({ executionTarget: ExecutionTarget.LOCAL, environmentRef: environmentRef("org-box") })),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(LOCAL_ENVIRONMENT_MESSAGE);
  });

  it("lets a member name an Environment he may view, and refuses one he may not", async () => {
    const sessions = createClient(SessionCommandController, asDave());
    const own = await sessions.create(
      sessionInput({ executionTarget: ExecutionTarget.CLOUD, environmentRef: environmentRef("org-box") }),
    );
    expect(own.status?.environment?.id).toBe(orgBox.metadata!.id);
    expect(own.status?.environmentSource).toBe(EnvironmentSource.SESSION);

    const refused = await errorOf(() =>
      sessions.create(sessionInput({ executionTarget: ExecutionTarget.CLOUD, environmentRef: environmentRef("carols-box") })),
    );
    expect(refused.code).toBe(Code.PermissionDenied);
    // Carol, who may view it, names it.
    const carols = await createClient(SessionCommandController, asCarol()).create(
      sessionInput({ executionTarget: ExecutionTarget.CLOUD, environmentRef: environmentRef("carols-box") }),
    );
    expect(carols.status?.environment?.id).toBe(carolsBox.metadata!.id);
  });

  it("refuses at create an agent default whose MCP server's host the limited Environment does not list", async () => {
    await createClient(AgentCommandController, asCarol()).create({
      apiVersion: API_VERSION,
      kind: "Agent",
      metadata: { name: "Searcher", org: ORG },
      spec: {
        instructions: "You search.",
        environmentRef: environmentRef("fenced"),
        mcpServers: [{ name: "search", url: "https://search.example.org/mcp" }],
      },
    });
    const refused = await errorOf(() =>
      createClient(SessionCommandController, asCarol()).create(
        sessionInput({
          executionTarget: ExecutionTarget.CLOUD,
          agentRef: { kind: ApiResourceKind.agent, org: ORG, slug: "searcher" },
        }),
      ),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(unlistedMcpHostMessage("fenced", "search", "search.example.org"));
    expect(fenced.metadata?.slug).toBe("fenced");
  });

  it("refuses an update naming another Environment once a turn has run", async () => {
    const sessions = createClient(SessionCommandController, asCarol());
    const session = await sessions.create(
      sessionInput({ executionTarget: ExecutionTarget.CLOUD, environmentRef: environmentRef("org-box") }),
    );
    const id = session.metadata!.id;
    await namingSaves(server.store).saveResource(
      ApiResourceKind.run,
      "run_env_1",
      RunSchema,
      create(RunSchema, {
        metadata: { id: "run_env_1", org: session.metadata!.org },
        spec: { target: { case: "sessionId", value: id } },
      }),
    );

    const refused = await errorOf(() =>
      sessions.update({
        resource: {
          ...session,
          spec: create(SessionSpecSchema, {
            executionTarget: ExecutionTarget.CLOUD,
            environmentRef: environmentRef("agent-box"),
          }),
        },
        updateMask: { paths: ["spec.environment_ref"] },
      }),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(IMMUTABLE_MESSAGE);
    const after = await server.store.getResource(ApiResourceKind.session, id, SessionSchema);
    expect(after.status?.environment?.id).toBe(orgBox.metadata!.id);
  });
});
