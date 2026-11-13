// `stigmer apikey create|fingerprint` — manage API keys for programmatic access.
//
// API keys are the non-interactive alternative to browser OAuth, for CI/CD and
// service accounts. The unified get/list/delete verbs cover the rest.
//
// `--bound-org` limits the key to one organization (`spec.bound_org`, by
// slug or id): the key works there and in that organization's children, as
// its owner's role allows, and the server refuses it in every other
// organization. Without it, the key works in every organization its owner
// holds a role in, unless the CLI's own credential is limited to one, whose
// organization it then takes.
//
// `--env-file <path>` appends `STIGMER_API_KEY=<key>` to that file instead of
// printing the key (made 0600 when new; refused before anything is created
// when the file already sets the variable), and prints only where it went, so
// a key made by a coding agent never passes through its transcript.
//
// `--service-account <name>` creates the key for one of the organization's
// service accounts instead of for the caller: the key speaks for the service
// account, keeps working when the caller leaves, and works only in the
// service account's organization and its children, so `--bound-org` does not
// apply. The name
// is resolved in the organization every org-scoped command uses (`--org`,
// `STIGMER_ORG`, then the context), and the key needs a `--name` of its own.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { create } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  type ApiKey,
  ApiKeySchema,
} from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import {
  ApiKeyHashSchema,
  CreateServiceAccountKeyInputSchema,
} from "@stigmer/apis/ai/stigmer/iam/apikey/v1/io_pb";
import type { ApiKeyInput, Stigmer } from "@stigmer/client";
import type { Command } from "commander";
import {
  ensureAuthenticated,
  resolveContextOrganization,
  resolveOrganization,
} from "../../config/index.js";
import { UsageError } from "../../errors/usage-error.js";
import {
  type OutputFlags,
  type OutputFormat,
  renderProtoJson,
  renderProtoYaml,
} from "../../output/index.js";
import { addReadFlags, globalOrg, readFormat } from "../shared.js";
import { parseExpiration } from "./duration.js";

const DEFAULT_EXPIRATION_DAYS = 90;

export interface ApiKeyCreateFlags extends OutputFlags {
  name?: string;
  neverExpires?: boolean;
  expiresIn?: string;
  boundOrg?: string;
  serviceAccount?: string;
  envFile?: string;
}

/** The variable `--env-file` sets: the one the token routes `stigmer app-handover` writes read. */
export const ENV_FILE_VARIABLE = "STIGMER_API_KEY";

export function registerApiKey(program: Command): void {
  const apikey = program
    .command("apikey")
    .description("manage API keys for Stigmer Cloud authentication");

  const create = apikey
    .command("create")
    .description("create a new API key")
    .option("--name <name>", "display name for the API key")
    .option("--never-expires", "create a key that never expires")
    .option("--expires-in <duration>", "custom expiration (e.g. 30d, 6h, 1y)")
    .option(
      "--bound-org <org>",
      "limit the key to one organization (slug or id) and its child organizations; it is refused everywhere else",
    )
    .option(
      "--service-account <name>",
      "create the key for this service account of the organization; it speaks for the service account, not for you",
    )
    .option(
      "--env-file <path>",
      `append ${ENV_FILE_VARIABLE}=<key> to this file instead of printing the key (0600 when new)`,
    )
    .action(async (options: ApiKeyCreateFlags, command: Command) => {
      await runCreate(options, command);
    });
  addReadFlags(create);

  const fingerprint = apikey
    .command("fingerprint <raw-key>")
    .description("look up which API key matches a raw token")
    .action(async (rawKey: string, options: OutputFlags) => {
      await runFingerprint(rawKey, options);
    });
  addReadFlags(fingerprint);
}

