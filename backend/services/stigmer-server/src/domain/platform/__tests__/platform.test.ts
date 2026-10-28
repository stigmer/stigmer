/**
 * Pins the platform domain against Go's platform_controller_test.go +
 * get_runner_scoped_token_test.go — through the real stack (composed
 * server, native gRPC client, full interceptor chain),
 * plus a keyless-service arm on an in-process router.
 *
 * The load-bearing pins the conformance suite deliberately does NOT cover
 * (its platform file excludes getRunnerScopedToken — the arms are gated on
 * runner-class flows):
 *   - the oss#535 FAIL-SOFT matrix: execution-id arms mint;
 *     renewal/unset/empty-id/keyless all answer the presence-based
 *     "not minted" EMPTY output, never a gRPC error;
 *   - a request carrying only a reserved arm (field 2, the retired
 *     workflow_run_id; field 3, the retired pool_claim) gets the
 *     unset-scope InvalidArgument, the same code and message as a request
 *     naming no scope, never a token;
 *   - a minted token actually verifies against the SAME key the values
 *     fetch uses, bound to exactly the named execution id;
 *   - getRunnerBootstrapConfig echoes the configured Temporal coordinates
 *     with the token fields empty (minting a proxy token is cloud-only),
 *     and publishes the runner-bootstrap address rather than the one the
 *     server dials when the two differ (stigmer#1357);
 *   - getServerInfo reports the build stamp by default and the release a
 *     library consumer states through ComposeOptions.version otherwise
 *     (stigmer#1168: unbundled, the stamp is always "dev"), and a
 *     trusted-local server's posture as an explicit false;
 *   - getServerInfo's `environments` is set on every server, and copies
 *     the composed Environment policy: whether it governs a conversation
 *     that names no target, and what its sandboxes can do; the default
 *     open-source composition starts no sandbox, so it answers false
 *     three times;
 *   - getLicenseStatus answers `absent` with no claims and no key when no
 *     provider is composed, and the composed provider's report verbatim
 *     when one is — both stamped with the ONE instant the controller
 *     hands the provider (the checked_at contract).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  LicenseClaimsSchema,
  LicenseState,
  LicenseTerm,
} from "@stigmer/apis/ai/stigmer/platform/v1/license_pb";
import { ExecutionTarget, Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ProviderAvailability } from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import {
  GetRunnerScopedTokenInputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { ABSENT_LICENSE_STATUS } from "../../../extensions/license-status.js";
import type { LicenseStatusProvider } from "../../../extensions/license-status.js";
import { newExecutionScopedRunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import type {
  RunnerCredentialProvider,
  RunnerScopedTokenRequest,
} from "../../../runnerauth/runner-credential-provider.js";
import {
  InvalidTokenError,
  RunnerAuthService,
} from "../../../runnerauth/runnerauth.js";
import { registerPlatformServices } from "../controller.js";
import { runnerProviderAvailability } from "../../../extensions/provider-availability.js";
import type { ProviderAvailabilityProvider } from "../../../extensions/provider-availability.js";
import { organizationId, seedOrganizations } from "../../organization/__tests__/support.js";
import { newModelCatalogProviderFromDocument } from "../../../modelcatalog/document-catalog.js";
import { bundledModelRegistryDocument } from "../../../modelcatalog/bundled.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import type { EnvironmentPolicy } from "../../run/environment-admission.js";
import { NO_ENVIRONMENT_SUPPORT } from "../../environment/facts.js";

/** The default posture's policy: no sandbox lane, so nothing is governed. */
const NO_SANDBOX_POLICY: EnvironmentPolicy = {
  governs: () => false,
  support: NO_ENVIRONMENT_SUPPORT,
};

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const RUNNER_KEY = Buffer.alloc(32, 5);
const ENC_KEY = Buffer.alloc(32, 6);

type PlatformClient = Client<typeof PlatformQueryController>;

