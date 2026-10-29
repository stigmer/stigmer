// Anthropic's own SDK, pointed at the server under test: the client the
// Managed Agents lane is claimed for, and what the lane's answers must equal.
// Domain: conformance support (agentic / session, the Managed Agents wire).
//
// The suite drives the lane with `@anthropic-ai/sdk` at the exact version
// the claim names (test/conformance/package.json; the root guard
// scripts/managed-agents-claim.test.mjs holds every copy equal), because the
// SDK is the outside spec's client: what it sends and parses IS the wire.
// Every value the facets read is typed by the SDK's own types, so `tsc`
// holds the suites to them, and every event the lane serves must deep-equal
// the Stigmer harness's log's event rendered by `toManagedAgentsJson`, which the
// session-log shape test proves against the same types: lane = renderer =
// SDK.
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaManagedAgentsSessionEvent,
  BetaManagedAgentsStreamSessionEvents,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import type { Stream } from "@anthropic-ai/sdk/core/streaming";
import { isStigmerEventType, toManagedAgentsJson } from "@stigmer/session-log";
import type { JsonObject } from "@bufbuild/protobuf";
import type { ConformanceClients } from "../harness/clients";

// How the SDK presents its credential: `apiKey` sends X-Api-Key (its
// default), `authToken` sends Authorization: Bearer.
export type ManagedAgentsCredential = { readonly apiKey: string } | { readonly authToken: string };

// Anthropic's SDK at `baseUrl` with the given credential. Retries stay the
// SDK's defaults: an unchanged program is the claim.
export function managedAgentsClient(baseUrl: string, credential: ManagedAgentsCredential): Anthropic {
  return "apiKey" in credential
    ? new Anthropic({ baseURL: baseUrl, apiKey: credential.apiKey, authToken: null })
    : new Anthropic({ baseURL: baseUrl, authToken: credential.authToken, apiKey: null });
}

// The session's whole log as the lane must serve it: the native events,
// Managed Agents types only, each rendered as Managed Agents JSON.
export async function stigmerAsManagedAgents(
  clients: ConformanceClients,
  sessionId: string,
  runId?: string,
): Promise<JsonObject[]> {
  const { events } = await clients.sessionQuery.listEvents({ sessionId, pageSize: 1000, ...(runId === undefined ? {} : { runId }) });
  return events.map(toManagedAgentsJson).filter((event) => !isStigmerEventType(String(event["type"])));
}

// Every event of the session through the SDK's own pager.
export async function listAll(
  client: Anthropic,
  sessionId: string,
  params: Parameters<Anthropic["beta"]["sessions"]["events"]["list"]>[1] = {},
): Promise<BetaManagedAgentsSessionEvent[]> {
  const all: BetaManagedAgentsSessionEvent[] = [];
  for await (const event of client.beta.sessions.events.list(sessionId, params)) {
    all.push(event);
  }
  return all;
}

// A stream's events, read in the background until `done` says so or the
// deadline passes; `stop` closes the stream (the SDK aborts its request).
export function collectUntil(
  stream: Stream<BetaManagedAgentsStreamSessionEvents>,
  done: (seen: ReadonlyArray<BetaManagedAgentsStreamSessionEvents>) => boolean,
  timeoutMs = 60_000,
): Promise<BetaManagedAgentsStreamSessionEvents[]> {
  const seen: BetaManagedAgentsStreamSessionEvents[] = [];
  const read = (async () => {
    for await (const event of stream) {
      seen.push(event);
      if (done(seen)) {
        stream.controller.abort();
        return seen;
      }
    }
    throw new Error(`the stream ended before it was done; saw ${JSON.stringify(seen.map((e) => e.type))}`);
  })();
  const deadline = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      stream.controller.abort();
      reject(new Error(`the stream was not done within ${timeoutMs}ms; saw ${JSON.stringify(seen.map((e) => e.type))}`));
    }, timeoutMs);
    void read.finally(() => clearTimeout(timer)).catch(() => undefined);
  });
  return Promise.race([read, deadline]);
}

// Whether a stream event is a session.status_idle with the given stop reason.
export function isIdleWith(event: BetaManagedAgentsStreamSessionEvents, reason: string): boolean {
  return event.type === "session.status_idle" && event.stop_reason.type === reason;
}

// The events of a stream, previews (event_start, event_delta) left out.
export function storedOf(events: ReadonlyArray<BetaManagedAgentsStreamSessionEvents>): BetaManagedAgentsStreamSessionEvents[] {
  return events.filter((event) => event.type !== "event_start" && event.type !== "event_delta");
}
