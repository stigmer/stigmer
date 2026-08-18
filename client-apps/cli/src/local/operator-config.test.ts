import { describe, expect, it } from "vitest";
import type { Config } from "../config/config.js";
import {
  readOperator,
  resolveOperatorIdentity,
  setOperator,
  validateOperatorIdentity,
} from "./operator-config.js";

function config(local?: unknown): Config {
  return { backend: { type: "local", local } };
}

describe("resolveOperatorIdentity", () => {
  it("honors env > config, never mixing sources", () => {
    const cfg = config({ operator: { email: "cfg@example.com", name: "Config Name" } });

    // Env email brings the env name (or none) — the config name must not
    // ride along under an env identity, that would be attribution lying.
    expect(resolveOperatorIdentity(cfg, { STIGMER_OPERATOR_EMAIL: "env@example.com" })).toEqual({
      email: "env@example.com",
    });
    expect(
      resolveOperatorIdentity(cfg, {
        STIGMER_OPERATOR_EMAIL: "env@example.com",
        STIGMER_OPERATOR_NAME: "Env Name",
      }),
    ).toEqual({ email: "env@example.com", name: "Env Name" });

    expect(resolveOperatorIdentity(cfg, {})).toEqual({
      email: "cfg@example.com",
      name: "Config Name",
    });
  });

  it("returns undefined when neither source has an email — the anonymous default", () => {
    expect(resolveOperatorIdentity(config(), {})).toBeUndefined();
    expect(resolveOperatorIdentity(config({ operator: {} }), {})).toBeUndefined();
    // Whitespace-only values are unset, matching the server's TrimSpace.
    expect(resolveOperatorIdentity(config(), { STIGMER_OPERATOR_EMAIL: "  " })).toBeUndefined();
  });

  it("trims values, matching the server's boot check", () => {
    const cfg = config({ operator: { email: " ada@example.com ", name: " Ada " } });
    expect(resolveOperatorIdentity(cfg, {})).toEqual({ email: "ada@example.com", name: "Ada" });
  });
});

describe("validateOperatorIdentity", () => {
  it("mirrors the server's boot rules: minimal @ check, name requires email", () => {
    expect(validateOperatorIdentity("ada@example.com", "Ada")).toBeUndefined();
    expect(validateOperatorIdentity("ada@example.com", "")).toBeUndefined();
    expect(validateOperatorIdentity("", "")).toBeUndefined(); // "no identity" is valid

    expect(validateOperatorIdentity("not-an-email", "")).toContain("missing '@'");
    expect(validateOperatorIdentity("", "Ada")).toContain("set both or neither");
  });
});

describe("setOperator", () => {
  it("preserves sibling local keys and can clear the section", () => {
    const cfg = config({ temporal: { managed: true }, llm: { provider: "anthropic" } });
    const updated = setOperator(cfg, { email: "ada@example.com", name: "Ada" });
    expect(readOperator(updated)).toEqual({ email: "ada@example.com", name: "Ada" });
    expect((updated.backend.local as { temporal: unknown }).temporal).toEqual({ managed: true });
    expect((updated.backend.local as { llm: unknown }).llm).toEqual({ provider: "anthropic" });

    const cleared = setOperator(updated, undefined);
    expect(readOperator(cleared)).toBeUndefined();
    expect((cleared.backend.local as { temporal: unknown }).temporal).toEqual({ managed: true });
  });
});