/**
 * A verified ticket's claims, shared by every arm that fakes a provider in
 * a verified state: the report type requires them there, so a fixture that
 * omitted them would not compile.
 */
const verifiedClaims = create(LicenseClaimsSchema, {
  licenseId: "lic_01platformtest",
  customer: {
    id: "cus_acme",
    displayName: "Acme Corp",
    contactEmail: "billing@acme.example",
  },
  term: LicenseTerm.paid,
  entitlements: { features: [] },
  issuedAt: timestampFromDate(new Date("2026-09-01T00:00:00Z")),
  expiresAt: timestampFromDate(new Date("2027-09-01T00:00:00Z")),
  graceUntil: timestampFromDate(new Date("2027-10-01T00:00:00Z")),
});

describe("platform domain (composed server)", () => {
  let server: ComposedServer;
  let client: PlatformClient;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "platform-domain-test-"));
    vi.stubEnv("STIGMER_RUNNER_TOKEN_KEY", RUNNER_KEY.toString("base64"));
    vi.stubEnv("STIGMER_ENCRYPTION_KEY", ENC_KEY.toString("base64"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
        TEMPORAL_HOST_PORT: "127.0.0.1:7777",
        TEMPORAL_NAMESPACE: "conformance-ns",
      }),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    const transport: Transport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
    });
    client = createClient(PlatformQueryController, transport);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("getServerInfo names the oss edition and the dev version, stable across calls", async () => {
    const first = await client.getServerInfo({});
    expect(first.edition).toBe(ServerEdition.oss);
    // Unbundled runs report Go's unstamped default; release bundles stamp
    // the esbuild define (scripts/bundle-slim.mjs).
    expect(first.version).toBe("dev");
    // A server that trusts every request says so on the wire: an explicit
    // false, never an absent field a console would read as "unknown".
    expect(first.authenticationRequired).toBe(false);
    // The default posture starts no sandbox (SANDBOX_PROVISIONER_TYPE
    // unset): no Environment governs a conversation here, and the field is
    // still present, so a console never reads it as an older server.
    expect(first.environments).toEqual(
      expect.objectContaining({ applies: false, limitedNetworking: false, packages: false }),
    );

    const second = await client.getServerInfo({});
    expect(second.edition).toBe(first.edition);
    expect(second.version).toBe(first.version);
  });

  it("getRunnerBootstrapConfig echoes the configured Temporal coordinates, token fields empty", async () => {
    const config = await client.getRunnerBootstrapConfig({});
    expect(config.temporalAddress).toBe("127.0.0.1:7777");
    expect(config.temporalNamespace).toBe("conformance-ns");

    // Presence-based contract: no token means no companion fields — OSS
    // never mints the proxy token (cloud-only capability).
    expect(config.runnerAccessToken).toBe("");
    expect(config.tokenType).toBe("");
    expect(config.runnerAccessTokenExpiresInSeconds).toBe(0);
    expect(config.payloadEncryptionKeyId).toBe("");
    expect(config.payloadEncryptionKey).toBe("");
  });

  it("getLicenseStatus answers absent — no claims, no key, a fresh checked_at — when nothing is composed", async () => {
    const before = Date.now();
    const status = await client.getLicenseStatus({});
    const after = Date.now();

    expect(status.state).toBe(LicenseState.absent);
    // Presence follows the state: an absent license names no key and
    // carries no claims — the same all-or-nothing coupling the runner
    // bootstrap fields keep.
    expect(status.claims).toBeUndefined();
    expect(status.keyId).toBe("");
    if (status.checkedAt === undefined) {
      throw new Error("checked_at is always set");
    }
    const checkedAt = timestampDate(status.checkedAt).getTime();
    expect(checkedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(checkedAt).toBeLessThanOrEqual(after + 1000);
  });

  it("mints for the run_id arm, bound to exactly that run", async () => {
    const out = await client.getRunnerScopedToken({
      scope: { case: "runId", value: "aexec_01platformtest" },
    });

    expect(out.runnerScopedToken).not.toBe("");
    expect(out.tokenType).toBe("Bearer");
    expect(out.expiresInSeconds).toBe(3600);

    // The minted token verifies against the SAME key the values fetch
    // uses, and its binding is the named execution id.
    expect(server.runnerAuthService.verify(out.runnerScopedToken)).toBe(
      "aexec_01platformtest",
    );
  });

  it("answers the not-minted shape for empty ids and renewal", async () => {
    const arms: MessageInitShape<typeof GetRunnerScopedTokenInputSchema>[] = [
      { scope: { case: "runId", value: "" } },
      { scope: { case: "renewal", value: {} } },
    ];
    for (const input of arms) {
      const out = await client.getRunnerScopedToken(input);
      expect(out.runnerScopedToken, JSON.stringify(input)).toBe("");
      expect(out.tokenType, JSON.stringify(input)).toBe("");
      expect(out.expiresInSeconds, JSON.stringify(input)).toBe(0);
    }
  });

  it("an unset scope is rejected by protovalidate BEFORE the handler (both editions)", async () => {
    // The proto pins `scope` as a required oneof, so the wire can never
    // reach the handler's defensive undefined arm — the same InvalidArgument
    // protovalidate answers on the Go server.
    try {
      await client.getRunnerScopedToken({});
      throw new Error("expected the call to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    }
  });

  it.each([
    [
      "workflow_run_id field (2)",
      new BinaryWriter().tag(2, WireType.LengthDelimited).string("wex_01platformtest").finish(),
    ],
    [
      "pool_claim field (3)",
      new BinaryWriter().tag(3, WireType.LengthDelimited).fork().tag(1, WireType.LengthDelimited).string("ses_x").join().finish(),
    ],
  ])("a request naming only the retired %s is answered as one naming no scope", async (_field, retiredBytes) => {
    // Field 2 held workflow_run_id until the workflow product was removed,
    // and field 3 held pool_claim, a pre-started pool sandbox's exchange,
    // until the hosted edition's sandbox pool was removed; both are now
    // reserved. An older runner that still sends one names no arm this
    // server knows, so it gets the unset-scope answer, never a token. The
    // bytes are built by wire number because the schema no longer names
    // the field; decoding keeps it as an unknown field, which the client
    // writes back onto the wire unchanged.
    const retiredOnly = fromBinary(
      GetRunnerScopedTokenInputSchema,
      retiredBytes,
    );
    expect(retiredOnly.scope.case).toBeUndefined();
    expect(toBinary(GetRunnerScopedTokenInputSchema, retiredOnly)).toEqual(
      retiredBytes,
    );

    const answer = async (
      input: MessageInitShape<typeof GetRunnerScopedTokenInputSchema>,
    ): Promise<ConnectError> => {
      try {
        await client.getRunnerScopedToken(input);
      } catch (error) {
        return ConnectError.from(error);
      }
      throw new Error("expected the call to fail");
    };
    const noScope = await answer({});
    const retired = await answer(retiredOnly);

    expect(retired.code).toBe(Code.InvalidArgument);
    expect(retired.rawMessage).toBe(noScope.rawMessage);
    expect(retired.rawMessage).toBe(
      "scope: exactly one field is required in oneof [required]",
    );
  });
});

describe("platform domain (composed with a stated version)", () => {
  let server: ComposedServer;
  let client: PlatformClient;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "platform-domain-version-test-"));
    vi.stubEnv("STIGMER_ENCRYPTION_KEY", ENC_KEY.toString("base64"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: silentLogger,
      version: "3.99.0",
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    client = createClient(
      PlatformQueryController,
      createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` }),
    );
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("getServerInfo reports the composition's stated release, not the build stamp", async () => {
    // A library consumer (the cloud composition) runs no bundle, so the
    // define is never stamped for it; ComposeOptions.version is how it
    // states the release it installed. Edition is untouched by it.
    const info = await client.getServerInfo({});
    expect(info.version).toBe("3.99.0");
    expect(info.edition).toBe(ServerEdition.oss);
  });
});

/**
 * stigmer#1357 through the real stack: a server that dials Temporal by a
 * name its runners cannot resolve publishes the address they can, from
 * the environment through loadConfig and the composition root to the
 * wire. The composed-server arm above is the default: with no override,
 * the published address is the server's own.
 */
describe("platform domain (composed for runners off the server's network)", () => {
  let server: ComposedServer;
  let client: PlatformClient;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(
      path.join(tmpdir(), "platform-domain-runner-address-test-"),
    );
    vi.stubEnv("STIGMER_ENCRYPTION_KEY", ENC_KEY.toString("base64"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
        TEMPORAL_HOST_PORT: "127.0.0.1:7777",
        TEMPORAL_NAMESPACE: "conformance-ns",
        STIGMER_RUNNER_BOOTSTRAP_TEMPORAL_ADDRESS: "temporal.example.test:7233",
      }),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    client = createClient(
      PlatformQueryController,
      createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` }),
    );
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("getRunnerBootstrapConfig publishes the runner-bootstrap address, with the server's namespace", async () => {
    const config = await client.getRunnerBootstrapConfig({});
    expect(config.temporalAddress).toBe("temporal.example.test:7233");
    expect(config.temporalNamespace).toBe("conformance-ns");
  });
});

