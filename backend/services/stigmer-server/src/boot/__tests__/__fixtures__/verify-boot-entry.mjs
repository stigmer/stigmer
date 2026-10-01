// A stand-in for dist/main.js, booted by verify-boot.test.ts through
// scripts/verify-boot.mjs: it logs the NDJSON listening line the real server
// logs, prints a ready line shaped by FAKE_MODE, and exits 0 on SIGTERM as the
// real server's shutdown does.
//
// Modes: "ok" (the server's behaviour), "wrong-port" (a ready line naming a
// gRPC port other than the listening line's), "malformed" (a ready line whose
// artifact port is 0, which no listener binds).
const grpcPort = 40001;
const mode = process.env.FAKE_MODE ?? "ok";

// Before the ready line: verify-boot sends SIGTERM as soon as it reads it, and
// a signal that arrives before the handler takes Node's default action, a
// death by signal instead of the clean exit (seen in CI, 2026-10-01).
process.on("SIGTERM", () => process.exit(0));

process.stderr.write(
  `${JSON.stringify({ level: "info", message: "stigmer-server listening", port: grpcPort })}\n`,
);
const report = {
  grpcPort: mode === "wrong-port" ? grpcPort + 7 : grpcPort,
  artifactHttpPort: mode === "malformed" ? 0 : 40002,
};
process.stdout.write(`${JSON.stringify({ stigmerServerReady: report })}\n`);

setInterval(() => {}, 1_000);
