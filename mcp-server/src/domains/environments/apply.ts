// Environment apply path: create-or-update via EnvironmentCommandController.apply.
// The flat MCP input is projected into a fully-formed Environment proto by the
// generated environmentInputToProto bridge (codegen, src/gen/environment.ts).
//
// Secret round-trip contract: a get → edit → apply loop is safe even when
// secrets are present. The server redacts secret values to ***REDACTED*** on
// read, and its update pipeline treats an echoed marker as "preserve the
// existing secret" — so callers only ever send real secret values when
// setting or rotating them.

import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { environmentInputToProto, type EnvironmentInput } from "../../gen/environment.js";
import { applyDeclaredVisibility } from "../apply-visibility.js";
import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** Create or update an environment, returning the persisted resource as protojson. */
export async function applyEnvironment(
  serverAddress: string,
  token: string,
  input: EnvironmentInput,
): Promise<string> {
  const environment = environmentInputToProto(input);
  const desc = `environment "${environment.metadata?.slug ?? ""}" in org "${environment.metadata?.org ?? ""}"`;
  return withClient(
    EnvironmentCommandController,
    serverAddress,
    token,
    async (client, callOptions) => {
      try {
        const applied = await client.apply(environment, callOptions);
        const result = await applyDeclaredVisibility(
          client,
          callOptions,
          applied,
          environment.metadata?.visibility ?? ApiResourceVisibility.api_resource_visibility_unspecified,
        );
        return toProtoJson(EnvironmentSchema, result);
      } catch (err) {
        throw rpcError(err, desc);
      }
    },
  );
}
