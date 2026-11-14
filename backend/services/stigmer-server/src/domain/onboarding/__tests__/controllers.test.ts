/**
 * Pins the two onboarding reads at their controllers, on an in-process
 * router with a signed-in person as the caller and a recording authorizer:
 *
 *   - getOnboarding (OrganizationQueryController) refuses an empty id
 *     before any check, asks `can_edit` on the organization the request
 *     names, and hands the onboarding service that organization with the
 *     caller left out of the people who joined; a denial is
 *     PERMISSION_DENIED with the annotation's copy and reads nothing.
 *   - getOnboardingFunnel (PlatformQueryController) asks
 *     `can_view_platform_usage` on platform:stigmer, refuses a missing bound
 *     or one that is no day or instant, and hands the service the window the
 *     usage reports read (a UTC day from its first instant through its
 *     last); a denial reads nothing.
 *
 * The service is a stand-in: what it answers is onboarding.test.ts's.
 */
import { create } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { Code, ConnectError, createClient, createRouterTransport, type Interceptor } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GetOnboardingFunnelOutputSchema } from "@stigmer/apis/ai/stigmer/platform/v1/onboarding_funnel_pb";
import { PlatformQueryController, ServerEdition } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OnboardingProgressSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/onboarding_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Authorizer, AuthzCheck } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { ABSENT_LICENSE_STATUS } from "../../../extensions/license-status.js";
import { runnerProviderAvailability } from "../../../extensions/provider-availability.js";
import { bundledModelRegistryDocument } from "../../../modelcatalog/bundled.js";
import { newModelCatalogProviderFromDocument } from "../../../modelcatalog/document-catalog.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import { RunnerAuthService } from "../../../runnerauth/runnerauth.js";
import { newExecutionScopedRunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import { tempStore, type TempStore } from "../../../store/sqlite/__tests__/support.js";
import { UNBOUND_CREDENTIAL_BINDING } from "../../../authorization/__tests__/unbound-credential-binding.js";
import type { EnvironmentPolicy } from "../../run/environment-admission.js";
import { NO_ENVIRONMENT_SUPPORT } from "../../environment/facts.js";
import { registerOrganizationServices } from "../../organization/controller.js";
import { registerPlatformServices } from "../../platform/controller.js";
import type { ReportWindow } from "../../run/usage.js";
import type { OnboardingService } from "../service.js";

/** No sandbox lane: nothing is governed (getServerInfo's concern, not these reads'). */
const NO_SANDBOX_POLICY: EnvironmentPolicy = { governs: () => false, support: NO_ENVIRONMENT_SUPPORT };

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const PERSON: CallerIdentity = { identityId: "ida_sam", callerClass: "user", issuer: "https://id.example/", rawToken: "t" };

/** Every check the controllers asked, and whether to allow them. */
let checks: AuthzCheck[];
let allow: boolean;
/** What the stand-in service was asked. */
let asked: { progress: [string, string][]; funnel: ReportWindow[] };
let temp: TempStore;

const authorizer: Authorizer = {
  authorize: (_caller, check) => {
    checks.push(check);
    return Promise.resolve(allow ? { kind: "allow" } : { kind: "deny", reason: "not here" });
  },
};

const onboarding: OnboardingService = {
  progress: (org, leaveOut) => {
    asked.progress.push([org, leaveOut]);
    return Promise.resolve(create(OnboardingProgressSchema, { everRan: true }));
  },
  funnel: (window) => {
    asked.funnel.push(window);
    return Promise.resolve(create(GetOnboardingFunnelOutputSchema, { organizations: 3 }));
  },
};

/** Stamps the signed-in person as every request's caller, as the auth interceptor does at position 1. */
const asPerson: Interceptor = (next) => (request) => {
  request.contextValues.set(callerIdentityKey, PERSON);
  return next(request);
};

function organizations() {
  const transport = createRouterTransport(
    (router) =>
      registerOrganizationServices(router, {
        credentialBinding: UNBOUND_CREDENTIAL_BINDING,
        store: temp.store,
        logger: silentLogger,
        accounts: { findById: () => Promise.resolve(undefined) },
        authorizer,
        gateSteps: new Map(),
        grantPath: {} as never,
        authorizationLifecycle: undefined,
        organizationDirectory: undefined,
        orgLimit: undefined,
        purge: { kick: () => {} },
        onboarding,
      }),
    { router: { interceptors: [asPerson] } },
  );
  return createClient(OrganizationQueryController, transport);
}

function platform() {
  const transport = createRouterTransport(
    (router) =>
      registerPlatformServices(router, {
        runnerBootstrapTemporalAddress: "localhost:7233",
        sandboxTemporalAddress: "",
        runnerBootstrapMcpBridgeEndpoint: "",
        temporalNamespace: "default",
        runnerAuthService: newExecutionScopedRunnerCredentialProvider(RunnerAuthService.create(undefined)),
        edition: ServerEdition.oss,
        version: "dev",
        authenticationRequired: true,
        nativeSignIn: undefined,
        help: undefined,
        singleOrganization: undefined,
        licenseStatus: ABSENT_LICENSE_STATUS,
        providerAvailability: runnerProviderAvailability(undefined),
        modelCatalog: newModelCatalogProviderFromDocument(bundledModelRegistryDocument()),
        authorizer,
        environmentPolicy: NO_SANDBOX_POLICY,
        onboarding,
        now: () => new Date(),
        logger: silentLogger,
      }),
    { router: { interceptors: [asPerson] } },
  );
  return createClient(PlatformQueryController, transport);
}

async function refusal(call: () => Promise<unknown>): Promise<ConnectError> {
  return ConnectError.from(await call().then(() => new Error("answered"), (error: unknown) => error));
}

beforeEach(() => {
  temp = tempStore();
  checks = [];
  allow = true;
  asked = { progress: [], funnel: [] };
});

afterEach(async () => {
  await temp.cleanup();
});

describe("getOnboarding", () => {
  it("asks can_edit on the named organization and leaves the caller out of who joined", async () => {
    const answer = await organizations().getOnboarding({ value: "org_acme" });
    expect(answer.everRan).toBe(true);
    expect(checks).toEqual([{ permission: IamPermission.can_edit, resourceKind: ApiResourceKind.organization, resourceId: "org_acme" }]);
    expect(asked.progress).toEqual([["org_acme", "ida_sam"]]);
  });

  it("refuses an empty id before any check", async () => {
    const error = await refusal(() => organizations().getOnboarding({ value: "" }));
    expect(error.code).toBe(Code.InvalidArgument);
    expect([checks, asked.progress]).toEqual([[], []]);
  });

  it("refuses a person who is no admin of the organization, reading nothing", async () => {
    allow = false;
    const error = await refusal(() => organizations().getOnboarding({ value: "org_acme" }));
    expect([error.code, error.rawMessage]).toEqual([Code.PermissionDenied, "unauthorized to read this organization's onboarding"]);
    expect(asked.progress).toEqual([]);
  });
});

describe("getOnboardingFunnel", () => {
  it("asks can_view_platform_usage on the platform and counts the window the usage reports read", async () => {
    const answer = await platform().getOnboardingFunnel({ fromDate: "2026-11-01", toDate: "2026-11-07" });
    expect(answer.organizations).toBe(3);
    expect(checks).toEqual([{ permission: IamPermission.can_view_platform_usage, resourceKind: ApiResourceKind.platform, resourceId: "stigmer" }]);
    expect(asked.funnel).toEqual([{ fromMs: Date.UTC(2026, 10, 1), toMs: Date.UTC(2026, 10, 7, 23, 59, 59, 999) }]);
  });

  it("refuses a caller who is no platform operator, reading nothing", async () => {
    allow = false;
    const error = await refusal(() => platform().getOnboardingFunnel({ fromDate: "2026-11-01", toDate: "2026-11-07" }));
    expect([error.code, error.rawMessage]).toEqual([Code.PermissionDenied, "only platform operators can read onboarding counts"]);
    expect(asked.funnel).toEqual([]);
  });

  it("refuses a missing bound and one that is no day or instant", async () => {
    for (const [fromDate, toDate, words] of [
      ["", "2026-11-07", "from_date is required"],
      ["2026-11-01", "", "to_date is required"],
      ["last week", "2026-11-07", "from_date must be a UTC date (YYYY-MM-DD) or an RFC 3339 timestamp"],
    ] as const) {
      const error = await refusal(() => platform().getOnboardingFunnel({ fromDate, toDate }));
      expect([error.code, error.rawMessage]).toEqual([Code.InvalidArgument, words]);
    }
    expect(asked.funnel).toEqual([]);
  });
});
