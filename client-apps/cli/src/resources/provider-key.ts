// `stigmer provider-key` dispatch: which model providers serve an
// organization, and on Stigmer Cloud the organization's own provider keys,
// saved, listed and removed.
//
// Two answers are joined. The platform's model readiness says, on every
// edition, where each provider stands for the organization (its own key, its
// parent's, the runners', or nothing), in the server's provider order. The
// provider key list, served by Stigmer Cloud only, adds each key's details:
// its last four characters, the endpoint it is used against, whether the
// provider confirmed it when it was saved, who saved it and when, and when a
// call last used it. A server that does not serve the key list (open source
// answers Unimplemented), or a caller who may not read it, still gets every
// provider's standing; the key columns are left out.
//
// A key is a secret: it reaches this module already read (the command layer
// reads it from a hidden prompt or from stdin, never from an argument or an
// environment variable), is sent once, and is never printed. What comes back
// is the saved key without its secret.
//
// Saving and removing are Stigmer Cloud's: on any other edition the runners
// hold their own keys, so those commands are refused with the fix for that
// edition before anything is read or sent.

import { create, type JsonObject, type JsonValue } from "@bufbuild/protobuf";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  type ProviderKey,
  ProviderKeyCheck,
  ProviderKeySchema,
} from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import {
  DeleteProviderKeyInputSchema,
  ListProviderKeysInputSchema,
  SetProviderKeyInputSchema,
} from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/io_pb";
import {
  ProviderAvailability,
  type ProviderReadiness,
  ProviderReadinessSchema,
} from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import { type DeploymentMode, isPermissionDenied, isUnimplemented, type Stigmer } from "@stigmer/client";
import { CliExitError } from "../errors/cli-exit-error.js";
import { ExitCode } from "@stigmer/client/exit-codes";
import { UsageError } from "../errors/usage-error.js";
import { CommandResult, protoToJsonValue } from "../output/index.js";
import { readCursorPages } from "./cursor-pages.js";

/** The clients these helpers call: the provider key client and the platform's readiness. */
export type ProviderKeyClient = Pick<Stigmer, "providerkey" | "platform">;

/** The providers a key is saved for, as the contract names them (io.proto). */
export const PROVIDERS = ["anthropic", "openai"] as const;

export type Provider = (typeof PROVIDERS)[number];

const DISPLAY_NAMES: ReadonlyMap<string, string> = new Map([
  ["anthropic", "Anthropic"],
  ["openai", "OpenAI"],
]);

/** The fix `set` and `delete` name on an open-source server. */
export const LOCAL_KEYS_FIX =
  "On your own machine the runner's keys come from `stigmer setup` (Anthropic) and OPENAI_API_KEY in the shell you start Stigmer from (OpenAI), then `stigmer down && stigmer up`.";

/** The provider a person typed, by the contract's own names. */
export function parseProvider(value: string): Provider {
  const wanted = value.trim().toLowerCase();
  const found = PROVIDERS.find((provider) => provider === wanted);
  if (found !== undefined) return found;
  throw new UsageError(`unknown provider "${value}"\n\nUse anthropic or openai.`);
}

/** A provider's name as a person reads it: Anthropic, OpenAI. */
export function providerDisplayName(provider: string): string {
  return DISPLAY_NAMES.get(provider) ?? provider;
}

/**
 * The base URL `--base-url` names, checked as far as the client can: an
 * https URL. Whether it resolves to a public address is the server's to say.
 */
export function parseBaseUrl(value: string | undefined): string {
  const baseUrl = (value ?? "").trim();
  if (baseUrl === "") return "";
  const url = URL.canParse(baseUrl) ? new URL(baseUrl) : undefined;
  if (url === undefined || url.protocol !== "https:") {
    throw new UsageError(
      `--base-url must be an https URL, not "${baseUrl}"\n\nFor example: --base-url https://gateway.example.com/openai/v1`,
    );
  }
  return baseUrl;
}

/**
 * Refuses a key write on a server that keeps no provider keys: open source
 * and Stigmer Enterprise hand runs to runners that hold their own keys.
 */
export function refuseKeyWritesOff(mode: DeploymentMode): void {
  if (mode === "cloud") return;
  const fix =
    mode === "local"
      ? LOCAL_KEYS_FIX
      : "This server's runners use the keys whoever runs them gives them.";
  throw new CliExitError("this server keeps no provider keys: they are saved on Stigmer Cloud", ExitCode.Usage, [
    fix,
  ]);
}

