// The hermetic OIDC issuer as a PROCESS (20260913.02 sp.console-login,
// Q-CL-7). Domain: conformance harness.
//
// The e2e package needs the same issuer the conformance suite uses, but it
// never imports across test packages: this package has no `exports` map,
// the e2e package does not depend on it, and Playwright's transpiler is not
// this package's. So the e2e global setup spawns this script the way it
// spawns `temporal` and the server, and reads the issuer URL from stdout.
//
//   npx tsx test/conformance/src/harness/local-oidc-issuer-main.ts \
//     --port 7299 --audience https://e2e.stigmer.test/api --end-session
//
// Prints one JSON line — `{ issuer, audience, person }` — once listening,
// then serves until SIGTERM/SIGINT.
import { parseArgs } from "node:util";

import { startLocalOidcIssuer } from "./local-oidc-issuer";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      port: { type: "string" },
      audience: { type: "string" },
      "end-session": { type: "boolean", default: false },
    },
  });
  const port = values.port !== undefined ? Number(values.port) : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`--port must be a TCP port, got ${String(values.port)}`);
  }
  const issuer = await startLocalOidcIssuer({
    port,
    ...(values.audience !== undefined ? { audience: values.audience } : {}),
    endSession: values["end-session"],
  });
  process.stdout.write(
    JSON.stringify({
      issuer: issuer.issuer,
      audience: issuer.audience,
      person: issuer.person,
    }) + "\n",
  );
  const stop = (): void => {
    void issuer.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
