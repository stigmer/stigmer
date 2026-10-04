// `stigmer apikey create|fingerprint` — manage API keys for programmatic access.
//
// API keys are the non-interactive alternative to browser OAuth, for CI/CD and
// service accounts. The unified get/list/delete verbs cover the rest.
//
// `--bound-org` limits the key to one organization (`spec.bound_org`, by
// slug or id): the server refuses it in every other organization. Without
// it, the key works in every organization its owner holds a role in.

import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  type ApiKey,
  ApiKeySchema,
} from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeyHashSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import type { ApiKeyInput } from "@stigmer/sdk";
import type { Command } from "commander";
import {
  ensureAuthenticated,
  resolveContextOrganization,
} from "../../config/index.js";
import {
  type OutputFlags,
  type OutputFormat,
  renderProtoJson,
  renderProtoYaml,
} from "../../output/index.js";
import { addReadFlags, readFormat } from "../shared.js";
import { parseExpiration } from "./duration.js";

const DEFAULT_EXPIRATION_DAYS = 90;

export interface ApiKeyCreateFlags extends OutputFlags {
  name?: string;
  neverExpires?: boolean;
  expiresIn?: string;
  boundOrg?: string;
}

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
      "limit the key to one organization (slug or id); it is refused everywhere else",
    )
    .action(async (options: ApiKeyCreateFlags) => {
      await runCreate(options);
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

async function runCreate(options: ApiKeyCreateFlags): Promise<void> {
  const expiresAt = resolveExpiry(options);

  const { connectBackend } = await import("../../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);

  const created = await client.stigmer.apiKey.create(
    apiKeyCreateInput(
      options,
      resolveContextOrganization(client.config),
      expiresAt,
    ),
  );

  const format = readFormat(options);
  if (format === "json") {
    process.stdout.write(renderProtoJson(ApiKeySchema, created));
    return;
  }
  if (format === "yaml") {
    process.stdout.write(renderProtoYaml(ApiKeySchema, created));
    return;
  }
  process.stdout.write(renderCreatedBanner(created));
}

async function runFingerprint(
  rawKey: string,
  options: OutputFlags,
): Promise<void> {
  // Base64URL without padding — the server's storage encoding (the Java
  // ApiKeyHasher and the TS keymaterial module agree). This was once hex,
  // which meant the computed hash could never match a stored key_hash and
  // the lookup below always answered NotFound.
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

function renderCreatedBanner(key: ApiKey): string {
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
