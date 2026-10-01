/**
 * The one line the process prints on request once it is listening: the
 * ports its listeners actually bound.
 *
 * A harness that spawns this server cannot hand it a free port without a
 * race. A port it probed and released is free for any other listener until
 * the child binds it, and on a busy run something else takes it
 * (stigmer#1469). So the harness passes port 0, the listeners bind
 * ephemeral ports, and this line tells it which ones they got. Because the
 * line is written only after both listeners are bound, it is also the
 * readiness signal, from this process and no other.
 *
 * It is opt-in (`STIGMER_READY_LINE=stdout`, boot/config.ts) because stdout
 * belongs to whoever runs the process: the logger writes stderr and leaves
 * stdout untouched, and an operator who did not ask for the line never sees
 * it.
 *
 * The line is one JSON object under one namespaced key, so a reader can pick
 * it out of anything else that ever lands on stdout. Its shape is a contract
 * with every reader (test/support/src/server-process.ts and
 * scripts/verify-boot.mjs): a renamed key or field fails their boots.
 *
 * Proven by __tests__/ready-line.test.ts, and on the built artifact by
 * scripts/verify-boot.mjs.
 */
import type { BoundPorts } from "./compose.js";

/** The line's one top-level key. */
export const READY_LINE_KEY = "stigmerServerReady";

/**
 * Writes the ready line through `write` when the operator asked for it, and
 * nothing otherwise. Ports that are still unknown when the line is due mean
 * the caller announced before start() resolved: a construction-order fault,
 * thrown rather than printed as a line naming no port.
 */
export function announceReady(
  readyLine: "stdout" | undefined,
  ports: BoundPorts | undefined,
  write: (line: string) => unknown,
): void {
  if (readyLine === undefined) return;
  if (ports === undefined) {
    throw new Error(
      "the ready line was requested before the server bound its ports",
    );
  }
  const report = {
    [READY_LINE_KEY]: {
      grpcPort: ports.grpc,
      artifactHttpPort: ports.artifactHttp ?? null,
    },
  };
  write(`${JSON.stringify(report)}\n`);
}
