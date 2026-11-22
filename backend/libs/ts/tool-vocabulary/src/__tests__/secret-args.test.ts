/**
 * The secret argument names: the one table the runner redacts with and the
 * custom-tool check refuses by, held to the cross-language fixture the
 * runner's redaction and `@stigmer/client`'s mirror are held to
 * (test/fixtures/tool-view/secret-args.json), so no copy moves alone.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SECRET_ARG_KEYS, isSecretArgKey } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, "../../../../../../test/fixtures/tool-view/secret-args.json"), "utf8")) as { keys: string[] };

describe("SECRET_ARG_KEYS", () => {
  it("is the fixture's key set", () => {
    expect([...SECRET_ARG_KEYS].sort()).toEqual([...fixture.keys].sort());
  });
});

describe("isSecretArgKey", () => {
  it("matches a secret name whatever its case, and nothing that only contains one", () => {
    expect(isSecretArgKey("auth")).toBe(true);
    expect(isSecretArgKey("Api_Key")).toBe(true);
    expect(isSecretArgKey("AUTHORIZATION")).toBe(true);
    expect(isSecretArgKey("auth_method")).toBe(false);
    expect(isSecretArgKey("token_count")).toBe(false);
  });
});
