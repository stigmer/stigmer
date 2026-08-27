// `stigmer config backend status|set|add|use|list|remove` — the named-backend
// surface (O3, 20260827.06; the kubectl-context model). `status` and
// `set <local|cloud>` predate named backends and stay as the simple view:
// set is sugar for `use` over the two reserved names.

import type { Command } from "commander";
import {
  CLOUD_BACKEND_NAME,
  type Config,
  LOCAL_BACKEND_NAME,
  type NamedBackendType,
  activeBackend,
  activeBackendName,
  load,
  resolveEndpoint,
  save,
} from "../../config/index.js";
import { UsageError } from "../../errors/index.js";
import {
  CommandResult,
  type OutputFlags,
  renderResult,
} from "../../output/index.js";
import { addResultFlags, resultFormat } from "../shared.js";

const DEFAULT_CLOUD_ENDPOINT = "api.stigmer.ai:443";

interface AddOptions extends OutputFlags {
  endpoint?: string;
  type?: string;
  apiKey?: string;
}

export function addBackendCommands(backend: Command): void {
  const status = backend
    .command("status")
    .description("show the current backend")
    .action((options: OutputFlags) => {
      renderResult(buildStatus(load()), resultFormat(options));
    });
  addResultFlags(status);

  const set = backend
    .command("set <type>")
    .description("switch between the reserved local and cloud backends")
    .action((type: string, options: OutputFlags) => {
      renderResult(applySet(type), resultFormat(options));
    });
  addResultFlags(set);

  const add = backend
    .command("add <name>")
    .description("add or update a named backend (self-hosted by default)")
    .requiredOption(
      "--endpoint <host:port>",
      "the server address, e.g. stigmer.example.com:443",
    )
    .option("--type <type>", "backend type: selfhost or cloud", "selfhost")
    .option(
      "--api-key <key>",
      "API token for a self-hosted backend (stigmer apikey create)",
    )
    .action((name: string, options: AddOptions) => {
      renderResult(applyAdd(name, options), resultFormat(options));
    });
  addResultFlags(add);

  const use = backend
    .command("use <name>")
    .description("switch the active backend")
    .action((name: string, options: OutputFlags) => {
      renderResult(applyUse(name), resultFormat(options));
    });
  addResultFlags(use);

  const list = backend
    .command("list")
    .description("list configured backends")
    .action((options: OutputFlags) => {
      renderResult(buildList(load()), resultFormat(options));
    });
  addResultFlags(list);

  const remove = backend
    .command("remove <name>")
    .description("remove a named backend")
    .action((name: string, options: OutputFlags) => {
      renderResult(applyRemove(name), resultFormat(options));
    });
  addResultFlags(remove);
}

function buildStatus(config: Config): CommandResult {
  const { name, entry } = activeBackend(config);
  const result = CommandResult.success("Backend configuration");
  const section = result
    .addSection("")
    .field("Backend", name)
    .field("Type", entry?.type ?? "local")
    .field("Endpoint", resolveEndpoint(config));
  if (entry?.type === "cloud") {
    section.field("Auth", entry.token ? "Logged in" : "Not logged in");
  }
  if (entry?.type === "selfhost") {
    section.field(
      "Auth",
      entry.api_key
        ? "API key stored"
        : "No credential (unauthenticated server, or STIGMER_API_KEY)",
    );
  }
  return result;
}

function applySet(type: string): CommandResult {
  if (type !== "local" && type !== "cloud") {
    throw new UsageError(
      `invalid backend type "${type}" (expected: local, cloud — named backends switch with 'use')`,
    );
  }

  const config = load();
  if (type === "cloud") {
    const backends = (config.backends ??= {});
    backends[CLOUD_BACKEND_NAME] ??= {
      type: "cloud",
      endpoint: DEFAULT_CLOUD_ENDPOINT,
    };
    config.current_backend = CLOUD_BACKEND_NAME;
    save(config);
    return CommandResult.success("Backend set to cloud")
      .hint("Please authenticate:")
      .hint("  stigmer auth login");
  }

  config.current_backend = LOCAL_BACKEND_NAME;
  save(config);
  return CommandResult.success("Backend set to local").hint(
    "Make sure the Stigmer server is running.",
  );
}

function applyAdd(name: string, options: AddOptions): CommandResult {
  if (name === LOCAL_BACKEND_NAME) {
    throw new UsageError(
      `"${LOCAL_BACKEND_NAME}" is the managed local daemon — it cannot be redefined`,
    );
  }
  const type = options.type ?? "selfhost";
  if (type !== "selfhost" && type !== "cloud") {
    throw new UsageError(
      `invalid backend type "${type}" (expected: selfhost, cloud)`,
    );
  }
  const endpoint = options.endpoint ?? "";
  if (endpoint === "") {
    throw new UsageError("--endpoint is required");
  }

  const config = load();
  const backends = (config.backends ??= {});
  const existing = backends[name];
  backends[name] = {
    ...existing,
    type: type as NamedBackendType,
    endpoint,
    ...(options.apiKey !== undefined ? { api_key: options.apiKey } : {}),
  };
  save(config);

  const result = CommandResult.success(
    `Backend "${name}" ${existing !== undefined ? "updated" : "added"} (${type}, ${endpoint})`,
  ).hint(`Switch to it:  stigmer config backend use ${name}`);
  if (type === "selfhost" && backends[name].api_key === undefined) {
    result.hint(
      "No API key stored. For an authenticated server, mint one on that backend:",
    );
    result.hint("  stigmer apikey create --name cli");
  }
  return result;
}

function applyUse(name: string): CommandResult {
  const config = load();
  if (name !== LOCAL_BACKEND_NAME && config.backends?.[name] === undefined) {
    throw new UsageError(
      `unknown backend "${name}" (known: ${knownBackendNames(config).join(", ")})`,
    );
  }
  config.current_backend = name;
  save(config);
  return CommandResult.success(`Switched to backend "${name}"`);
}

function buildList(config: Config): CommandResult {
  const current = activeBackendName(config);
  const result = CommandResult.success("Configured backends");
  for (const name of knownBackendNames(config)) {
    const entry = config.backends?.[name];
    const marker = name === current ? " (current)" : "";
    const section = result.addSection(`${name}${marker}`);
    section.field("Type", entry?.type ?? "local");
    section.field(
      "Endpoint",
      entry?.endpoint ??
        (entry?.type === "cloud" ? DEFAULT_CLOUD_ENDPOINT : "localhost:7234"),
    );
    if (entry?.type === "cloud") {
      section.field("Auth", entry.token ? "Logged in" : "Not logged in");
    } else if (entry?.type === "selfhost") {
      section.field("Auth", entry.api_key ? "API key stored" : "None");
    }
  }
  return result;
}

function applyRemove(name: string): CommandResult {
  if (name === LOCAL_BACKEND_NAME) {
    throw new UsageError(
      `"${LOCAL_BACKEND_NAME}" is the managed local daemon — it cannot be removed`,
    );
  }
  const config = load();
  if (config.backends?.[name] === undefined) {
    throw new UsageError(`unknown backend "${name}"`);
  }
  if (activeBackendName(config) === name) {
    throw new UsageError(
      `backend "${name}" is the current backend — switch first: stigmer config backend use ${LOCAL_BACKEND_NAME}`,
    );
  }
  delete config.backends[name];
  save(config);
  return CommandResult.success(`Removed backend "${name}"`);
}

function knownBackendNames(config: Config): string[] {
  return [LOCAL_BACKEND_NAME, ...Object.keys(config.backends ?? {}).sort()];
}
