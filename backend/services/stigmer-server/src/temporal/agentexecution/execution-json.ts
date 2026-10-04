/**
 * Decodes the AgentExecution the workflow loads through its local
 * activity, tolerating names the current contract no longer knows.
 *
 * A local activity's result is recorded in Temporal history and replayed
 * from it, so an execution in flight across a deploy is decoded from JSON
 * an older server wrote. When a release reserves a field or an enum value
 * (approval_policy_source's per-tool policy values, for one), that JSON
 * still carries the old name, and a strict decode would fail the replayed
 * workflow on its callback path. The load is a read of the record, never a
 * write, so an unknown field or enum name is dropped: the enum reads as its
 * zero value, exactly as a stored row decodes.
 *
 * Bundle-safe: imported by the workflow.
 */
import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

export function decodeLoadedExecution(raw: JsonValue): AgentExecution {
  return fromJson(AgentExecutionSchema, raw, { ignoreUnknownFields: true });
}
