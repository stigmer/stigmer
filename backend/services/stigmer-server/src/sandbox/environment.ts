/**
 * The runner's half of a sandbox's Environment: its network mode and its
 * packages, as the one JSON value every driver hands the runner
 * (SANDBOX_ENVIRONMENT_ENV on docker and agent-sandbox, the attach push's
 * `environment` field on Substrate). The runner installs the packages and,
 * under `limited`, hides the engine tools whose traffic leaves outside the
 * sandbox. It never gets the host list:
 * enforcing that is the driver's, and a runner that held it could only
 * repeat what the gateway already decides.
 *
 * The runner validates the value again (backend/services/runner/src/
 * environment/spec.ts), because it crosses a boundary; the shape here and
 * there is pinned by a cross-package test.
 */
import type { EnvironmentFacts, EnvironmentPackageSet } from "./provisioner.js";

/** What the runner reads. */
export interface RunnerEnvironment {
  readonly network: "unrestricted" | "limited";
  readonly packages: EnvironmentPackageSet;
}

/** The runner's half of the facts, or `undefined` when no Environment governs the sandbox. */
export function runnerEnvironmentOf(environment: EnvironmentFacts | undefined): RunnerEnvironment | undefined {
  if (environment === undefined) {
    return undefined;
  }
  const { apt, cargo, gem, go, npm, pip } = environment.packages;
  return {
    network: environment.network.mode,
    packages: { apt: [...apt], cargo: [...cargo], gem: [...gem], go: [...go], npm: [...npm], pip: [...pip] },
  };
}

/** The runner's half as the variable's value, or `undefined` when there is none to set. */
export function runnerEnvironmentValue(environment: EnvironmentFacts | undefined): string | undefined {
  const value = runnerEnvironmentOf(environment);
  return value === undefined ? undefined : JSON.stringify(value);
}

/** Whether the Environment asks a driver for anything it must be able to do. */
export function environmentNeeds(environment: EnvironmentFacts): { readonly limitedNetworking: boolean; readonly packages: boolean } {
  const p = environment.packages;
  return {
    limitedNetworking: environment.network.mode === "limited",
    packages: p.apt.length + p.cargo.length + p.gem.length + p.go.length + p.npm.length + p.pip.length > 0,
  };
}