/**
 * getModelReadiness through the real stack: the declared setting
 * (STIGMER_RUNNER_PROVIDERS) reaches the wire as served-by or
 * missing-from the runners per provider, in the server's order; every
 * catalog model carries its provider's state by the rule the create chain
 * refuses with; and a model the input names is judged too.
 */
describe("platform domain (model readiness, declared runners)", () => {
  let server: ComposedServer;
  let client: PlatformClient;
  let dir: string;
  let org: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "platform-domain-readiness-test-"));
    vi.stubEnv("STIGMER_ENCRYPTION_KEY", ENC_KEY.toString("base64"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
        STIGMER_RUNNER_PROVIDERS: "anthropic",
      }),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    const transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
    org = organizationId(await seedOrganizations(transport, ["readiness-acme"]), "readiness-acme");
    client = createClient(PlatformQueryController, transport);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("reports each provider from the declared runners, in the server's order", async () => {
    const out = await client.getModelReadiness({ org });
    expect(out.providers.map((p) => [p.provider, p.availability])).toEqual([
      ["anthropic", ProviderAvailability.served_by_runners],
      ["openai", ProviderAvailability.missing_from_runners],
    ]);
  });

  it("judges every catalog model on every engine by its provider", async () => {
    const out = await client.getModelReadiness({ org });
    const sonnet = out.models.find((m) => m.harness === Harness.NATIVE && m.model === "claude-sonnet-4.6");
    expect(sonnet).toMatchObject({ provider: "anthropic", availability: ProviderAvailability.served_by_runners });
    const claude = out.models.filter((m) => m.harness === Harness.CLAUDE);
    expect(claude.length).toBeGreaterThan(0);
    expect(claude.every((m) => m.provider === "anthropic")).toBe(true);
    expect(claude.every((m) => m.availability === ProviderAvailability.served_by_runners)).toBe(true);
    expect(
      out.models.every((m) =>
        m.provider === "anthropic"
          ? m.availability === ProviderAvailability.served_by_runners
          : m.availability === ProviderAvailability.missing_from_runners,
      ),
    ).toBe(true);
    expect(new Set(out.models.map((m) => m.harness))).toEqual(new Set([Harness.NATIVE, Harness.CLAUDE]));
    expect(out.judged).toBeUndefined();
  });

  it("judges a model the catalog does not list when the input names it", async () => {
    const out = await client.getModelReadiness({
      org,
      model: { harness: Harness.UNSPECIFIED, model: "openai:house-model" },
    });
    expect(out.judged).toMatchObject({
      harness: Harness.NATIVE,
      model: "openai:house-model",
      provider: "openai",
      availability: ProviderAvailability.missing_from_runners,
    });
  });

  it("answers NOT_FOUND for an organization the server does not hold", async () => {
    await expect(client.getModelReadiness({ org: "org-nowhere" })).rejects.toMatchObject({ code: Code.NotFound });
  });
});

