/**
 * Connect-status bookkeeping and result persistence — ports the
 * persistence family shared by all three connect lanes:
 * persistConnectResult / settleConnectStatus / convertToDiscovered-
 * Capabilities (connect.go:733-889) and persistConnectStarting /
 * persistConnectFailure
 * (start_connect.go:212-285). One module because these helpers are the
 * shared bookkeeping BOTH connect.ts and start-connect.ts consume — Go's
 * single package makes the split invisible; in ESM this placement keeps
 * the handler modules cycle-free.
 *
 * Proven by mcpserver-connect.conformance.test.ts
 * (CONFORMANCE_TARGET=local-execution).
 */
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import type { ConnectError } from "@connectrpc/connect";

import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type {
  DiscoveredCapabilities,
  McpServerStatus,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import {
  ConnectPhase,
  ConnectStatusSchema,
  DiscoveredCapabilitiesSchema,
  DiscoveredResourceTemplateSchema,
  DiscoveredToolSchema,
  McpServerStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { grpcCodeName } from "../../pipeline/errors.js";
import type { Store } from "../../store/interface.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { ConnectWorkflowOutput } from "./engine.js";

/**
 * Converts the workflow output to the proto DiscoveredCapabilities
 * message (Go convertToDiscoveredCapabilities).
 *
 * protobuf-es represents google.protobuf.Struct fields as JsonObject, so
 * the runner's schema object assigns directly — Go's soft
 * structpb.NewStruct error arm has no TS equivalent (the value arrived
 * through JSON and is representable by construction).
 *
 * destructive_hint is the server author's own annotation, carried as the
 * runner read it: true only for an explicit `destructiveHint: true`. The
 * approval default asks before such a tool, so a missing or non-boolean
 * value persists as false rather than guessing.
 *
 * Watch item (oss#862): Go persists the Struct with
 * SORTED JSON keys while this path keeps the runner's insertion order —
 * the runner's reconnect signature compares stringified schemas, so
 * ordering feeds the filed carry-forward defect. The conformance suite
 * pins only the wire-stable contract (capabilities + gates survive
 * reconnect), which both orderings satisfy.
 */
export function convertToDiscoveredCapabilities(
  output: ConnectWorkflowOutput,
): DiscoveredCapabilities {
  const capabilities = create(DiscoveredCapabilitiesSchema, {
    lastDiscoveredAt: timestampNow(),
  });

  for (const t of output.tools ?? []) {
    const tool = create(DiscoveredToolSchema, {
      name: t.name ?? "",
      description: t.description ?? "",
      destructiveHint: t.destructiveHint === true,
    });
    if (t.input_schema !== undefined) {
      tool.inputSchema = t.input_schema as JsonObject;
    }
    capabilities.tools.push(tool);
  }

  for (const rt of output.resource_templates ?? []) {
    capabilities.resourceTemplates.push(
      create(DiscoveredResourceTemplateSchema, {
        uriTemplate: rt.uri_template ?? "",
        name: rt.name ?? "",
        description: rt.description ?? "",
        mimeType: rt.mime_type ?? "",
      }),
    );
  }

  return capabilities;
}

/**
 * Records the terminal phase of a connect operation on the status,
 * preserving the start-time fields (started_at) the starting lane
 * recorded (Go settleConnectStatus). failure is the mapped gRPC error for
 * a failed operation, undefined for success; its code and message land
 * verbatim on the status so polling clients render the same
 * classification blocking callers get as an RPC error.
 *
 * The start-time warning is cleared either way: it is a CONNECTING-phase
 * advisory ("no worker appears to be polling"), and a settled operation
 * has disproven it.
 */
export function settleConnectStatus(
  mcpStatus: McpServerStatus,
  workflowId: string,
  failure: ConnectError | undefined,
): void {
  let cs = mcpStatus.connectStatus;
  if (cs === undefined) {
    // The operation was started by a lane that could not record
    // CONNECTING (a failed best-effort status write, or a legacy
    // in-flight run from before this field existed). Settle with what is
    // known.
    cs = create(ConnectStatusSchema);
    mcpStatus.connectStatus = cs;
  }
  cs.workflowId = workflowId;
  cs.finishedAt = timestampNow();
  cs.warning = "";
  if (failure === undefined) {
    cs.phase = ConnectPhase.succeeded;
    cs.failureCode = "";
    cs.failureMessage = "";
    return;
  }
  cs.phase = ConnectPhase.failed;
  cs.failureCode = grpcCodeName(failure.code);
  cs.failureMessage = failure.rawMessage;
}

/**
 * Writes the connect workflow's output onto the McpServer status as a
 * single atomic read-modify-write, returning the updated resource (Go
 * persistConnectResult).
 *
 * This is the one place connect output lands on the resource — the
 * blocking Connect path, the async StartConnect path, and the best-effort
 * auto-connect path all route through it. The atomic updateResource is
 * deliberate: the background writes can land long after the triggering
 * RPC returned, so a plain read-modify-write would risk clobbering a
 * concurrent update (a manual reconnect or an edit) made in that window.
 *
 * discovered_capabilities is a point-in-time snapshot, overwritten on
 * every connect, destructive_hint included: the annotation is the
 * server's current word, so a tool its author stops marking destructive
 * stops asking after the next connect. The connect_status settle rides the
 * same atomic write so pollers can never observe results without the
 * terminal phase (or vice versa).
 *
 * Throws ResourceNotFoundError if the resource was deleted between the
 * connect trigger and its completion (a real case for the background
 * paths); callers decide how to react.
 */
export async function persistConnectResult(
  store: Store,
  mcpServerId: string,
  workflowId: string,
  output: ConnectWorkflowOutput,
): Promise<McpServer> {
  return store.updateResource(
    ApiResourceKind.mcp_server,
    mcpServerId,
    McpServerSchema,
    (mcpServer) => {
      if (mcpServer.status === undefined) {
        mcpServer.status = create(McpServerStatusSchema);
      }
      mcpServer.status.discoveredCapabilities =
        convertToDiscoveredCapabilities(output);
      settleConnectStatus(mcpServer.status, workflowId, undefined);
    },
  );
}

/**
 * Records a freshly started connect operation as the resource's
 * connect_status (phase CONNECTING), replacing whatever previous
 * operation's record was there (Go persistConnectStarting). Returns the
 * updated resource — the payload StartConnect answers with.
 */
export async function persistConnectStarting(
  store: Store,
  mcpServerId: string,
  workflowId: string,
  warning: string,
): Promise<McpServer> {
  return store.updateResource(
    ApiResourceKind.mcp_server,
    mcpServerId,
    McpServerSchema,
    (mcpServer) => {
      if (mcpServer.status === undefined) {
        mcpServer.status = create(McpServerStatusSchema);
      }
      mcpServer.status.connectStatus = create(ConnectStatusSchema, {
        phase: ConnectPhase.connecting,
        workflowId,
        startedAt: timestampNow(),
        warning,
      });
    },
  );
}

/**
 * Settles connect_status as FAILED with the mapped gRPC classification of
 * the given error (Go persistConnectFailure). Never propagates its own
 * failure: every caller has already surfaced the connect failure on its
 * own channel (RPC error or log), and a resource deleted mid-operation is
 * expected.
 */
export async function persistConnectFailure(
  store: Store,
  logger: Logger,
  mcpServerId: string,
  failure: ConnectError,
): Promise<void> {
  try {
    await store.updateResource(
      ApiResourceKind.mcp_server,
      mcpServerId,
      McpServerSchema,
      (mcpServer) => {
        if (mcpServer.status === undefined) {
          mcpServer.status = create(McpServerStatusSchema);
        }
        settleConnectStatus(
          mcpServer.status,
          mcpServer.status.connectStatus?.workflowId ?? "",
          failure,
        );
      },
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      logger.info(
        "Skipping connect failure persistence: MCP server deleted before connect settled",
        { mcp_server_id: mcpServerId },
      );
      return;
    }
    logger.warn(
      "Failed to record connect failure on connect_status (non-fatal)",
      {
        mcp_server_id: mcpServerId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}
