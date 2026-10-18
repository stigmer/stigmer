/**
 * Pins the runner's reading of the sandbox's Environment (`spec.ts`):
 *
 *   - a valid set parses, a missing manager reads as empty, and the network
 *     must be `unrestricted` or `limited`;
 *   - each manager's grammar refuses what would change where a package
 *     comes from or what installs: a leading `-` (an option), whitespace, a
 *     URL, a `git+` or `file:` source, a path; go needs its `@version`;
 *   - the contract's limits: more than 32 entries, or an entry over 214
 *     characters, is refused, and so is a key that names no manager;
 *   - `sandboxEnvironmentFrom` is `undefined` when the variable is unset or
 *     blank, and throws on a value that is not JSON or does not parse;
 *   - the grammars and limits ARE the contract's: the test reads
 *     `apis/ai/stigmer/agentic/environment/v1/spec.proto` as text and
 *     compares each manager's `pattern:`, `max_items` and `max_len`, so a
 *     change on either side turns it red.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  hasPackages,
  MANAGERS,
  MAX_PACKAGE_LENGTH,
  MAX_PACKAGES_PER_MANAGER,
  PACKAGE_PATTERNS,
  parseSandboxEnvironment,
  SANDBOX_ENVIRONMENT_ENV,
  sandboxEnvironmentFrom,
  type Manager,
  type PackageSet,
} from "../spec.js";

const EMPTY: PackageSet = { apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] };

/** One entry each manager's grammar accepts, of the forms the contract documents. */
const VALID: { readonly [M in Manager]: readonly string[] } = {
  apt: ["poppler-utils", "poppler-utils=22.02.0-2", "g++", "libc6=2.36-9+deb12u4", "python3.11"],
  cargo: ["hyperfine", "hyperfine@1.18.0", "cargo-edit", "ripgrep_all@0.10.6"],
  gem: ["rails", "rails:7.1.0", "nokogiri", "rspec-core:3.13.0"],
  go: ["golang.org/x/tools/cmd/goimports@latest", "github.com/golangci/golangci-lint/cmd/golangci-lint@v1.59.1"],
  npm: ["express", "express@4.18.0", "@angular/cli", "@angular/cli@^17.0.0", "typescript@~5.4", "left-pad@*"],
  pip: ["sqlalchemy", "sqlalchemy==2.0.30", "requests[socks]", "uvicorn[standard,dev]>=0.29", "numpy>=2,<3", "black~=24.4"],
};

/** What every manager's grammar refuses: an option, whitespace, a URL, a git or file source, a path. */
const REFUSED_EVERYWHERE = [
  "",
  "-y",
  "--registry=https://evil.example",
  "a b",
  "pkg\tname",
  "pkg\n",
  "https://example.com/pkg.tgz",
  "http://example.com/x@1",
  "git+https://github.com/a/b.git",
  "git+ssh://git@github.com/a/b@main",
  "file:../pkg",
  "file:/tmp/pkg@1",
  "./x",
  "./x@1",
  "/x",
  "/x@1",
  "../x@1",
];

function environment(packages: Partial<Record<string, unknown>>, network: unknown = "limited"): unknown {
  return { network, packages };
}