async function runCreate(options: ApiKeyCreateFlags, command: Command): Promise<void> {
  const expiresAt = resolveExpiry(options);
  const serviceAccount = options.serviceAccount?.trim() ?? "";
  if (serviceAccount !== "") refuseServiceAccountMisuse(options);
  const envFile = options.envFile?.trim() ?? "";
  if (envFile !== "") refuseEnvFileThatSetsTheKey(envFile);

  const { connectBackend } = await import("../../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);

  const created =
    serviceAccount === ""
      ? await client.stigmer.apiKey.create(
          apiKeyCreateInput(
            options,
            resolveContextOrganization(client.config),
            expiresAt,
          ),
        )
      : await createForServiceAccount(client.stigmer, {
          org: resolveOrganization(client.config, globalOrg(command)),
          serviceAccount,
          name: options.name ?? "",
          expiresAt,
        });

  const format = readFormat(options);
  if (envFile !== "") {
    saveToEnvFile(envFile, created.spec?.keyHash ?? "");
    process.stdout.write(renderSavedKey(created, serviceAccount, envFile, format));
    return;
  }
  if (format === "json") {
    process.stdout.write(renderProtoJson(ApiKeySchema, created));
    return;
  }
  if (format === "yaml") {
    process.stdout.write(renderProtoYaml(ApiKeySchema, created));
    return;
  }
  process.stdout.write(renderCreatedBanner(created, serviceAccount));
}

/**
 * The flags a service account's key cannot take: a limit (its key works in
 * its own organization alone) and an empty name (the key needs one to be
 * told apart in the service account's list).
 */
function refuseServiceAccountMisuse(options: ApiKeyCreateFlags): void {
  if (options.boundOrg !== undefined && options.boundOrg !== "") {
    throw new UsageError(
      "--bound-org does not apply to a service account's key\n\n" +
        "Its key works only in the service account's organization. Drop --bound-org.",
    );
  }
  if ((options.name ?? "").trim() === "") {
    throw new UsageError(
      "a service account's key needs a name\n\n" +
        "Pass --name, e.g. --name github-actions, so its keys can be told apart.",
    );
  }
}

/** Refuse, before a key is made, a file that already sets the variable: a second key would shadow or lose the first. */
export function refuseEnvFileThatSetsTheKey(path: string): void {
  if (!existsSync(path)) return;
  const setsIt = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .some((line) => new RegExp(`^\\s*(export\\s+)?${ENV_FILE_VARIABLE}\\s*=`).test(line));
  if (setsIt) {
    throw new UsageError(
      `${path} already sets ${ENV_FILE_VARIABLE}\n\n` +
        "Keep that key, or remove its line and run this again. No key was created.",
    );
  }
}

/** Append the variable to the file, creating it readable by its owner alone. */
export function saveToEnvFile(path: string, key: string): void {
  const line = `${ENV_FILE_VARIABLE}=${key}\n`;
  if (!existsSync(path)) {
    writeFileSync(path, line, { mode: 0o600 });
    return;
  }
  const text = readFileSync(path, "utf8");
  appendFileSync(path, text === "" || text.endsWith("\n") ? line : `\n${line}`);
}

/** What `--env-file` prints: where the key went, never the key. */
export function renderSavedKey(key: ApiKey, serviceAccount: string, path: string, format: OutputFormat): string {
  const where = relative(process.cwd(), resolve(path)) || path;
  const fields = {
    id: key.metadata?.id ?? "",
    name: key.metadata?.name ?? "",
    ...(serviceAccount === "" ? {} : { serviceAccount }),
    envFile: where,
    variable: ENV_FILE_VARIABLE,
    expires: formatExpiry(key),
  };
  if (format === "json") return `${JSON.stringify(fields, null, 2)}\n`;
  const lines = [`API key created and saved as ${ENV_FILE_VARIABLE} in ${where}`, "", `  ID:          ${fields.id}`];
  if (fields.name !== "") lines.push(`  Name:        ${fields.name}`);
  if (serviceAccount !== "") lines.push(`  Speaks for:  service account ${serviceAccount}`);
  lines.push(`  Expires:     ${fields.expires}`, "", `Keep ${where} out of git; the key is shown nowhere else.`);
  return `${lines.join("\n")}\n`;
}

/** Resolve the service account by name, then create the key that speaks for it. */
async function createForServiceAccount(
  stigmer: Stigmer,
  request: { org: string; serviceAccount: string; name: string; expiresAt: Date | undefined },
): Promise<ApiKey> {
  const [{ requireOrganization }, { findServiceAccount }] = await Promise.all([
    import("../../client/single-org.js"),
    import("../../resources/service-account.js"),
  ]);
  await requireOrganization(stigmer, request.org, [
    "stigmer apikey create --service-account <name> --org <org>",
    "stigmer config context set --org <org>",
  ]);
  const account = await findServiceAccount(stigmer, request.org, request.serviceAccount);
  return stigmer.apiKey.createForServiceAccount(
    create(CreateServiceAccountKeyInputSchema, {
      serviceAccountId: account.metadata?.id ?? "",
      name: request.name.trim(),
      neverExpires: request.expiresAt === undefined,
      ...(request.expiresAt === undefined ? {} : { expiresAt: timestampFromDate(request.expiresAt) }),
    }),
  );
}

async function runFingerprint(
  rawKey: string,
  options: OutputFlags,
): Promise<void> {
  // Base64URL without padding — the server's storage encoding (its
  // keymaterial module): a hash in any other encoding never matches a stored
  // key_hash, and the lookup below would answer NotFound.
  const hash = createHash("sha256").update(rawKey).digest("base64url");

  const { connectBackend } = await import("../../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);

  const key = await client.stigmer.apiKey.getByKeyHash(
    create(ApiKeyHashSchema, { value: hash }),
  );
  renderApiKey(key, readFormat(options));
}

/**
 * The create request for the flags: the context organization as the key's
 * `metadata.org`, and `--bound-org` as the organization the key is limited
 * to, sent only when given so an unlimited key names none.
 */
export function apiKeyCreateInput(
  options: ApiKeyCreateFlags,
  org: string,
  expiresAt: Date | undefined,
): ApiKeyInput {
  return {
    name: options.name ?? "",
    org,
    neverExpires: options.neverExpires,
    expiresAt,
    ...(options.boundOrg !== undefined && options.boundOrg !== ""
      ? { boundOrg: options.boundOrg }
      : {}),
  };
}

function resolveExpiry(options: ApiKeyCreateFlags): Date | undefined {
  if (options.neverExpires === true) return undefined;
  if (options.expiresIn !== undefined && options.expiresIn !== "") {
    return new Date(Date.now() + parseExpiration(options.expiresIn));
  }
  return new Date(Date.now() + DEFAULT_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
}

function renderApiKey(key: ApiKey, format: OutputFormat): void {
  if (format === "json") {
    process.stdout.write(renderProtoJson(ApiKeySchema, key));
    return;
  }
  if (format === "yaml") {
    process.stdout.write(renderProtoYaml(ApiKeySchema, key));
    return;
  }
  const lines = [`API Key: ${key.metadata?.id ?? ""}`, ""];
  if (key.metadata?.name) lines.push(`  Name:        ${key.metadata.name}`);
  if (key.spec?.fingerprint)
    lines.push(`  Fingerprint: ***${key.spec.fingerprint}`);
  lines.push(`  Expires:     ${formatExpiry(key)}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

function renderCreatedBanner(key: ApiKey, serviceAccount: string): string {
  const divider = "═".repeat(63);
  const lines = [
    "",
    "API key created successfully!",
    "",
    "IMPORTANT: Save this API key now — it will not be shown again!",
    "",
    divider,
    `  ${key.spec?.keyHash ?? ""}`,
    divider,
    "",
    `  ID:          ${key.metadata?.id ?? ""}`,
  ];
  if (key.metadata?.name) lines.push(`  Name:        ${key.metadata.name}`);
  if (serviceAccount !== "")
    lines.push(`  Speaks for:  service account ${serviceAccount}`);
  if (key.spec?.fingerprint)
    lines.push(`  Fingerprint: ***${key.spec.fingerprint}`);
  lines.push(
    `  Expires:     ${formatExpiry(key)}`,
    "",
    "Usage:",
    `  export STIGMER_API_KEY='${key.spec?.keyHash ?? ""}'`,
    "",
  );
  return `${lines.join("\n")}\n`;
}

function formatExpiry(key: ApiKey): string {
  if (key.spec?.neverExpires) return "Never";
  if (key.spec?.expiresAt !== undefined)
    return timestampDate(key.spec.expiresAt).toISOString();
  return "Never";
}
