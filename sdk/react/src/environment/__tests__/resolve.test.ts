/**
 * Pins which Environment applies and why, as a page previews it and as a
 * conversation's record says it:
 * - the preview's order is the server's: the conversation's own pick, its
 *   routine's, its agent's default, its organization's default, else none,
 *   held to `EnvironmentSource`'s values so the two orders cannot drift;
 * - an empty reference counts as unset;
 * - a conversation on the person's own machine, or on a server whose
 *   conversations run in no sandbox it starts, gets none whatever the
 *   defaults say, and the desktop's `"local"` target is the former, the
 *   server's `applies: false` the latter for a target-less conversation
 *   only;
 * - the record maps each wire source to its name, and unset reads as none;
 * - the copy says each case in the words every surface shows.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { EnvironmentSource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";

import {
  ENVIRONMENT_SOURCE_ORDER,
  environmentChoiceOfStatus,
  environmentSourceName,
  environmentsNotApplying,
  resolveEnvironmentChoice,
} from "../resolve";
import { describeEnvironmentChoice, inheritedRowLabel } from "../copy";

const ORG = "org_acme";
const ref = (slug: string) => ({ org: ORG, slug });

describe("resolveEnvironmentChoice", () => {
  it("follows the server's order, the order EnvironmentSource numbers", () => {
    const wire: Record<string, EnvironmentSource> = {
      session: EnvironmentSource.SESSION,
      routine: EnvironmentSource.ROUTINE,
      agent: EnvironmentSource.AGENT,
      organization: EnvironmentSource.ORGANIZATION,
    };
    const numbers = ENVIRONMENT_SOURCE_ORDER.map((source) => wire[source]!);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    for (const source of ENVIRONMENT_SOURCE_ORDER) {
      expect(environmentSourceName(wire[source]!)).toBe(source);
    }
  });

  it("takes the first source that names one", () => {
    const all = { own: ref("mine"), routine: ref("rounds"), agent: ref("agents"), organization: ref("house") };
    expect(resolveEnvironmentChoice(all)).toEqual({ kind: "chosen", environment: ref("mine"), source: "session" });
    expect(resolveEnvironmentChoice({ ...all, own: undefined })).toEqual({
      kind: "chosen",
      environment: ref("rounds"),
      source: "routine",
    });
    expect(resolveEnvironmentChoice({ agent: ref("agents"), organization: ref("house") })).toEqual({
      kind: "chosen",
      environment: ref("agents"),
      source: "agent",
    });
    expect(resolveEnvironmentChoice({ organization: ref("house") })).toEqual({
      kind: "chosen",
      environment: ref("house"),
      source: "organization",
    });
    expect(resolveEnvironmentChoice({})).toEqual({ kind: "none" });
  });

  it("reads an empty reference as unset", () => {
    const empty = create(ApiResourceReferenceSchema, {});
    expect(resolveEnvironmentChoice({ own: null, agent: empty, organization: ref("house") })).toEqual({
      kind: "chosen",
      environment: ref("house"),
      source: "organization",
    });
  });

  it("gives none, whatever the defaults say, where no Environment governs", () => {
    const all = { own: ref("mine"), agent: ref("agents"), organization: ref("house") };
    expect(resolveEnvironmentChoice({ ...all, notApplying: "own-machine" })).toEqual({ kind: "own-machine" });
    expect(resolveEnvironmentChoice({ ...all, notApplying: "not-on-server" })).toEqual({ kind: "not-on-server" });
  });
});

describe("environmentsNotApplying", () => {
  it("is the person's own machine under the desktop's local target, whatever the server says", () => {
    expect(environmentsNotApplying({ applies: true }, "local")).toBe("own-machine");
    expect(environmentsNotApplying(undefined, "local")).toBe("own-machine");
  });

  it("is the server's answer for a conversation that names no target", () => {
    expect(environmentsNotApplying({ applies: false }, undefined)).toBe("not-on-server");
    expect(environmentsNotApplying({ applies: true }, undefined)).toBeUndefined();
  });

  it("leaves an older server, and an explicit cloud target, to the server's refusal", () => {
    expect(environmentsNotApplying(undefined, undefined)).toBeUndefined();
    expect(environmentsNotApplying({ applies: false }, "cloud")).toBeUndefined();
  });
});

describe("environmentChoiceOfStatus", () => {
  it("reads the conversation's record", () => {
    const environment = create(ApiResourceReferenceSchema, { org: ORG, slug: "data-science", id: "env_1" });
    expect(environmentChoiceOfStatus({ environment, environmentSource: EnvironmentSource.AGENT })).toEqual({
      kind: "chosen",
      environment: { org: ORG, slug: "data-science", id: "env_1" },
      source: "agent",
    });
  });

  it("reads an unset Environment as none, or as the own machine for a local conversation", () => {
    expect(environmentChoiceOfStatus({ environmentSource: EnvironmentSource.UNSPECIFIED })).toEqual({ kind: "none" });
    expect(environmentChoiceOfStatus(undefined, true)).toEqual({ kind: "own-machine" });
  });
});

describe("the copy", () => {
  it("says each choice in one line", () => {
    expect(describeEnvironmentChoice({ kind: "chosen", environment: ref("data-science"), source: "agent" })).toBe(
      "data-science · the agent's default",
    );
    expect(
      describeEnvironmentChoice({ kind: "chosen", environment: ref("base-tools"), source: "organization" }, () => "Base tools"),
    ).toBe("Base tools · the organization's default");
    expect(describeEnvironmentChoice({ kind: "chosen", environment: ref("x"), source: "session" })).toBe(
      "x · chosen for this conversation",
    );
    expect(describeEnvironmentChoice({ kind: "chosen", environment: ref("x"), source: "routine" })).toBe(
      "x · set by the routine",
    );
    expect(describeEnvironmentChoice({ kind: "none" })).toBe("No environment: the server's standard sandbox");
    expect(describeEnvironmentChoice({ kind: "own-machine" })).toBe(
      "Environments don't apply here: this conversation runs on your own machine",
    );
    expect(describeEnvironmentChoice({ kind: "not-on-server" })).toBe(
      "Environments don't apply here: conversations on this server don't run in sandboxes it starts",
    );
  });

  it("labels a picker's first row by what it inherits", () => {
    expect(inheritedRowLabel({ kind: "chosen", environment: ref("data-science"), source: "agent" })).toBe(
      "Default: data-science (the agent's default)",
    );
    expect(inheritedRowLabel({ kind: "none" })).toBe("Default: none");
  });
});