/**
 * A composed availability provider (the cloud registers one over its
 * keys) reaches the wire through the driver point: a parent organization's
 * key names the parent, unknown stays unknown, and a provider that cannot
 * be read fails the answer UNAVAILABLE, as create would.
 */
describe("platform domain (model readiness, composed availability)", () => {
  let server: ComposedServer;
  let client: PlatformClient;
  let dir: string;
  let org: string;
  let broken: string;
  let undeclared: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "platform-domain-readiness-unit-test-"));
    vi.stubEnv("STIGMER_ENCRYPTION_KEY", ENC_KEY.toString("base64"));
    const availability: ProviderAvailabilityProvider = {
      availability: (asked, provider) => {
        if (asked === broken) return Promise.reject(new Error("store down"));
        if (asked === undeclared) return Promise.resolve({ state: "unknown" });
        return Promise.resolve(
          provider === "anthropic"
            ? { state: "served", source: "organization" }
            : { state: "served", source: "parent", parentOrg: "org-parent" },
        );
      },
    };
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: silentLogger,
      extensions: [{ name: "keys", drivers: { providerAvailability: availability } }],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    const transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
    const ids = await seedOrganizations(transport, ["readiness-child", "readiness-broken", "readiness-undeclared"]);
    org = organizationId(ids, "readiness-child");
    broken = organizationId(ids, "readiness-broken");
    undeclared = organizationId(ids, "readiness-undeclared");
    client = createClient(PlatformQueryController, transport);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("names the parent organization whose key serves a provider, and passes unknown through", async () => {
    const out = await client.getModelReadiness({ org });
    expect(out.providers.map((p) => [p.provider, p.availability, p.parentOrg])).toEqual([
      ["anthropic", ProviderAvailability.served_by_organization, ""],
      ["openai", ProviderAvailability.served_by_parent_organization, "org-parent"],
    ]);
    const unknown = await client.getModelReadiness({ org: undeclared });
    expect(unknown.providers.map((p) => [p.provider, p.availability, p.parentOrg])).toEqual([
      ["anthropic", ProviderAvailability.availability_unknown, ""],
      ["openai", ProviderAvailability.availability_unknown, ""],
    ]);
  });

  it("answers UNAVAILABLE when a provider's availability cannot be read", async () => {
    await expect(client.getModelReadiness({ org: broken })).rejects.toMatchObject({ code: Code.Unavailable });
  });
});