describe("parseSandboxEnvironment", () => {
  it("parses a valid set, every manager present, in the managers' own order", () => {
    const parsed = parseSandboxEnvironment(environment({ ...VALID }));
    expect(parsed).toEqual({ ok: true, environment: { network: "limited", packages: VALID } });
    expect(MANAGERS).toEqual(["apt", "cargo", "gem", "go", "npm", "pip"]);
  });

  it("reads a missing manager as empty, and either network mode", () => {
    for (const network of ["unrestricted", "limited"] as const) {
      expect(parseSandboxEnvironment(environment({ npm: ["express"] }, network))).toEqual({
        ok: true,
        environment: { network, packages: { ...EMPTY, npm: ["express"] } },
      });
    }
    expect(parseSandboxEnvironment(environment({}, "unrestricted"))).toEqual({ ok: true, environment: { network: "unrestricted", packages: EMPTY } });
  });

  it("refuses a network that is not unrestricted or limited", () => {
    for (const network of [undefined, "", "none", "LIMITED", 2, null]) {
      expect(parseSandboxEnvironment({ network, packages: {} })).toEqual({ ok: false, reason: "environment.network must be unrestricted or limited" });
    }
    expect(parseSandboxEnvironment({ packages: {} }).ok, "a missing network").toBe(false);
  });

  it("refuses a value that is not an object, and packages that are not one", () => {
    for (const value of [null, [], "x", 1, undefined]) {
      expect(parseSandboxEnvironment(value)).toEqual({ ok: false, reason: "the environment must be a JSON object" });
    }
    for (const packages of [undefined, null, [], "npm"]) {
      expect(parseSandboxEnvironment({ network: "limited", packages })).toEqual({ ok: false, reason: "environment.packages must be an object" });
    }
  });

  it("refuses a key that names no manager", () => {
    expect(parseSandboxEnvironment(environment({ npm: [], maven: ["junit"] }))).toEqual({ ok: false, reason: "environment.packages names no manager maven" });
    expect(parseSandboxEnvironment(environment({ "__proto__x": [] })).ok).toBe(false);
  });

  it("refuses a manager's list that is not a list", () => {
    expect(parseSandboxEnvironment(environment({ npm: "express" }))).toEqual({ ok: false, reason: "environment.packages.npm must be a list of at most 32" });
  });

  it.each(MANAGERS)("%s: accepts its documented forms and refuses options, whitespace, URLs, git and file sources and paths", (manager) => {
    for (const entry of VALID[manager]) {
      expect(parseSandboxEnvironment(environment({ [manager]: [entry] })).ok, `${manager} ${entry}`).toBe(true);
    }
    for (const entry of REFUSED_EVERYWHERE) {
      const parsed = parseSandboxEnvironment(environment({ [manager]: [entry] }));
      expect(parsed, `${manager} ${JSON.stringify(entry)}`).toEqual({
        ok: false,
        reason: `environment.packages.${manager} holds an entry that is not a ${manager} package: ${JSON.stringify(entry)}`,
      });
    }
    expect(parseSandboxEnvironment(environment({ [manager]: [42] })).ok, "a non-string entry").toBe(false);
  });

  it("go needs its @version", () => {
    expect(parseSandboxEnvironment(environment({ go: ["golang.org/x/tools/cmd/goimports"] })).ok).toBe(false);
    expect(parseSandboxEnvironment(environment({ go: ["golang.org/x/tools/cmd/goimports@"] })).ok).toBe(false);
    expect(parseSandboxEnvironment(environment({ go: ["golang.org/x/tools/cmd/goimports@latest"] })).ok).toBe(true);
  });

  it("refuses a pin form another manager uses", () => {
    expect(parseSandboxEnvironment(environment({ apt: ["Upper"] })).ok, "apt names are lower case").toBe(false);
    expect(parseSandboxEnvironment(environment({ gem: ["rails@7.1.0"] })).ok, "a gem pins with a colon").toBe(false);
    expect(parseSandboxEnvironment(environment({ pip: ["requests@2.0"] })).ok, "pip pins with a specifier").toBe(false);
    expect(parseSandboxEnvironment(environment({ npm: ["express==4"] })).ok, "npm pins with @").toBe(false);
  });

  it("refuses more than 32 entries for a manager, and an entry over 214 characters", () => {
    const many = Array.from({ length: MAX_PACKAGES_PER_MANAGER }, (_, i) => `pkg${i}`);
    expect(parseSandboxEnvironment(environment({ npm: many })).ok, "exactly 32").toBe(true);
    expect(parseSandboxEnvironment(environment({ npm: [...many, "one-more"] }))).toEqual({ ok: false, reason: "environment.packages.npm must be a list of at most 32" });

    const longest = "a".repeat(MAX_PACKAGE_LENGTH);
    expect(parseSandboxEnvironment(environment({ npm: [longest] })).ok, "exactly 214").toBe(true);
    expect(parseSandboxEnvironment(environment({ npm: [`${longest}a`] })).ok).toBe(false);
    expect([MAX_PACKAGES_PER_MANAGER, MAX_PACKAGE_LENGTH]).toEqual([32, 214]);
  });
});

