/**
 * The substrate driver as the server composes it: the built-in factory
 * behind SANDBOX_PROVISIONER_TYPE=substrate, and newSubstrateSandboxDriver
 * for a composition that builds the driver itself.
 *
 * The built-in reads its own settings (config.ts) and exposes the idle
 * sweep as the provisioner's background work (provisioner.ts,
 * startBackground), which the composition root starts and stops. A
 * composition that keeps records of its sandboxes and runs its own sweep
 * over them takes `provisioner` and `lifecycle` from
 * newSubstrateSandboxDriver and leaves `startIdleSweep` unused, so the two
 * sweeps never both run.
 *
 * Both paths push through the router's own transport (push.ts,
 * newRouterFetch), which trusts the configured CA. A router reached over
 * http:// is accepted, because a local install reaches it by port-forward,
 * and logged once as a warning: the push carries the runner's secrets.
 */
import type { Logger } from "../../boot/logger.js";
import type {
  SandboxBackgroundContext,
  SandboxBackgroundHandle,
  SandboxDriverConfig,
  SandboxProvisioner,
  SandboxProvisionerFactory,
} from "../provisioner.js";
import {
  newSubstrateSettingsFromEnv,
  type SubstrateDriverSettings,
} from "./config.js";
import {
  newSubstrateSandboxDriverOverGateway,
  validateSubstrateDriverConfig,
  type SubstrateSandboxLifecycle,
} from "./driver.js";
import { newSubstrateClientGateway } from "./gateway.js";
import { newRouterFetch } from "./push.js";
import { startSubstrateSweep } from "./sweep.js";
import type { SubstrateRunnerMode } from "./template.js";

/** The substrate driver, built: its provisioner, its lifecycle, and its optional sweep. */
export interface SubstrateSandboxDriverHandle {
  readonly provisioner: SandboxProvisioner;
  readonly lifecycle: SubstrateSandboxLifecycle;
  /** The open-source idle sweep over the server's sessions (sweep.ts). */
  startIdleSweep(context: SandboxBackgroundContext): SandboxBackgroundHandle;
}

export function newSubstrateSandboxDriver(options: {
  readonly config: SandboxDriverConfig;
  readonly settings: SubstrateDriverSettings;
  readonly logger: Logger;
  /** The runner's MODE in every sandbox (template.ts); `local`, open source's, when absent. */
  readonly runnerMode?: SubstrateRunnerMode;
}): SubstrateSandboxDriverHandle {
  validateSubstrateDriverConfig(options.config);
  const fetch = newRouterFetch(options.settings);
  if (!options.settings.routerUrl.startsWith("https://")) {
    options.logger.warn(
      "Substrate's router is reached over http://, so the attach push carries the runner's secrets and session token in cleartext; give STIGMER_SANDBOX_SUBSTRATE_ROUTER_URL as https:// with STIGMER_SANDBOX_SUBSTRATE_ROUTER_CA_FILE (and STIGMER_SANDBOX_SUBSTRATE_ROUTER_SERVER_NAME when the router is reached by another name than its certificate's)",
      { routerUrl: options.settings.routerUrl },
    );
  }
  const driver = newSubstrateSandboxDriverOverGateway({
    ...options,
    gateway: newSubstrateClientGateway(options.settings),
    fetch,
  });
  return {
    provisioner: driver.provisioner,
    lifecycle: driver.lifecycle,
    startIdleSweep: (context) =>
      startSubstrateSweep({
        driver: driver.internals,
        lifecycle: driver.lifecycle,
        sessions: context.sessions,
        logger: context.logger,
      }),
  };
}

export const newSubstrateSandboxProvisioner: SandboxProvisionerFactory = ({
  config,
  logger,
}) => {
  const driver = newSubstrateSandboxDriver({
    config,
    settings: newSubstrateSettingsFromEnv(),
    logger,
  });
  return {
    ...driver.provisioner,
    startBackground: (context) => driver.startIdleSweep(context),
  };
};
