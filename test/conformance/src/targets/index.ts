// Target selection from the environment.
// Domain: conformance targets.
//
// CONFORMANCE_TARGET selects which implementation the suite runs against,
// defaulting to the local OSS server. The same suite runs unchanged against
// any registered target.
import { CloudTarget } from "./cloud";
import { CloudExecutionTarget } from "./cloud-execution";
import { LocalTarget } from "./local";
import { LocalExecutionTarget } from "./local-execution";
import {
  LocalPostgresExecutionTarget,
  LocalPostgresTarget,
} from "./local-postgres";
import type { TargetProfile } from "./target";

const TARGET_FACTORIES: Record<string, () => TargetProfile> = {
  local: () => new LocalTarget(),
  "local-execution": () => new LocalExecutionTarget(),
  "local-postgres": () => new LocalPostgresTarget(),
  "local-postgres-execution": () => new LocalPostgresExecutionTarget(),
  cloud: () => new CloudTarget(),
  "cloud-execution": () => new CloudExecutionTarget(),
};

export function createTarget(): TargetProfile {
  const name = process.env.CONFORMANCE_TARGET ?? "local";
  const factory = TARGET_FACTORIES[name];
  if (factory === undefined) {
    const known = Object.keys(TARGET_FACTORIES).join(", ");
    throw new Error(`unknown CONFORMANCE_TARGET "${name}"; expected one of: ${known}`);
  }
  return factory();
}

export type { TargetProfile } from "./target";
export type { CapabilityFlags, TenancyContext } from "./target";