describe("sandboxEnvironmentFrom", () => {
  it("is undefined when the variable is unset or blank", () => {
    expect(sandboxEnvironmentFrom({})).toBeUndefined();
    expect(sandboxEnvironmentFrom({ [SANDBOX_ENVIRONMENT_ENV]: "" })).toBeUndefined();
    expect(sandboxEnvironmentFrom({ [SANDBOX_ENVIRONMENT_ENV]: "  \n" })).toBeUndefined();
    expect(SANDBOX_ENVIRONMENT_ENV).toBe("STIGMER_SANDBOX_ENVIRONMENT");
  });

  it("reads a valid value", () => {
    const value = { network: "unrestricted", packages: { pip: ["sqlalchemy==2.0.30"] } };
    expect(sandboxEnvironmentFrom({ [SANDBOX_ENVIRONMENT_ENV]: JSON.stringify(value) })).toEqual({
      network: "unrestricted",
      packages: { ...EMPTY, pip: ["sqlalchemy==2.0.30"] },
    });
  });

  it("throws on a value that is not JSON, and on one that does not parse, naming why", () => {
    expect(() => sandboxEnvironmentFrom({ [SANDBOX_ENVIRONMENT_ENV]: "{network:" })).toThrow("STIGMER_SANDBOX_ENVIRONMENT is not JSON");
    expect(() => sandboxEnvironmentFrom({ [SANDBOX_ENVIRONMENT_ENV]: JSON.stringify({ network: "open", packages: {} }) })).toThrow(
      "STIGMER_SANDBOX_ENVIRONMENT: environment.network must be unrestricted or limited",
    );
    expect(() => sandboxEnvironmentFrom({ [SANDBOX_ENVIRONMENT_ENV]: JSON.stringify({ network: "limited", packages: { npm: ["-g"] } }) })).toThrow(
      /environment\.packages\.npm holds an entry/,
    );
  });
});

describe("hasPackages", () => {
  it("is whether any manager lists an entry", () => {
    expect(hasPackages(EMPTY)).toBe(false);
    for (const manager of MANAGERS) expect(hasPackages({ ...EMPTY, [manager]: ["x"] }), manager).toBe(true);
  });
});

describe("the grammars are the contract's", () => {
  /** The text of a proto string literal's body: the escapes protoc reads, and no other. */
  function unescapeProto(body: string): string {
    return body.replace(/\\(.)/g, (_, char: string) => {
      if (char === "\\" || char === '"' || char === "'") return char;
      throw new Error(`an escape this reader does not handle: \\${char}`);
    });
  }

  /** Each manager's field options in `EnvironmentPackages`, read from the contract's text. */
  function contractRules(): Map<string, { readonly pattern: string; readonly maxItems: number; readonly maxLen: number }> {
    const proto = readFileSync(
      resolve(import.meta.dirname, "../../../../../../apis/ai/stigmer/agentic/environment/v1/spec.proto"),
      "utf8",
    );
    const start = proto.indexOf("message EnvironmentPackages {");
    expect(start, "the contract declares EnvironmentPackages").toBeGreaterThanOrEqual(0);
    const body = proto.slice(start);
    const rules = new Map<string, { pattern: string; maxItems: number; maxLen: number }>();
    const field = /repeated string (\w+) = \d+ \[[\s\S]*?max_items: (\d+)[\s\S]*?max_len: (\d+)\s+pattern: "((?:[^"\\]|\\.)*)"/g;
    for (const match of body.matchAll(field)) {
      const [, name, maxItems, maxLen, pattern] = match;
      rules.set(name!, { pattern: unescapeProto(pattern!), maxItems: Number(maxItems), maxLen: Number(maxLen) });
    }
    return rules;
  }

  it("names exactly the runner's managers", () => {
    expect([...contractRules().keys()]).toEqual([...MANAGERS]);
  });

  it.each(MANAGERS)("%s: the runner's pattern and limits equal the contract's", (manager) => {
    const rule = contractRules().get(manager);
    expect(rule, manager).toBeDefined();
    // Both through the RegExp constructor, so `/` reads the same either way.
    expect(PACKAGE_PATTERNS[manager].source).toBe(new RegExp(rule!.pattern).source);
    expect(PACKAGE_PATTERNS[manager].flags).toBe("");
    expect(rule!.maxItems).toBe(MAX_PACKAGES_PER_MANAGER);
    expect(rule!.maxLen).toBe(MAX_PACKAGE_LENGTH);
  });
});
