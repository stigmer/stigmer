/**
 * Shared fakes for the Environment proofs: a sandbox provisioner that
 * states a chosen environmentSupport (or none) and is never asked to start
 * a sandbox, the extension unit that registers it as a driver, and the
 * process settings a composed server needs to compose a sandbox lane
 * (per-session routing; compose.ts refuses a provisioner without it). The
 * composed Environment, session and admission tests use them so each
 * composes a lane the same way.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";

import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import type { EnvironmentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";

import type { ServerExtension } from "../../../extensions/registry.js";
import type { EnvironmentSupport, SandboxProvisioner } from "../../../sandbox/provisioner.js";

/** The driver name the fake registers under (SANDBOX_PROVISIONER_TYPE). */
export const FAKE_SANDBOX_DRIVER = "environment-test-sandboxes";

function unused(): never {
  throw new Error("an Environment test never starts a sandbox");
}

/** A provisioner stating `support`, or no statement when undefined; tearing down is a no-op. */
export function provisionerStating(support: EnvironmentSupport | undefined): SandboxProvisioner {
  return {
    ...(support === undefined ? {} : { environmentSupport: support }),
    ensureSessionSandbox: async () => unused(),
    deprovisionSessionSandbox: async () => {},
    createConnectSandbox: async () => unused(),
    deprovisionConnectSandbox: async () => {},
    probe: async () => unused(),
  };
}

/** The unit registering the fake driver; compose with SANDBOX_PROVISIONER_TYPE set to FAKE_SANDBOX_DRIVER. */
export function sandboxUnit(
  support: EnvironmentSupport | undefined,
  extra: Omit<ServerExtension, "name" | "drivers"> = {},
): ServerExtension {
  return {
    name: "environment-test-sandboxes",
    ...extra,
    drivers: {
      sandboxProvisionerDrivers: new Map([[FAKE_SANDBOX_DRIVER, () => provisionerStating(support)]]),
    },
  };
}

/** An Environment create request in `org`, named `name`. */
export function environmentInput(
  org: string,
  name: string,
  spec: MessageInitShape<typeof EnvironmentSpecSchema> = {},
  visibility?: ApiResourceVisibility,
): Environment {
  return create(EnvironmentSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Environment",
    metadata: { name, org, ...(visibility === undefined ? {} : { visibility }) },
    spec,
  });
}
