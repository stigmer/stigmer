/**
 * The caller's personal environment as a source of DECLARED variables: the
 * one lookup that answers "which of these declared keys does the person
 * have saved" for every lane that runs a tool on the person's behalf.
 *
 * Two lanes need it and must agree on it. The MCP connect lane (the
 * discovery run a person triggers from the console) resolves a server's
 * declared variables here when no one-time runtime_env was supplied; the
 * agent-execution ExecutionContext build resolves a SESSION-level MCP
 * server's declared variables here when the merge chain did not carry them,
 * because a session's own servers ride no agent instance and so have no
 * environment_refs of their own. Before the build learned this rule a key
 * saved through the console's "save for future" reached the connect lane
 * and never the run.
 *
 * Least privilege by construction: only the keys the caller declares are
 * read, one GetSecretValue per key; nothing here layers a whole
 * environment onto anything. What a missing personal environment or a
 * missing required key MEANS is the caller's to decide — connect refuses
 * (a person asked to connect and cannot without the credential), the
 * build warns (the run fails at the tool with a clearer error) — so both
 * outcomes are returned as values, never thrown. A failing list read is
 * the one infrastructure fault, thrown as Internal.
 *
 * Proven by __tests__/personal.test.ts; the connect lane's wire copy over
 * these outcomes by mcpserver/__tests__/connect.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";

import type { EnvironmentList } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type {
  EnvironmentSecretValueInputSchema,
  ListEnvironmentsRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type {
  EnvVarDeclaration,
  EnvironmentValue,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";

import type { Logger } from "../../boot/logger.js";
import { internalError } from "../../pipeline/errors.js";
import { PERSONAL_LABEL_KEY, PERSONAL_LABEL_VALUE } from "./constants.js";

/**
 * The narrow environment read surface this lookup consumes: the list RPC
 * (to find the personal environment by its label) and the secret read
 * (decrypted; the ordinary Environment surface redacts, oss#405). Both
 * consuming domains' in-process edges already satisfy it.
 */
export interface PersonalEnvironmentReader {
  list(
    request: MessageInitShape<typeof ListEnvironmentsRequestSchema>,
  ): Promise<EnvironmentList>;
  getSecretValue(
    input: MessageInitShape<typeof EnvironmentSecretValueInputSchema>,
  ): Promise<EnvironmentValue>;
}

/** What the lookup found; the caller decides what each outcome means. */
export type PersonalEnvironmentResolution =
  | { readonly kind: "no-personal-environment" }
  | {
      readonly kind: "resolved";
      /** The declared keys the personal environment held, as execution values. */
      readonly values: { readonly [key: string]: ExecutionValue };
      /**
       * The REQUIRED declared keys the personal environment did not hold
       * (absent, unreadable, or empty). Optional keys never appear here.
       */
      readonly missing: readonly string[];
    };

/**
 * Resolves the given declarations against the caller's personal
 * environment in `org`. A declaration's `is_secret` rides onto the value;
 * a declared key the environment lacks is skipped when optional and
 * reported in `missing` when required. A secret read that fails is logged
 * and treated as absent, the same way for both lanes.
 */
export async function resolveDeclaredFromPersonalEnvironment(
  reader: PersonalEnvironmentReader,
  logger: Logger,
  org: string,
  declarations: { readonly [key: string]: EnvVarDeclaration },
): Promise<PersonalEnvironmentResolution> {
  let listResponse: EnvironmentList;
  try {
    listResponse = await reader.list({
      org,
      labels: { [PERSONAL_LABEL_KEY]: PERSONAL_LABEL_VALUE },
    });
  } catch (error) {
    throw internalError(error, "failed to list personal environments");
  }
  if (listResponse.totalCount === 0 || listResponse.items.length === 0) {
    return { kind: "no-personal-environment" };
  }

  const personalEnv = listResponse.items[0];
  const personalEnvId = personalEnv?.metadata?.id ?? "";
  // The stored keys are present even when their values are redacted, so
  // existence is checkable before the secret read. Own-key membership
  // (never the prototype chain): an exotic key name must not read as held.
  const stored = personalEnv?.spec?.data ?? {};

  const values: { [key: string]: ExecutionValue } = {};
  const missing: string[] = [];
  for (const [key, decl] of Object.entries(declarations)) {
    if (!Object.hasOwn(stored, key)) {
      if (!decl.optional) missing.push(key);
      continue;
    }
    let secretValue: EnvironmentValue;
    try {
      secretValue = await reader.getSecretValue({
        environmentId: personalEnvId,
        key,
      });
    } catch (error) {
      logger.warn("Failed to get secret value from personal environment", {
        key,
        personal_env_id: personalEnvId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!decl.optional) missing.push(key);
      continue;
    }
    if (secretValue.value === "") {
      if (!decl.optional) missing.push(key);
      continue;
    }
    values[key] = create(ExecutionValueSchema, {
      value: secretValue.value,
      isSecret: decl.isSecret,
    });
  }
  return { kind: "resolved", values, missing };
}
