// Target selection from the environment.
// Domain: conformance targets.
//
// CONFORMANCE_TARGET selects which implementation the suite runs against,
// defaulting to the local OSS Go server. The same suite runs unchanged against
// any registered target.
import { CloudTarget } from "./cloud";
import { LocalGoTarget } from "./local-go";
import type { TargetProfile } from "./target";

const TARGET_FACTORIES: Record<string, () => TargetProfile> = {
  "local-go": () => new LocalGoTarget(),
  cloud: () => new CloudTarget(),
};

export function createTarget(): TargetProfile {
  const name = process.env.CONFORMANCE_TARGET ?? "local-go";
  const factory = TARGET_FACTORIES[name];
  if (factory === undefined) {
    const known = Object.keys(TARGET_FACTORIES).join(", ");
    throw new Error(`unknown CONFORMANCE_TARGET "${name}"; expected one of: ${known}`);
  }
  return factory();
}

export type { TargetProfile } from "./target";
export type { CapabilityFlags, TenancyContext } from "./target";
