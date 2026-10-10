/**
 * The child `agent-host/__tests__/spawned-host.test.ts` spawns: a real
 * agent host on fd 3 (`agent-host/host.ts` `serveAgentHost` over the
 * production stream channel), serving one probe adapter in place of an
 * engine, so the test drives the real supervisor, the real pipe and the
 * real remote adapter against a process it can kill.
 *
 * The probe's turn is named by the turn's user message:
 *
 *  - `say`: fold one assistant message, persist it (awaited), report one
 *    usage delta, and complete;
 *  - `hang`: report activity `parked` once, then wait for the stop signal and
 *    settle `interrupted`, as an engine stopped mid-step does;
 *  - `deaf`: report activity `parked`, then never settle, stop or not: an
 *    engine wedged past its stop, which only the host's death ends;
 *  - `throw`: fold one assistant message, then throw: the contract
 *    violation the runtime must still see, over the rows folded before it.
 *
 * Arms (argv[2]): `serve` serves; `stale` announces a protocol version no
 * runner speaks and serves nothing, the mismatched build the runner refuses.
 * The process exits when its channel closes, as the host entry does.
 */

import { Socket } from "node:net";

import { streamChannel } from "../agent-host/channel.js";
import { serveAgentHost } from "../agent-host/host.js";
import { AGENT_HOST_CHANNEL_FD, AGENT_HOST_PROTOCOL_VERSION } from "../agent-host/protocol.js";
import { DEEP_AGENT_CAPABILITIES } from "../activities/execute-deep-agent/deep-agent-capabilities.js";
import type { HarnessAdapter, TurnInput, TurnOutcome, TurnSink } from "../harness/types.js";

const probe: HarnessAdapter = {
  name: "probe",
  capabilities: DEEP_AGENT_CAPABILITIES,
  boot: async () => {},
  shutdown: async () => {},
  releaseSession: async () => {},
  async runTurn(input: TurnInput, sink: TurnSink): Promise<TurnOutcome> {
    const command = input.execution.spec?.message ?? "";
    switch (command) {
      case "say":
        sink.transcript.apply({ kind: "message_start", runId: "probe-run" });
        sink.transcript.apply({ kind: "text_delta", runId: "probe-run", text: "probe says hello" });
        sink.transcript.apply({ kind: "message_finish", runId: "probe-run" });
        await sink.requestPersist();
        sink.reportUsage({ inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.001, model: "probe-model" });
        return { kind: "completed" };
      case "hang":
        sink.recordActivity("parked");
        await new Promise<void>((resolve) => {
          if (sink.stopSignal.aborted) resolve();
          else sink.stopSignal.addEventListener("abort", () => resolve(), { once: true });
        });
        return { kind: "interrupted" };
      case "deaf":
        sink.recordActivity("parked");
        return new Promise<TurnOutcome>(() => {});
      case "throw":
        sink.transcript.apply({ kind: "message_start", runId: "probe-run" });
        sink.transcript.apply({ kind: "text_delta", runId: "probe-run", text: "before the break" });
        throw new Error("probe broke its contract");
      default:
        return { kind: "failed", surface: "internal", message: `probe: unknown command '${command}'` };
    }
  },
};

const socket = new Socket({ fd: AGENT_HOST_CHANNEL_FD, readable: true, writable: true });
const channel = streamChannel(socket, socket);

if (process.argv[2] === "stale") {
  channel.send(JSON.stringify({ kind: "hello", protocolVersion: AGENT_HOST_PROTOCOL_VERSION + 1 }));
  channel.onClose(() => process.exit(0));
} else {
  const server = serveAgentHost(channel, [{ harness: "deep-agent", adapter: probe }]);
  void server.closed.then(() => process.exit(0));
}