describe("platform domain (keyless runner-token service)", () => {
  it("a keyless service answers not-minted — fail-soft, never an error", async () => {
    const transport = createRouterTransport((router) => {
      registerPlatformServices(router, {
        runnerBootstrapTemporalAddress: "localhost:7233",
        temporalNamespace: "default",
        runnerAuthService: newExecutionScopedRunnerCredentialProvider(
          RunnerAuthService.create(undefined),
        ),
        edition: ServerEdition.oss,
        version: "dev",
        authenticationRequired: false,
        singleOrganization: undefined,
        licenseStatus: ABSENT_LICENSE_STATUS,
        providerAvailability: runnerProviderAvailability(undefined),
        modelCatalog: newModelCatalogProviderFromDocument(bundledModelRegistryDocument()),
        authorizer: newPermissiveSingleTeamAuthorizer(),
        environmentPolicy: NO_SANDBOX_POLICY,
        now: () => new Date(),
        logger: silentLogger,
      });
    });
    const client = createClient(PlatformQueryController, transport);

    const out = await client.getRunnerScopedToken({
      scope: { case: "runId", value: "aexec_01keyless" },
    });
    expect(out.runnerScopedToken).toBe("");
    expect(out.tokenType).toBe("");
    expect(out.expiresInSeconds).toBe(0);
  });
});

