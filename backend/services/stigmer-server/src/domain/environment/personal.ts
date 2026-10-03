/**
 * A person's personal environment as a source of DECLARED variables: the
 * one lookup that answers "which of these declared keys has THIS person
 * saved" for every lane that runs a tool on a person's behalf, and the one
 * reading of "this person's personal environment" the uniqueness rule
 * shares.
 *
 * Three readers need it and must agree on it. The MCP connect lane (the
 * discovery run a person triggers from the console) resolves a server's
 * declared variables here when no one-time runtime_env was supplied, for
 * the person connecting. The agent-execution ExecutionContext build
 * resolves, for the run's person (agentexecution/run-person.ts), a
 * SESSION-level MCP server's declared variables the merge chain did not
 * carry — a session's own servers ride no agent instance and so have no
 * environment_refs of their own — and the GITHUB_TOKEN a session's git
 * repository needs. Before the build learned this rule a key saved through
 * the console's "save for future" reached the connect lane and never the
 * run.
 *
 * Whose row: the one whose creator stamp
 * (`status.audit.spec_audit.created_by.id`) IS the person, in the asked
 * organization, carrying the personal label. Never the organization's
 * first: a personal environment holds one person's own keys, and a lookup
 * that took any member's would hand them to every member's run. The rows
 * are scanned from the store, decoded and matched on organization, label
 * and creator (no caller's read scope can answer for a recover, which has
 * no caller). One
 * person holds one row per organization (EnforcePersonalEnvUniqueness);
 * should a race leave two, the newest wins, the console's own choice.
 *
 * Least privilege by construction: only the keys the caller declares are
 * read, one GetSecretValue per key; nothing here layers a whole
 * environment onto anything. What a missing personal environment or a
 * missing required key MEANS is the caller's to decide — connect refuses
 * (a person asked to connect and cannot without the credential), the
 * build warns (the run fails at the tool with a clearer error) — so both
 * outcomes are returned as values, never thrown. A failing store scan is
 * the one infrastructure fault, thrown as Internal.
 *
 * Proven by __tests__/personal.test.ts; the connect lane's wire copy over
 * these outcomes by mcpserver/__tests__/connect.test.ts; whose row a run
 * reads by agentexecution/__tests__/personal-environment-reach.test.ts.
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";

import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { EnvironmentSecretValueInputSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type {
  EnvVarDeclaration,
  EnvironmentValue,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { internalError } from "../../pipeline/errors.js";
import { createdByOf } from "../../pipeline/steps/authorization-facts.js";
import { compareCreatedAtDesc } from "../../pipeline/steps/helpers.js";
import type { Store } from "../../store/interface.js";
import { PERSONAL_LABEL_KEY, PERSONAL_LABEL_VALUE } from "./constants.js";

/**
 * The secret read this lookup consumes: decrypted (the ordinary
 * Environment surface redacts, oss#405). Both consuming domains' in-process
 * edges already satisfy it.
 */
export interface PersonalEnvironmentReader {
  getSecretValue(
    input: MessageInitShape<typeof EnvironmentSecretValueInputSchema>,
  ): Promise<EnvironmentValue>;
}

/**
 * Every personal environment `person` created in `org`, newest first. An
 * empty person names nobody and owns nothing. Rows that do not decode are
 * skipped, as every scan helper skips them; a store fault propagates.
 */
export async function personalEnvironmentsOf(
  store: Store,
  org: string,
  person: string,
): Promise<Environment[]> {
  if (person === "" || org === "") {
    return [];
  }
  const found: Environment[] = [];
  for (const data of await store.listResources(ApiResourceKind.environment)) {
    let env: Environment;
    try {
      env = fromBinary(EnvironmentSchema, data);
    } catch {
      continue;
    }
    if (
      env.metadata?.org === org &&
      env.metadata.labels[PERSONAL_LABEL_KEY] === PERSONAL_LABEL_VALUE &&
      createdByOf(env) === person
    ) {
      found.push(env);
    }
  }
  return found.sort((a, b) =>
    compareCreatedAtDesc(
      a.status?.audit?.specAudit?.createdAt,
      b.status?.audit?.specAudit?.createdAt,
    ),
  );
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
 * Resolves the given declarations against `person`'s personal environment
 * in `org`. A declaration's `is_secret` rides onto the value; a declared
 * key the environment lacks is skipped when optional and reported in
 * `missing` when required. A secret read that fails is logged and treated
 * as absent, the same way for every lane.
 */
export async function resolveDeclaredFromPersonalEnvironment(
  reader: PersonalEnvironmentReader,
  store: Store,
  logger: Logger,
  org: string,
  person: string,
  declarations: { readonly [key: string]: EnvVarDeclaration },
): Promise<PersonalEnvironmentResolution> {
  let owned: Environment[];
  try {
    owned = await personalEnvironmentsOf(store, org, person);
  } catch (error) {
    throw internalError(error, "failed to list personal environments");
  }
  const personalEnv = owned[0];
  if (personalEnv === undefined) {
    return { kind: "no-personal-environment" };
  }
  const personalEnvId = personalEnv.metadata?.id ?? "";
  if (owned.length > 1) {
    logger.warn(
      "Person holds more than one personal environment; reading the newest",
      {
        org,
        personal_env_id: personalEnvId,
        count: owned.length,
      },
    );
  }
  // The stored keys are present whatever their values, so existence is
  // checkable before the secret read. Own-key membership (never the
  // prototype chain): an exotic key name must not read as held.
  const stored = personalEnv.spec?.data ?? {};

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
