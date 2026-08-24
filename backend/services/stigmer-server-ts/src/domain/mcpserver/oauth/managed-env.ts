/**
 * Managed-environment access — ports the slice of
 * pkg/domain/mcpserver/oauth/managed_env.go the agentexecution EC builder
 * consumes (#17): reading and rewriting OAuth token secrets through the
 * environment domain's in-process client, so encryption, validation, and
 * audit ride the environment pipeline automatically. The
 * create/delete-managed-environment halves arrive with the connect/OAuth
 * sub-project (#19), which owns the flows that mint managed environments.
 */
import { create } from "@bufbuild/protobuf";

import type { EnvironmentValue } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { UpdateEnvironmentVariablesRequest } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import {
  EnvironmentSecretValueInputSchema,
  UpdateEnvironmentVariablesRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

/** The label marking system-managed OAuth-token environments. */
export const MANAGED_ENV_LABEL = "stigmer.ai/managed";

/**
 * The narrow in-process environment surface this service consumes —
 * satisfied by the composition root's in-process clients (DD-002: full
 * interceptor traversal on every internal call).
 */
export interface ManagedEnvironmentClient {
  getSecretValue(
    input: MessageInitShape<typeof EnvironmentSecretValueInputSchema>,
  ): Promise<EnvironmentValue>;
  updateVariables(
    request: MessageInitShape<typeof UpdateEnvironmentVariablesRequestSchema>,
  ): Promise<Environment>;
}

export class ManagedEnvironmentService {
  constructor(private readonly client: ManagedEnvironmentClient) {}

  /**
   * Retrieves a single decrypted secret value from a managed environment
   * (Go ReadSecretValue).
   */
  async readSecretValue(environmentId: string, key: string): Promise<string> {
    let value: EnvironmentValue;
    try {
      value = await this.client.getSecretValue(
        create(EnvironmentSecretValueInputSchema, {
          environmentId,
          key,
        }),
      );
    } catch (error) {
      throw new Error(
        `failed to read secret ${JSON.stringify(key)} from managed environment ${environmentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return value.value;
  }

  /**
   * Writes secret variables into a managed environment (Go
   * UpdateSecrets). Values must be plaintext (never enc:vN:-prefixed —
   * the environment pipeline rejects ciphertext-shaped input, oss#395);
   * the pipeline encrypts is_secret values at rest (oss#405).
   */
  async updateSecrets(
    environmentId: string,
    variables: { [key: string]: EnvironmentValue },
  ): Promise<void> {
    try {
      await this.client.updateVariables(
        create(UpdateEnvironmentVariablesRequestSchema, {
          environmentId,
          variables,
        }),
      );
    } catch (error) {
      throw new Error(
        `failed to update secrets in managed environment ${environmentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