/**
 * getServerInfo's `environments` on an in-process router, one composed
 * policy per case: `applies` asks the policy about a conversation that names
 * no target, and the other two answers are its sandboxes' support, copied.
 */
describe("platform domain (environment availability)", () => {
  function serverInfoWith(policy: EnvironmentPolicy) {
    const transport = createRouterTransport((router) => {
      registerPlatformServices(router, {
        runnerBootstrapTemporalAddress: "localhost:7233",
        temporalNamespace: "default",
        runnerAuthService: newExecutionScopedRunnerCredentialProvider(
          RunnerAuthService.create(undefined),
        ),
        edition: ServerEdition.oss,
        version: "dev",
        authenticationRequired: false,
        singleOrganization: undefined,
        licenseStatus: ABSENT_LICENSE_STATUS,
        providerAvailability: runnerProviderAvailability(undefined),
        modelCatalog: newModelCatalogProviderFromDocument(bundledModelRegistryDocument()),
        authorizer: newPermissiveSingleTeamAuthorizer(),
        environmentPolicy: policy,
        now: () => new Date(),
        logger: silentLogger,
      });
    });
    return createClient(PlatformQueryController, transport).getServerInfo({});
  }

  it("asks the policy about a conversation that names no target", async () => {
    const asked: ExecutionTarget[] = [];
    const info = await serverInfoWith({
      governs: (target) => {
        asked.push(target);
        return true;
      },
      support: { limitedNetworking: false, packages: true },
    });
    expect(asked).toEqual([ExecutionTarget.UNSPECIFIED]);
    expect(info.environments).toEqual(
      expect.objectContaining({ applies: true, limitedNetworking: false, packages: true }),
    );
  });

  it("copies each support answer as the sandboxes state it", async () => {
    const info = await serverInfoWith({
      governs: () => true,
      support: { limitedNetworking: true, packages: false },
    });
    expect(info.environments).toEqual(
      expect.objectContaining({ applies: true, limitedNetworking: true, packages: false }),
    );
  });

  it("a policy that governs nothing says so, and the field is still set", async () => {
    const info = await serverInfoWith(NO_SANDBOX_POLICY);
    expect(info.environments).toEqual(
      expect.objectContaining({ applies: false, limitedNetworking: false, packages: false }),
    );
  });
});

/**
 * The license-status arm on an in-process router, where the clock is
 * injected: the controller hands the provider ONE instant and stamps
 * checked_at from the same one, so a report and its timestamp can never
 * disagree about when the license was evaluated.
 */
