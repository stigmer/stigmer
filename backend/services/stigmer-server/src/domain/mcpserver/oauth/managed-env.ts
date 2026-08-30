/**
 * Managed-environment access — ports pkg/domain/mcpserver/oauth/
 * managed_env.go whole: reading and rewriting OAuth token secrets (#17's
 * EC-builder slice) plus creating and deleting the managed environments
 * themselves (#19's connect/OAuth slice). Every operation rides the
 * environment domain's in-process client, so encryption, validation, and
 * audit come from the environment pipeline automatically (DD-002: full
 * interceptor traversal on every internal call).
 */
import { create } from "@bufbuild/protobuf";

import type { EnvironmentValue } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { UpdateEnvironmentVariablesRequest } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import {
  EnvironmentSecretValueInputSchema,
  UpdateEnvironmentVariablesRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceDeleteInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

import type { Logger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";

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
  /**
   * `caller` propagates the ORIGINAL caller through the in-process hop
   * (ruling R5; Java createAsCaller — parity entry 20260830.05): the
   * created environment's owner attribution lands on the connecting
   * user, so it stays visible and manageable under an enforcing
   * Authorizer. Absent = the minted internal class (the pre-R5 shape,
   * kept for hops with no request caller).
   */
  create(
    environment: MessageInitShape<typeof EnvironmentSchema>,
    caller?: CallerIdentity,
  ): Promise<Environment>;
  delete(
    input: MessageInitShape<typeof ApiResourceDeleteInputSchema>,
  ): Promise<Environment>;
}

export class ManagedEnvironmentService {
  constructor(
    private readonly client: ManagedEnvironmentClient,
    private readonly logger: Logger,
  ) {}

  /**
   * Creates a new system-managed environment with the
   * stigmer.ai/managed=true label and returns its resource id (Go
   * CreateManagedEnvironment). The environment goes through the standard
   * create pipeline, which handles id generation, slug resolution,
   * timestamps, and search indexing. `caller` propagates the connecting
   * user through the hop (ruling R5, parity entry 20260830.05) so a
   * composed tuple-lifecycle driver attributes ownership to them — the
   * Java createAsCaller posture ("org link + owner = caller"); the
   * reserved-label guard keys its trust arm on the in-process ORIGIN,
   * so the managed label still passes with a propagated caller.
   */
  async createManagedEnvironment(
    name: string,
    org: string,
    caller?: CallerIdentity,
  ): Promise<string> {
    let created: Environment;
    try {
      created = await this.client.create(
        create(EnvironmentSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Environment",
          metadata: {
            name,
            org,
            labels: { [MANAGED_ENV_LABEL]: "true" },
          },
        }),
        caller,
      );
    } catch (error) {
      throw new Error(
        `failed to create managed environment: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const envId = created.metadata?.id ?? "";
    this.logger.info("Created managed environment for OAuth token storage", {
      environment_id: envId,
      name,
      org,
    });
    return envId;
  }

  /**
   * Deletes a managed environment and all its secrets (Go
   * DeleteManagedEnvironment). Non-fatal callers should catch errors —
   * the environment may already be deleted (concurrent disconnects or
   * partial-failure retries).
   */
  async deleteManagedEnvironment(environmentId: string): Promise<void> {
    try {
      await this.client.delete(
        create(ApiResourceDeleteInputSchema, { resourceId: environmentId }),
      );
    } catch (error) {
      throw new Error(
        `failed to delete managed environment ${environmentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.logger.info("Deleted managed environment", {
      environment_id: environmentId,
    });
  }

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
