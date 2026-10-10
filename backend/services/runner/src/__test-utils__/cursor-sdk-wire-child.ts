/**
 * The agent host's side of the Cursor wire, as its own process: the real
 * `@cursor/sdk`, the runner's Cursor interceptors bound to the local
 * proxy's Cursor lane with the host's token, trusting the lane only through
 * the `NODE_EXTRA_CA_CERTS` it was started with
 * (`agent-proxy/__tests__/cursor-sdk-wire.test.ts` starts it).
 *
 * argv: the lane's endpoint, the host token, the execution id. It creates
 * one local agent, sends one prompt, and prints one JSON line: the run's
 * result (or the error), and what `NODE_TLS_REJECT_UNAUTHORIZED` reads
 * afterwards.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installFetchInterceptor } from "../activities/execute-cursor/fetch-interceptor.js";
import { assertHttp2ConnectPatched, installHttp2Interceptor } from "../activities/execute-cursor/http2-interceptor.js";
import { runWithExecutionContext } from "../shared/execution-context.js";

const [lane = "", token = "", executionId = ""] = process.argv.slice(2);
const proxyTokenRef = { current: token };
installFetchInterceptor({ proxyEndpoint: lane, proxyTokenRef });
installHttp2Interceptor({ proxyEndpoint: lane, proxyTokenRef });
await assertHttp2ConnectPatched();
const { Agent } = await import("@cursor/sdk");

const outcome = await runWithExecutionContext(executionId, async () => {
  try {
    const agent = await Agent.create({
      apiKey: token,
      model: { id: "composer-2.5", params: [] },
      local: { cwd: mkdtempSync(join(tmpdir(), "cursor-sdk-wire-")), enableAgentRetries: false },
    });
    const run = await agent.send("hello");
    const result = await run.wait();
    return { status: result.status, error: result.error?.message ?? null };
  } catch (err) {
    return { status: "thrown", error: err instanceof Error ? err.message : String(err) };
  }
});
console.log(`WIRE ${JSON.stringify({ ...outcome, tlsRejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? null })}`);
process.exit(0);