describe("platform domain (license status)", () => {
  const instant = new Date("2026-09-18T00:00:00Z");

  function clientWith(provider: LicenseStatusProvider) {
    const transport = createRouterTransport((router) => {
      registerPlatformServices(router, {
        runnerBootstrapTemporalAddress: "localhost:7233",
        temporalNamespace: "default",
        runnerAuthService: newExecutionScopedRunnerCredentialProvider(
          RunnerAuthService.create(undefined),
        ),
        edition: ServerEdition.enterprise,
        version: "dev",
        authenticationRequired: false,
        singleOrganization: undefined,
        licenseStatus: provider,
        providerAvailability: runnerProviderAvailability(undefined),
        modelCatalog: newModelCatalogProviderFromDocument(bundledModelRegistryDocument()),
        authorizer: newPermissiveSingleTeamAuthorizer(),
        environmentPolicy: NO_SANDBOX_POLICY,
        now: () => instant,
        logger: silentLogger,
      });
    });
    return createClient(PlatformQueryController, transport);
  }

  it("the built-in provider answers absent, stamped with the injected instant", async () => {
    const status = await clientWith(ABSENT_LICENSE_STATUS).getLicenseStatus({});
    expect(status.state).toBe(LicenseState.absent);
    expect(status.claims).toBeUndefined();
    expect(status.keyId).toBe("");
    expect(status.checkedAt).toEqual(timestampFromDate(instant));
  });

  it("a composed provider's report is returned verbatim, evaluated at the same instant it is stamped with", async () => {
    const seen: Date[] = [];
    const provider: LicenseStatusProvider = {
      status: (now) => {
        seen.push(now);
        return Promise.resolve({
          state: LicenseState.valid,
          claims: verifiedClaims,
          keyId: "lk_2026",
        });
      },
    };

    const status = await clientWith(provider).getLicenseStatus({});
    expect(status.state).toBe(LicenseState.valid);
    expect(status.keyId).toBe("lk_2026");
    expect(status.claims?.licenseId).toBe("lic_01platformtest");
    expect(status.claims?.customer?.displayName).toBe("Acme Corp");
    expect(status.checkedAt).toEqual(timestampFromDate(instant));
    expect(seen).toEqual([instant]);
  });

  it("an invalid ticket names its key and carries no claims", async () => {
    const provider: LicenseStatusProvider = {
      status: () =>
        Promise.resolve({ state: LicenseState.invalid, keyId: "lk_unknown" }),
    };
    const status = await clientWith(provider).getLicenseStatus({});
    expect(status.state).toBe(LicenseState.invalid);
    expect(status.keyId).toBe("lk_unknown");
    expect(status.claims).toBeUndefined();
  });
});

/**
 * The capability delegation, proven through the FULL
 * stack: a provider registered via the extension registry, the identity
 * interceptor stamping the trusted-local caller, and the platform
 * controller delegating every arm. This is the seam the cloud
 * composition's exchange rides — the fakes record exactly what crossed
 * it.
 */
