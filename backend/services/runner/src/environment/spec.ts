/**
 * The sandbox's Environment as the runner receives it: the network mode and
 * the packages, the runner's half of the server's facts
 * (stigmer-server `src/sandbox/environment.ts`). It arrives as one JSON
 * value, `STIGMER_SANDBOX_ENVIRONMENT`, set by the docker and agent-sandbox
 * drivers and by the attach waiter from a Substrate push.
 *
 * It is checked again here because it crosses a boundary: the shape, and
 * each package entry against its manager's grammar, the contract's own
 * patterns (`apis/ai/stigmer/agentic/environment/v1/spec.proto`, held equal
 * by `__tests__/spec.test.ts`). The entries reach the managers as argv,
 * never through a shell; the grammar keeps out what would change where a
 * package comes from (an option, a URL, a git source, a path).
 */

export const SANDBOX_ENVIRONMENT_ENV = "STIGMER_SANDBOX_ENVIRONMENT";

/** The package managers, in the order they install (Claude Managed Agents'). */
export const MANAGERS = ["apt", "cargo", "gem", "go", "npm", "pip"] as const;
export type Manager = (typeof MANAGERS)[number];

export type PackageSet = { readonly [M in Manager]: readonly string[] };

export interface SandboxEnvironment {
  readonly network: "unrestricted" | "limited";
  readonly packages: PackageSet;
}

/** Each manager's entry grammar: the contract's protovalidate patterns. */
export const PACKAGE_PATTERNS: { readonly [M in Manager]: RegExp } = {
  apt: /^[a-z0-9][a-z0-9+.-]+(=[A-Za-z0-9.+~:-]+)?$/,
  cargo: /^[A-Za-z0-9][A-Za-z0-9_-]*(@[0-9A-Za-z.+-]+)?$/,
  gem: /^[A-Za-z0-9][A-Za-z0-9._-]*(:[0-9A-Za-z.]+)?$/,
  go: /^[A-Za-z0-9][A-Za-z0-9._~/-]*@[A-Za-z0-9._+-]+$/,
  npm: /^(@[A-Za-z0-9][A-Za-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*(@[A-Za-z0-9.^~<>=*+_-]+)?$/,
  pip: /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?(\[[A-Za-z0-9._-]+(,[A-Za-z0-9._-]+)*\])?((===|==|!=|~=|>=|<=|>|<)[A-Za-z0-9.*+!_-]+(,(===|==|!=|~=|>=|<=|>|<)[A-Za-z0-9.*+!_-]+)*)?$/,
};

/** The contract's limits on each manager's list. */
export const MAX_PACKAGES_PER_MANAGER = 32;
export const MAX_PACKAGE_LENGTH = 214;

export type ParsedEnvironment =
  | { readonly ok: true; readonly environment: SandboxEnvironment }
  | { readonly ok: false; readonly reason: string };

/** Checks a decoded value; the reason names the first thing wrong. */
export function parseSandboxEnvironment(value: unknown): ParsedEnvironment {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "the environment must be a JSON object" };
  }
  const { network, packages } = value as Record<string, unknown>;
  if (network !== "unrestricted" && network !== "limited") {
    return { ok: false, reason: "environment.network must be unrestricted or limited" };
  }
  if (typeof packages !== "object" || packages === null || Array.isArray(packages)) {
    return { ok: false, reason: "environment.packages must be an object" };
  }
  const given = packages as Record<string, unknown>;
  for (const key of Object.keys(given)) {
    if (!(MANAGERS as readonly string[]).includes(key)) {
      return { ok: false, reason: `environment.packages names no manager ${key}` };
    }
  }
  const out: Record<Manager, string[]> = { apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] };
  for (const manager of MANAGERS) {
    const entries = given[manager] ?? [];
    if (!Array.isArray(entries) || entries.length > MAX_PACKAGES_PER_MANAGER) {
      return { ok: false, reason: `environment.packages.${manager} must be a list of at most ${MAX_PACKAGES_PER_MANAGER}` };
    }
    for (const entry of entries as unknown[]) {
      if (typeof entry !== "string" || entry.length > MAX_PACKAGE_LENGTH || !PACKAGE_PATTERNS[manager].test(entry)) {
        return { ok: false, reason: `environment.packages.${manager} holds an entry that is not a ${manager} package: ${JSON.stringify(entry)}` };
      }
      out[manager].push(entry);
    }
  }
  return { ok: true, environment: { network, packages: out } };
}

/**
 * The sandbox's Environment from the runner's environment, or `undefined`
 * when none governs it. A value that does not parse is a driver fault: it
 * throws, so the runner stops at boot rather than run without the packages
 * or the network rule the conversation was given.
 */
export function sandboxEnvironmentFrom(env: NodeJS.ProcessEnv = process.env): SandboxEnvironment | undefined {
  const raw = env[SANDBOX_ENVIRONMENT_ENV];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error(`${SANDBOX_ENVIRONMENT_ENV} is not JSON`);
  }
  const parsed = parseSandboxEnvironment(decoded);
  if (!parsed.ok) {
    throw new Error(`${SANDBOX_ENVIRONMENT_ENV}: ${parsed.reason}`);
  }
  return parsed.environment;
}

/** Whether the set installs anything. */
export function hasPackages(packages: PackageSet): boolean {
  return MANAGERS.some((manager) => packages[manager].length > 0);
}