/** Whether the key list could be read, and why not when it could not. */
export type KeyDetails = "read" | "not-served" | "not-permitted";

/** One provider's standing for the organization, with its key when the list was read. */
export interface ProviderStanding {
  readonly readiness: ProviderReadiness;
  readonly key: ProviderKey | undefined;
}

export interface ProviderListing {
  readonly standings: readonly ProviderStanding[];
  readonly keyDetails: KeyDetails;
}

/**
 * Every provider's standing for the organization in the server's order,
 * joined with the organization's keys when the server serves the key list
 * and the caller may read it.
 */
export async function listProviders(client: ProviderKeyClient, org: string): Promise<ProviderListing> {
  const [readiness, keys] = await Promise.all([
    client.platform.getModelReadiness(org),
    readKeys(client, org),
  ]);
  const byProvider = new Map((Array.isArray(keys) ? keys : []).map((key) => [key.provider, key]));
  return {
    standings: readiness.providers.map((provider) => ({
      readiness: provider,
      key: byProvider.get(provider.provider),
    })),
    keyDetails: Array.isArray(keys) ? "read" : keys,
  };
}

async function readKeys(client: ProviderKeyClient, org: string): Promise<ProviderKey[] | Exclude<KeyDetails, "read">> {
  try {
    return await readCursorPages(0, (pageSize, pageToken) =>
      client.providerkey.list(create(ListProviderKeysInputSchema, { org, pageSize, pageToken })),
    );
  } catch (err) {
    if (isUnimplemented(err)) return "not-served";
    if (isPermissionDenied(err)) return "not-permitted";
    throw err;
  }
}

/** Where a provider stands, in words. */
export function standingWords(readiness: ProviderReadiness): string {
  switch (readiness.availability) {
    case ProviderAvailability.served_by_organization:
      return "connected";
    case ProviderAvailability.served_by_parent_organization:
      return readiness.parentOrg === "" ? "through the parent organization" : `through ${readiness.parentOrg}`;
    case ProviderAvailability.served_by_runners:
      return "set on this machine";
    case ProviderAvailability.missing_from_organization:
    case ProviderAvailability.missing_from_runners:
      return "not connected";
    case ProviderAvailability.availability_unknown:
      return "not known: set where the runner runs";
    default:
      return "not known";
  }
}

const STANDING_HEADERS = ["PROVIDER", "STATE"] as const;
const KEY_HEADERS = ["KEY", "ENDPOINT", "CHECK", "SAVED BY", "SAVED", "LAST USED"] as const;

/** The list's table headers: the key's columns only when the key list was read. */
export function providerTableHeaders(listing: ProviderListing): string[] {
  return listing.keyDetails === "read" ? [...STANDING_HEADERS, ...KEY_HEADERS] : [...STANDING_HEADERS];
}

/** The list's table: one row per provider, in the server's order. */
export function providerTableRows(listing: ProviderListing): string[][] {
  return listing.standings.map(({ readiness, key }) => {
    const standing = [providerDisplayName(readiness.provider), standingWords(readiness)];
    if (listing.keyDetails !== "read") return standing;
    if (key === undefined) return [...standing, ...KEY_HEADERS.map(() => "-")];
    return [
      ...standing,
      key.keyHint === "" ? "-" : `…${key.keyHint}`,
      endpointHost(key.baseUrl),
      checkWords(key.check),
      key.createdBy || "-",
      dayOf(key.updatedAt ?? key.createdAt) ?? "-",
      dayOf(key.lastUsedAt) ?? "never",
    ];
  });
}

/**
 * The list as data: each provider's readiness in protojson (snake_case,
 * defaults omitted) and, when the key list was read and the provider has a
 * key, that key under `key`.
 */
export function providerListJson(listing: ProviderListing): JsonValue[] {
  return listing.standings.map(({ readiness, key }) => {
    const row = protoToJsonValue(ProviderReadinessSchema, readiness) as JsonObject;
    return key === undefined ? row : { ...row, key: protoToJsonValue(ProviderKeySchema, key) };
  });
}

/** The streams reading a key touches, injectable for tests. */
export interface KeyIo {
  readonly stdinIsTty: boolean;
  readonly readStdin: () => Promise<string>;
  readonly promptHidden: (question: string) => Promise<string>;
}

