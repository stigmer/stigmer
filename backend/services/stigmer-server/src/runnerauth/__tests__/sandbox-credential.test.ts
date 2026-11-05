/**
 * Open source's sandbox credential (sandbox-credential.ts), through both
 * open-source providers' capabilities:
 *
 *   - its queue is built from its binding: a run's session
 *     (`session:<sessionId>`), whether or not that run has ended, while the
 *     session exists; a connect attempt's `mcpconnect:<id>` while the
 *     attempt is live;
 *   - refused, never thrown: a token this server did not sign, an expired
 *     one, a run credential (no `exp`), a person's key, a binding whose row
 *     is gone, a run whose session was reaped or that names none;
 *   - renewal re-mints the same binding with a fresh lifetime for a
 *     run-bound token whose session exists, and nothing for a connect, an
 *     expired token, a run credential or a reaped session;
 *   - a store outage propagates;
 *   - the built-in provider's exchange answers its renewal arm the same way.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import { newConnectExecutionId } from "../../domain/plugin/tools/execution-id.js";
import { SANDBOX_TOKEN_TTL_SECONDS } from "../../sandbox/lane.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { ConnectAttemptRecord } from "../../store/interface.js";
import { newBuiltInRunnerCredentialProvider } from "../built-in-runner-credential-provider.js";
import { newExecutionScopedRunnerCredentialProvider } from "../runner-credential-provider.js";
import { RunnerAuthService } from "../runnerauth.js";
import type { SandboxCredentialStore } from "../sandbox-credential.js";

const service = RunnerAuthService.create(Buffer.alloc(32, 3));
const CONNECT_ID = newConnectExecutionId("plg_1");

function storeOf(rows: Record<string, unknown>, attempts: Record<string, ConnectAttemptRecord> = {}): SandboxCredentialStore {
  return {
    getResource<Desc extends DescMessage>(kind: ApiResourceKind, id: string, _schema: Desc): Promise<MessageShape<Desc>> {
      const row = rows[id];
      return row === undefined
        ? Promise.reject(new ResourceNotFoundError(`${kind}/${id}`))
        : Promise.resolve(row as MessageShape<Desc>);
    },
    connectAttempts: {
      create: () => Promise.reject(new Error("unused")),
      delete: () => Promise.reject(new Error("unused")),
      deleteExpired: () => Promise.reject(new Error("unused")),
      deleteByOrg: () => Promise.reject(new Error("unused")),
      findLive: (id) => Promise.resolve(attempts[id]),
    },
  };
}

const rows = {
  // An ended run: a session sandbox's token names the run that last ensured it.
  run_ended: create(RunSchema, {
    metadata: { id: "run_ended", org: "acme" },
    spec: { target: { case: "sessionId", value: "ses_1" } },
    status: { phase: RunPhase.RUN_COMPLETED, completedAt: "2026-01-01T00:00:00Z" },
  }),
  run_reaped: create(RunSchema, {
    metadata: { id: "run_reaped", org: "acme" },
    spec: { target: { case: "sessionId", value: "ses_gone" } },
  }),
  run_nosession: create(RunSchema, { metadata: { id: "run_nosession", org: "acme" } }),
  ses_1: create(SessionSchema, { metadata: { id: "ses_1", org: "acme" } }),
};
const attempts: Record<string, ConnectAttemptRecord> = {
  [CONNECT_ID]: { id: CONNECT_ID, org: "acme", createdBy: "ida_1", expiresAt: Number.MAX_SAFE_INTEGER } as ConnectAttemptRecord,
};
const store = storeOf(rows, attempts);
const provider = newExecutionScopedRunnerCredentialProvider(service, store);
const clocked = (binding: string) => service.mint(binding, 600).token;

afterEach(() => {
  vi.useRealTimers();
});

describe("the queue a sandbox credential serves", () => {
  it("is its run's session's, ended run or not, and its connect attempt's", async () => {
    expect(await provider.temporalTaskQueueOf!(clocked("run_ended"))).toBe("session:ses_1");
    expect(await provider.temporalTaskQueueOf!(clocked(CONNECT_ID))).toBe(`mcpconnect:${CONNECT_ID}`);
  });

  it("is refused for anything that is not a live sandbox's own token", async () => {
    const foreign = RunnerAuthService.create(Buffer.alloc(32, 4)).mint("run_ended", 600).token;
    const refused = [
      foreign,
      service.mintRunCredential("run_ended"),
      "stk_a_person_api_key",
      clocked("run_missing"),
      clocked("run_reaped"),
      clocked("run_nosession"),
      clocked(newConnectExecutionId("plg_gone")),
      clocked("ses_1"),
    ];
    for (const token of refused) {
      expect(await provider.temporalTaskQueueOf!(token)).toBeUndefined();
    }
    vi.useFakeTimers();
    const expiring = clocked("run_ended");
    vi.setSystemTime(Date.now() + 601_000);
    expect(await provider.temporalTaskQueueOf!(expiring)).toBeUndefined();
  });

  it("propagates a store outage", async () => {
    const broken = newExecutionScopedRunnerCredentialProvider(service, {
      ...store,
      getResource: () => Promise.reject(new Error("database unavailable")),
    });
    await expect(broken.temporalTaskQueueOf!(clocked("run_ended"))).rejects.toThrow("database unavailable");
  });

  it("propagates an outage on the session's read too", async () => {
    const broken = newExecutionScopedRunnerCredentialProvider(service, {
      ...store,
      getResource: (kind, id, schema) =>
        kind === ApiResourceKind.session ? Promise.reject(new Error("session store down")) : store.getResource(kind, id, schema),
    });
    await expect(broken.temporalTaskQueueOf!(clocked("run_ended"))).rejects.toThrow("session store down");
  });

  it("is not offered by a provider composed without a store", () => {
    expect(newExecutionScopedRunnerCredentialProvider(service).temporalTaskQueueOf).toBeUndefined();
  });
});

describe("renewal", () => {
  it("re-mints the same binding with a fresh lifetime while the session exists", async () => {
    const renewed = await provider.renewSandboxToken!(clocked("run_ended"));
    expect(renewed).toMatchObject({ minted: true, expiresInSeconds: SANDBOX_TOKEN_TTL_SECONDS });
    if (!renewed.minted) throw new Error("expected a token");
    expect(service.verify(renewed.token)).toBe("run_ended");
  });

  it("mints nothing for a connect, a run credential, a person's key, an expired token or a reaped session", async () => {
    for (const token of [
      clocked(CONNECT_ID),
      service.mintRunCredential("run_ended"),
      "stk_a_person_api_key",
      clocked("run_reaped"),
    ]) {
      expect(await provider.renewSandboxToken!(token)).toEqual({ minted: false });
    }
    vi.useFakeTimers();
    const expiring = clocked("run_ended");
    vi.setSystemTime(Date.now() + 601_000);
    expect(await provider.renewSandboxToken!(expiring)).toEqual({ minted: false });
  });

  it("is the built-in provider's renewal arm too, read from the caller's own token", async () => {
    const builtIn = newBuiltInRunnerCredentialProvider({
      service,
      store,
      accounts: { findByCallerId: vi.fn() } as never,
      credentialBinding: { admitsOrganization: vi.fn() } as never,
    });
    const caller = (rawToken: string) => ({ callerClass: "runner", rawToken, identityId: "ida_1" }) as unknown as CallerIdentity;
    const renewed = await builtIn.exchangeScopedToken!({ arm: "renewal" }, caller(clocked("run_ended")));
    expect(renewed.minted).toBe(true);
    expect(await builtIn.exchangeScopedToken!({ arm: "renewal" }, caller(clocked("run_reaped")))).toEqual({ minted: false });
    expect(await builtIn.temporalTaskQueueOf!(clocked("run_ended"))).toBe("session:ses_1");
  });
});