describe("platform domain (capability-delegating provider)", () => {
  let server: ComposedServer;
  let client: PlatformClient;
  let dir: string;
  const exchanged: {
    request: RunnerScopedTokenRequest;
    callerIdentityId: string;
    callerClass: string;
  }[] = [];
  let bootstrapCallerIds: string[] = [];
  let bootstrapThrows = false;

  const capabilityProvider: RunnerCredentialProvider = {
    isEnabled: () => false,
    mint: () => {
      throw new Error("primitive mint is not under test here");
    },
    verify: () => {
      throw new InvalidTokenError();
    },
    async exchangeScopedToken(request, caller) {
      exchanged.push({
        request,
        callerIdentityId: caller.identityId,
        callerClass: caller.callerClass,
      });
      if (request.arm === "agent-execution" && request.executionId === "aexec_denied") {
        throw new ConnectError(
          "run aexec_denied is not the caller's to serve",
          Code.PermissionDenied,
        );
      }
      if (request.arm === "renewal") {
        return { minted: false };
      }
      return { minted: true, token: "cloud-token", expiresInSeconds: 14400 };
    },
    async bootstrapCredentials(caller) {
      if (bootstrapThrows) {
        throw new Error("payload key store unavailable");
      }
      bootstrapCallerIds.push(caller.identityId);
      return {
        accessToken: { token: "cloud-bootstrap-token", expiresInSeconds: 900 },
        payloadKeys: {
          keyId: "rpk_test1",
          keyBase64: "a2V5",
          secondaryKeyId: "rpk_test0",
          secondaryKeyBase64: "b2xk",
        },
      };
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "platform-capability-test-"));
    vi.stubEnv("STIGMER_ENCRYPTION_KEY", ENC_KEY.toString("base64"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        DB_PATH: path.join(dir, "stigmer.db"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
        TEMPORAL_HOST_PORT: "127.0.0.1:7777",
        TEMPORAL_NAMESPACE: "conformance-ns",
      }),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
      extensions: [
        {
          name: "fake-cloud-credentials",
          drivers: { runnerCredentialProvider: capabilityProvider },
        },
        {
          // A second unit registering a different single-instance point:
          // the licenseStatus driver rides the same registry and reaches
          // the same controller as the credential provider does.
          name: "fake-enterprise-license",
          drivers: {
            licenseStatus: {
              status: () =>
                Promise.resolve({
                  state: LicenseState.expiring,
                  keyId: "lk_composed",
                  claims: verifiedClaims,
                }),
            },
          },
        },
      ],
    });
    const port = await server.start();
    client = createClient(
      PlatformQueryController,
      createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` }),
    );
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("delegates every exchange arm with the stamped caller identity", async () => {
    exchanged.length = 0;

    const minted = await client.getRunnerScopedToken({
      scope: { case: "runId", value: "aexec_cap1" },
    });
    expect(minted.runnerScopedToken).toBe("cloud-token");
    expect(minted.tokenType).toBe("Bearer");
    expect(minted.expiresInSeconds).toBe(14400);

    const renewal = await client.getRunnerScopedToken({
      scope: { case: "renewal", value: {} },
    });
    // The implementation's not-minted degrade rides the presence-based
    // empty output — same wire shape as the OSS renewal answer.
    expect(renewal.runnerScopedToken).toBe("");
    expect(renewal.tokenType).toBe("");
    expect(renewal.expiresInSeconds).toBe(0);

    expect(exchanged.map((e) => e.request)).toEqual([
      { arm: "agent-execution", executionId: "aexec_cap1" },
      { arm: "renewal" },
    ]);
    // The trusted-local identity the chain stamped is what crossed the
    // seam — the cloud implementation gates its arms on exactly this.
    for (const call of exchanged) {
      expect(call.callerIdentityId).not.toBe("");
      expect(call.callerClass).toBe("user");
    }
  });

  it("a refusal thrown by the implementation propagates as the gRPC error", async () => {
    try {
      await client.getRunnerScopedToken({
        scope: { case: "runId", value: "aexec_denied" },
      });
      throw new Error("expected the call to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.PermissionDenied);
      expect((error as ConnectError).rawMessage).toBe(
        "run aexec_denied is not the caller's to serve",
      );
    }
  });

  it("merges bootstrap credentials into the coordinate response", async () => {
    bootstrapCallerIds = [];
    const config = await client.getRunnerBootstrapConfig({});
    expect(config.temporalAddress).toBe("127.0.0.1:7777");
    expect(config.runnerAccessToken).toBe("cloud-bootstrap-token");
    expect(config.tokenType).toBe("Bearer");
    expect(config.runnerAccessTokenExpiresInSeconds).toBe(900);
    expect(config.payloadEncryptionKeyId).toBe("rpk_test1");
    expect(config.payloadEncryptionKey).toBe("a2V5");
    expect(config.payloadEncryptionSecondaryKeyId).toBe("rpk_test0");
    expect(config.payloadEncryptionSecondaryKey).toBe("b2xk");
    expect(bootstrapCallerIds).toHaveLength(1);
  });

  it("a composed licenseStatus driver answers getLicenseStatus through the full stack", async () => {
    const status = await client.getLicenseStatus({});
    expect(status.state).toBe(LicenseState.expiring);
    expect(status.keyId).toBe("lk_composed");
    // The verified arm's claims cross the gRPC boundary whole; the instant
    // itself is pinned on the in-process router above, where it is injected.
    expect(status.claims?.customer?.displayName).toBe("Acme Corp");
    expect(status.checkedAt).toBeDefined();
  });

  it("a bootstrap-credentials failure degrades to coordinates-only, never an error", async () => {
    bootstrapThrows = true;
    try {
      const config = await client.getRunnerBootstrapConfig({});
      expect(config.temporalAddress).toBe("127.0.0.1:7777");
      expect(config.runnerAccessToken).toBe("");
      expect(config.tokenType).toBe("");
      expect(config.payloadEncryptionKey).toBe("");
    } finally {
      bootstrapThrows = false;
    }
  });
});
