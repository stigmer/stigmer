// A stand-in for stigmer-server's ready-line contract, spawned by
// server-process.test.ts: it echoes the environment it was handed as a first
// stdout line (which the harness must skip), binds port 0 for each listener it
// was handed 0 for, and prints the ready line the server prints, or
// misbehaves in the one way FIXTURE_MODE names.
// Domain: test support (stack spawns).
//
// Modes: "report" (the server's behaviour), "split" (the ready line in two
// writes, apart in time), "wrong-port" (reports a gRPC port other than the
// fixed one it was handed), "unbound" (reports no artifact lane port),
// "exit" (a line on stderr, then exit code 3), and "silent" (binds and never
// reports).
import { createServer, type AddressInfo } from "node:net";

const mode = process.env.FIXTURE_MODE ?? "report";

process.stdout.write(
  `${JSON.stringify({
    env: {
      GRPC_PORT: process.env.GRPC_PORT,
      ARTIFACT_HTTP_PORT: process.env.ARTIFACT_HTTP_PORT,
      STIGMER_READY_LINE: process.env.STIGMER_READY_LINE,
    },
  })}\n`,
);

if (mode === "exit") {
  // exitCode, not exit(): pipe writes are asynchronous on macOS, and an
  // immediate exit could drop the line the test reads from the tail.
  process.stderr.write("fixture: refusing to boot\n");
  process.exitCode = 3;
} else {
  await serve();
}

async function serve(): Promise<void> {
  const grpcPort = await bind(Number(process.env.GRPC_PORT ?? "0"));
  const artifactHttpPort = await bind(Number(process.env.ARTIFACT_HTTP_PORT ?? "0"));
  const line = `${JSON.stringify({
    stigmerServerReady: {
      grpcPort: mode === "wrong-port" ? grpcPort + 1 : grpcPort,
      artifactHttpPort: mode === "unbound" ? null : artifactHttpPort,
    },
  })}\n`;

  if (mode === "split") {
    const half = Math.floor(line.length / 2);
    process.stdout.write(line.slice(0, half));
    setTimeout(() => process.stdout.write(line.slice(half)), 100);
  } else if (mode !== "silent") {
    process.stdout.write(line);
  }

  // Stays up, as a server does, until the harness stops it.
  setInterval(() => {}, 1_000);
}

// Binds port 0 and resolves the port it got, as the server's listeners do;
// a non-zero request is reported back unbound, because the harness, not the
// bind, is what is under test.
function bind(requested: number): Promise<number> {
  if (requested !== 0) return Promise.resolve(requested);
  return new Promise((resolveBound) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => resolveBound((server.address() as AddressInfo).port));
  });
}