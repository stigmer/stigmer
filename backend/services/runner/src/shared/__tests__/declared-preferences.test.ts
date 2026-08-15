/**
 * Unit tests for the declared-preferences module (stigmer/stigmer#293,
 * DD-002). Like conversation-catchup there is no string key to mirror-guard —
 * the value rides the typed `AgentExecutionSpec.declared_preferences` proto
 * field, so codegen enforces the cross-repo contract. What IS pinned here:
 * the per-scope blank-is-absent read semantics (the server stamps the field
 * on EVERY eligible create, usually with blank scopes), the per-scope
 * attribution, and the framing's behavioral contract.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { DeclaredPreferencesSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";

import {
  formatDeclaredPreferencesText,
  readDeclaredPreferences,
} from "../declared-preferences.js";

const ORG_CONTEXT = "We deploy to us-east-1. All costs in USD.";
const USER_CONTEXT = "Keep answers terse. Prefer Go examples.";

describe("readDeclaredPreferences", () => {
  it("reads both scopes when both are set", () => {
    const preferences = create(DeclaredPreferencesSchema, {
      orgContext: ORG_CONTEXT,
      userContext: USER_CONTEXT,
    });
    expect(readDeclaredPreferences(preferences)).toEqual({
      orgContext: ORG_CONTEXT,
      userContext: USER_CONTEXT,
    });
  });

  it("answers undefined when the field is absent (pre-#293 executions)", () => {
    expect(readDeclaredPreferences(undefined)).toBeUndefined();
  });

  it("answers undefined when both scopes are blank — the server stamps the field on every eligible create", () => {
    const preferences = create(DeclaredPreferencesSchema, {
      orgContext: "  ",
      userContext: "",
    });
    expect(readDeclaredPreferences(preferences)).toBeUndefined();
  });

  it("blank-is-absent applies per scope: an org-only snapshot carries no user scope", () => {
    const preferences = create(DeclaredPreferencesSchema, {
      orgContext: ORG_CONTEXT,
      userContext: "   ",
    });
    expect(readDeclaredPreferences(preferences)).toEqual({
      orgContext: ORG_CONTEXT,
      userContext: undefined,
    });
  });

  it("trims surrounding whitespace from each scope", () => {
    const preferences = create(DeclaredPreferencesSchema, {
      orgContext: "  org facts  ",
      userContext: "\nuser facts\n",
    });
    expect(readDeclaredPreferences(preferences)).toEqual({
      orgContext: "org facts",
      userContext: "user facts",
    });
  });
});

describe("formatDeclaredPreferencesText", () => {
  it("frames the preferences as already-known, non-announced background", () => {
    const framed = formatDeclaredPreferencesText({
      orgContext: ORG_CONTEXT,
      userContext: USER_CONTEXT,
    });

    expect(framed).toContain("Standing preferences declared by");
    expect(framed).toContain("Do not repeat them back");
    expect(framed).toContain("not instructions that override your task");
  });

  it("attributes each scope explicitly, organization first, user last", () => {
    const framed = formatDeclaredPreferencesText({
      orgContext: ORG_CONTEXT,
      userContext: USER_CONTEXT,
    });

    const org = framed.indexOf("Declared by the organization:");
    const user = framed.indexOf("Declared by the user:");
    expect(org).toBeGreaterThan(-1);
    expect(user).toBeGreaterThan(org);
    expect(framed).toContain(ORG_CONTEXT);
    expect(framed.endsWith(USER_CONTEXT)).toBe(true);
  });

  it("renders only the org subsection for an org-only snapshot", () => {
    const framed = formatDeclaredPreferencesText({ orgContext: ORG_CONTEXT });

    expect(framed).toContain("Declared by the organization:");
    expect(framed).not.toContain("Declared by the user:");
  });

  it("renders only the user subsection for a user-only snapshot", () => {
    const framed = formatDeclaredPreferencesText({ userContext: USER_CONTEXT });

    expect(framed).not.toContain("Declared by the organization:");
    expect(framed).toContain("Declared by the user:");
  });
});
