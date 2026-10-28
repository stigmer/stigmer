/**
 * The network error under a failed MCP connect, found again and logged
 * beside it, so the runner's log names it (a reset, a name that did not
 * resolve, a refused connect) instead of only "fetch failed".
 *
 * Why it is lost: `@langchain/mcp-adapters` 1.x builds its connect error from
 * the transport's error as a string (`Failed to connect … TypeError: fetch
 * failed`) and keeps no `cause`, so undici's own error under the `TypeError`
 * is gone before the runner sees the throw. Its 2.x keeps the cause, but is a
 * migration of its own (tool names, MCP SDK 2, result shapes); once the
 * runner is on it, this module is removable.
 *
 * How it is found, by identity: the MCP SDK's HTTP transport calls the global
 * `fetch`, and Node's fetch reports every request on the diagnostics
 * channels `undici:request:create` and `undici:request:error`, with the same
 * request object on both. A connect runs inside an `AsyncLocalStorage` scope
 * holding its capture; a request created inside it is tagged with that
 * capture, and its error is recorded there with the request's URL. One host
 * serves several turns at once, and their servers share origins (the
 * platform's own), so the request object is the identity, never an origin or
 * a time window. The channels only observe: no global `fetch` or dispatcher
 * is replaced.
 *
 * What is logged: for a connect that rejects with an error carrying no cause
 * and naming its server in a string `serverName` (the adapter's own field;
 * its error class is not exported), the first recorded error of a request to
 * that server's configured URL, as one line naming the server and the turn's
 * execution, which the failed turn's own line (`harness/run-turn.ts`) names
 * too. The error is rethrown untouched. It is not given the network error as
 * its `cause`: the engines word a thrown error for the user by its ROOT
 * (`model-error.ts` `describeExecutionError`), so a cause would replace the
 * adapter's message, which names the server and its URL, with the bare
 * network error ("read ECONNRESET").
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { subscribe } from "node:diagnostics_channel";

import { describeCauseChain } from "./error-chain.js";
import { getExecutionContext } from "./execution-context.js";

/** The most network errors one connect records; a connect makes a handful of requests. */
const MAX_RECORDED_PER_CONNECT = 32;

const REQUEST_CREATE_CHANNEL = "undici:request:create";
const REQUEST_ERROR_CHANNEL = "undici:request:error";

interface RecordedError {
  readonly url: string;
  readonly error: Error;
}

interface Capture {
  open: boolean;
  readonly recorded: RecordedError[];
}

/** Undici's request as its channels report it: the fields read here, read by shape. */
interface UndiciRequest {
  readonly origin?: unknown;
  readonly path?: unknown;
}

const currentCapture = new AsyncLocalStorage<Capture>();
const captureOfRequest = new WeakMap<object, Capture>();
let subscribed = false;

function requestOf(message: unknown): object | undefined {
  const request = (message as { request?: unknown } | null)?.request;
  return typeof request === "object" && request !== null ? request : undefined;
}

/** A URL as fetch sends it: origin, path and query, no fragment; undefined when it does not parse. */
function requestUrlOf(href: string, base?: string): string | undefined {
  try {
    const url = new URL(href, base);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function onRequestCreate(message: unknown): void {
  const capture = currentCapture.getStore();
  const request = requestOf(message);
  if (capture === undefined || !capture.open || request === undefined) return;
  captureOfRequest.set(request, capture);
}

function onRequestError(message: unknown): void {
  const request = requestOf(message);
  const capture = request === undefined ? undefined : captureOfRequest.get(request);
  if (request === undefined || capture === undefined || !capture.open) return;
  const error = (message as { error?: unknown }).error;
  const { origin, path } = request as UndiciRequest;
  if (!(error instanceof Error) || typeof origin !== "string" || typeof path !== "string") return;
  const url = requestUrlOf(path, origin);
  if (url === undefined || capture.recorded.length >= MAX_RECORDED_PER_CONNECT) return;
  capture.recorded.push({ url, error });
}

function subscribeOnce(): void {
  if (subscribed) return;
  subscribe(REQUEST_CREATE_CHANNEL, onRequestCreate);
  subscribe(REQUEST_ERROR_CHANNEL, onRequestError);
  subscribed = true;
}

function serverNameOf(err: unknown): string | undefined {
  const serverName = (err as { serverName?: unknown } | null)?.serverName;
  return typeof serverName === "string" ? serverName : undefined;
}

/** Log the network error under `err` from `capture`, when `err` names an HTTP server and has no cause of its own. */
function logNetworkError(err: unknown, capture: Capture, serverUrls: ReadonlyMap<string, string>): void {
  if (!(err instanceof Error) || err.cause !== undefined) return;
  const serverName = serverNameOf(err);
  const configured = serverName === undefined ? undefined : serverUrls.get(serverName);
  const serverUrl = configured === undefined ? undefined : requestUrlOf(configured);
  if (serverName === undefined || serverUrl === undefined) return;
  const found = capture.recorded.find((recorded) => recorded.url === serverUrl);
  if (found === undefined) return;
  const executionId = getExecutionContext().getStore()?.executionId;
  console.error(
    `[MCP] Server '${serverName}' did not connect: ` +
      (executionId !== undefined ? `execution=${executionId}, ` : "") +
      `network=${describeCauseChain(found.error)}`,
  );
}

/**
 * Run `connect` (an MCP client's `initializeConnections`) with its requests'
 * network errors recorded, and log the network error under its rejection
 * (the header). `serverUrls` maps each HTTP server's name, as the client was
 * configured, to its URL.
 */
export async function withNetworkErrorCapture<T>(serverUrls: ReadonlyMap<string, string>, connect: () => Promise<T>): Promise<T> {
  subscribeOnce();
  const capture: Capture = { open: true, recorded: [] };
  try {
    return await currentCapture.run(capture, connect);
  } catch (err) {
    logNetworkError(err, capture, serverUrls);
    throw err;
  } finally {
    // A request the connect left running (a reconnect, a stream) is not this connect's.
    capture.open = false;
  }
}
