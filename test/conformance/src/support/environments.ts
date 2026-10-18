// Canonical valid Environment fixtures for the conformance suite.
// Domain: conformance support.
//
// An Environment is a named sandbox setup: the packages a conversation's
// sandboxes get and the hosts they may reach. Whether a server can enforce
// limited networking or install packages depends on its sandbox driver, so
// the fixture every edition accepts is an unrestricted Environment with no
// packages; the suites ask the rest of the contract through refusals every
// edition gives alike (the grammar's, before the driver is asked).
import type { InitShape } from "./init-shape";
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";

export const ENVIRONMENT_API_VERSION = "agentic.stigmer.ai/v1";
export const ENVIRONMENT_KIND = "Environment";

// A valid, unrestricted Environment with no packages, every edition's.
export function makeEnvironment(
  org: string,
  name: string,
  description = "conformance environment",
): InitShape<typeof EnvironmentSchema> {
  return {
    apiVersion: ENVIRONMENT_API_VERSION,
    kind: ENVIRONMENT_KIND,
    metadata: { name, org },
    spec: { description, networking: { type: NetworkingType.unrestricted } },
  };
}

// A limited Environment listing `hosts`: every edition judges its hosts
// before it asks whether its sandboxes can enforce them.
export function makeLimitedEnvironment(
  org: string,
  name: string,
  hosts: string[],
): InitShape<typeof EnvironmentSchema> {
  return {
    apiVersion: ENVIRONMENT_API_VERSION,
    kind: ENVIRONMENT_KIND,
    metadata: { name, org },
    spec: { networking: { type: NetworkingType.limited, allowedHosts: hosts } },
  };
}
