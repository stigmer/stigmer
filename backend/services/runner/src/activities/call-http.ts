/**
 * CallHTTP Temporal activity — executes HTTP requests for workflow
 * `call: http` tasks.
 *
 * Runs OUTSIDE the Temporal workflow sandbox. Performs network I/O
 * using Node.js built-in `fetch()`.
 *
 * Error classification drives Temporal retry behavior:
 * - 4xx / 3xx → non-retryable (client error, won't fix itself)
 * - 5xx → retryable (server error, may recover)
 * - Network errors → retryable (transient)
 *
 * Activity contract:
 *   Name:   "CallHttp"
 *   Input:  (config: HttpCallConfig, runtimeEnv: Record<string, unknown>)
 *   Output: unknown (parsed response content, full response, or raw bytes)
 */

import { ApplicationFailure } from "@temporalio/activity";
import type { HttpCallConfig, EndpointDef } from "../workflow-engine/types.js";
import {
  resolveObjectPlaceholders,
} from "../workflow-engine/resolve.js";
import { startHeartbeat } from "../shared/heartbeat.js";

export interface HttpResponse {
  readonly request: {
    readonly method: string;
    readonly uri: string;
    readonly headers: Record<string, string>;
  };
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly content: unknown;
}

function injectBaggageHeaders(
  headers: Record<string, string>,
  env: Record<string, unknown>,
): void {
  const parts: string[] = [];
  const execId = env["__stigmer_execution_id"];
  const orgId = env["__stigmer_org_id"];
  if (execId) parts.push(`stigmer.execution_id=${execId}`);
  if (orgId) parts.push(`stigmer.org_id=${orgId}`);
  if (parts.length > 0 && !headers["baggage"]) {
    headers["baggage"] = parts.join(",");
  }
}

function resolveEndpointUri(endpoint: EndpointDef): string {
  if (typeof endpoint === "string") return endpoint;
  return endpoint.uri;
}

function buildQueryString(query: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    params.append(key, value);
  }
  return params.toString();
}

export async function callHttpAction(
  config: HttpCallConfig,
  runtimeEnv: Record<string, unknown>,
): Promise<unknown> {
  const resolved = resolveObjectPlaceholders(config, runtimeEnv) as HttpCallConfig;

  const method = resolved.method.toUpperCase();
  let uri = resolveEndpointUri(resolved.endpoint);

  if (resolved.query && Object.keys(resolved.query).length > 0) {
    const qs = buildQueryString(resolved.query);
    uri += (uri.includes("?") ? "&" : "?") + qs;
  }

  const headers: Record<string, string> = { ...resolved.headers };

  injectBaggageHeaders(headers, runtimeEnv);

  let body: string | undefined;
  if (resolved.body !== undefined && resolved.body !== null) {
    if (typeof resolved.body === "string") {
      body = resolved.body;
    } else {
      body = JSON.stringify(resolved.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
    body,
  };

  if (resolved.redirect === "false" || resolved.redirect === false as unknown) {
    fetchOptions.redirect = "manual";
  }

  let response: Response;
  try {
    response = await fetch(uri, fetchOptions);
  } catch (err: unknown) {
    throw new Error(
      `HTTP ${method} ${uri} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const statusCode = response.status;

  if (statusCode >= 300 && statusCode < 400) {
    throw ApplicationFailure.nonRetryable(
      `HTTP ${method} ${uri} returned redirect ${statusCode}`,
      "HTTP_REDIRECT",
      { statusCode },
    );
  }

  if (statusCode >= 400 && statusCode < 500) {
    const errorBody = await response.text().catch(() => "");
    throw ApplicationFailure.nonRetryable(
      `HTTP ${method} ${uri} returned ${statusCode}: ${errorBody.slice(0, 500)}`,
      "HTTP_CLIENT_ERROR",
      { statusCode, body: errorBody.slice(0, 2000) },
    );
  }

  if (statusCode >= 500) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${method} ${uri} returned ${statusCode}: ${errorBody.slice(0, 500)}`,
    );
  }

  const outputMode = resolved.output ?? "content";

  if (outputMode === "raw") {
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  }

  const responseText = await response.text();
  let content: unknown;
  try {
    content = JSON.parse(responseText);
  } catch {
    content = responseText;
  }

  if (outputMode === "response") {
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      request: { method, uri, headers },
      statusCode,
      headers: responseHeaders,
      content,
    } satisfies HttpResponse;
  }

  return content;
}

export function createCallHttpActivities() {
  return {
    CallHttp: async (
      config: HttpCallConfig,
      runtimeEnv: Record<string, unknown>,
    ): Promise<unknown> => {
      const hb = startHeartbeat(10_000, () => ({ phase: "http_call" }));
      try {
        return await callHttpAction(config, runtimeEnv);
      } finally {
        hb.stop();
      }
    },
  };
}
