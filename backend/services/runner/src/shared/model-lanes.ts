/**
 * Provider lanes: how a process that holds no provider credential still
 * calls a provider in direct mode.
 *
 * The agent host (`agent-host/host.ts`) runs the engines and holds none of
 * the runner's keys (#2016). On a runner that calls its providers directly
 * (a self-hosted runner, `STIGMER_PROXY_ENDPOINT` unset) the host's model
 * clients keep their direct-mode shape — the same backend SDK, the same
 * model-id translation, the same error wording — and only their transport
 * changes: each client's base URL is a lane of the runner's local proxy
 * (`agent-proxy/`), and its credential is the host's token. The lane checks
 * the token and the turn, adds the operator's key (or signs with the
 * runner's ambient cloud identity), and forwards to the provider; the
 * response comes back unchanged, so the SDK parses what it always parsed.
 *
 * In the runner itself no lanes are installed and nothing here changes a
 * client. On a runner that talks to the Stigmer platform's proxy the host
 * is a proxy-mode runner instead (`config.proxyEndpoint` is the local
 * proxy) and no lanes are installed either.
 */

/** The lanes one host process uses: the local proxy and the host's token there. */
export interface ModelLanes {
  readonly endpoint: string;
  readonly token: string;
}

/** Each provider's lane, under the local proxy. Anthropic's and OpenAI's are the platform proxy's own paths. */
export const MODEL_LANE_PATHS = {
  anthropic: "/v1/proxy/llm/anthropic",
  openai: "/v1/proxy/llm/openai/v1",
  bedrock: "/v1/proxy/llm/bedrock",
  vertex: "/v1/proxy/llm/vertex",
  foundry: "/v1/proxy/llm/foundry",
} as const;

export type ModelLane = keyof typeof MODEL_LANE_PATHS;

/**
 * The project id a lane-bound Vertex client puts in its path. The client
 * cannot resolve the real one (no Google identity in the host); the Vertex
 * lane replaces the project segment with the runner's.
 */
export const VERTEX_LANE_PROJECT = "stigmer-lane";

let installed: ModelLanes | undefined;

/** Route this process's direct-mode model clients through the lanes at `endpoint`. Called once, by the agent host. */
export function routeModelCallsThroughLanes(endpoint: string, token: string): void {
  installed = { endpoint: endpoint.replace(/\/+$/, ""), token };
}

/** The installed lanes, or `undefined` in a process that calls providers itself. */
export function modelLanes(): ModelLanes | undefined {
  return installed;
}

/** One lane's base URL. */
export function modelLaneUrl(lanes: ModelLanes, lane: ModelLane): string {
  return `${lanes.endpoint}${MODEL_LANE_PATHS[lane]}`;
}

/** Test-only: forget the installed lanes. */
export function resetModelLanesForTests(): void {
  installed = undefined;
}