/**
 * Refuses a key given on the command line, as an argument or a flag: it
 * would stay in the shell's history and show in the process list.
 */
export function refuseKeyOnCommandLine(provider: Provider): never {
  throw new UsageError(
    "a provider key is never taken on the command line: it would stay in your shell history and show in the process list\n\n" +
      `Type it at the hidden prompt: stigmer provider-key set ${provider}\n` +
      `Or pipe it in: stigmer provider-key set ${provider} --key-stdin`,
  );
}

/**
 * The key, read from stdin under `--key-stdin`, otherwise from a hidden
 * prompt on a terminal. Off a terminal without `--key-stdin` there is no
 * one to type it, so the command says how to pipe it in.
 */
export async function readProviderKey(provider: Provider, keyStdin: boolean, io: KeyIo): Promise<string> {
  const name = providerDisplayName(provider);
  let raw: string;
  if (keyStdin) {
    raw = await io.readStdin();
  } else if (io.stdinIsTty) {
    raw = await io.promptHidden(`${name} key`);
  } else {
    throw new UsageError(
      `no terminal to type the ${name} key at\n\nPipe it in: stigmer provider-key set ${provider} --key-stdin`,
    );
  }
  const key = raw.trim();
  if (key === "") throw new UsageError(`no ${name} key given`);
  return key;
}

/** Save the organization's key for `provider`, and say whether the provider confirmed it. */
export async function setProviderKey(
  client: ProviderKeyClient,
  org: string,
  provider: Provider,
  apiKey: string,
  baseUrl: string,
): Promise<CommandResult> {
  const saved = await client.providerkey.set(create(SetProviderKeyInputSchema, { org, provider, apiKey, baseUrl }));
  return savedResult(provider, saved);
}

/** What a save says, by the check the server made with the provider. */
export function savedResult(provider: Provider, saved: ProviderKey): CommandResult {
  const name = providerDisplayName(provider);
  let result: CommandResult;
  switch (saved.check) {
    case ProviderKeyCheck.checked:
      result = CommandResult.success(`Saved; checked with ${name}`);
      break;
    case ProviderKeyCheck.unchecked:
      result = CommandResult.warning(`Saved, not checked: ${name} did not answer`);
      result.hint(`The first run that needs ${name} says whether the key works.`);
      break;
    default:
      result = CommandResult.success("Saved");
  }
  const section = result.addSection();
  section.field("Provider", name);
  if (saved.keyHint !== "") section.field("Key", `…${saved.keyHint}`);
  if (saved.baseUrl !== "") section.field("Endpoint", saved.baseUrl);
  return result.withData(protoToJsonValue(ProviderKeySchema, saved));
}

/** The question `delete` asks on a terminal before it removes a key. */
export function deletePrompt(provider: Provider, orgLabel: string): string {
  const name = providerDisplayName(provider);
  const serves = orgLabel === "" ? "this organization" : orgLabel;
  return `Remove the ${name} key? Runs that need ${name} are refused until a key serves ${serves} again. [y/N]`;
}

/** Remove the organization's key for `provider`. */
export async function deleteProviderKey(
  client: ProviderKeyClient,
  org: string,
  provider: Provider,
): Promise<CommandResult> {
  const removed = await client.providerkey.delete(create(DeleteProviderKeyInputSchema, { org, provider }));
  const name = providerDisplayName(provider);
  const result = CommandResult.success(`Removed the ${name} key`);
  if (removed.keyHint !== "") result.addSection().field("Key", `…${removed.keyHint}`);
  result.hint(`Save another with: stigmer provider-key set ${provider}`);
  return result.withData(protoToJsonValue(ProviderKeySchema, removed));
}

function checkWords(check: ProviderKeyCheck): string {
  switch (check) {
    case ProviderKeyCheck.checked:
      return "checked";
    case ProviderKeyCheck.unchecked:
      return "not checked";
    default:
      return "-";
  }
}

/** The endpoint's host, or "-" for the provider's own API. */
function endpointHost(baseUrl: string): string {
  if (baseUrl === "") return "-";
  return URL.canParse(baseUrl) ? new URL(baseUrl).host : baseUrl;
}

function dayOf(at: Timestamp | undefined): string | undefined {
  return at === undefined ? undefined : timestampDate(at).toISOString().slice(0, 10);
}
