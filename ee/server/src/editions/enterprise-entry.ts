/**
 * The self-hosted Enterprise server's process entry: the license key
 * decides the units (editions/enterprise.ts), and the library's process body
 * boots them exactly as the shipped open-source server boots its own. A
 * config, verdict or composition failure rejects before anything listens
 * and before any logger is sure to exist, so it is reported on stderr in
 * the open-source entry's words, with exit code 1.
 */
import { runServer } from "@stigmer/server";

import { composeEnterprise } from "./enterprise.js";
import { readEnterpriseSettings } from "./enterprise-config.js";

/* v8 ignore start -- the process entry runs only as a process, never under vitest; composeEnterprise's and readEnterpriseSettings's own suites drive the verdict and the reading order */
runServer({
  extensions: (boot) => composeEnterprise(boot, readEnterpriseSettings()),
}).catch((error: unknown) => {
  console.error("boot failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
/* v8 ignore stop */
