/**
 * The one spec edit both ways of switching a plugin's hooks on make. Pins:
 * the plugin is appended after the sources the agent had, once; every
 * variable its hooks read in exec form that the agent does not declare is
 * declared as a required secret, and a declared one is left as it is; a
 * shell-form command's text is not read; the rest of the input is kept.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { HookConfigSchema, HookFormat } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import type { AgentInput } from "@stigmer/sdk";
import { hookVariablesToDeclare, listsPluginHooks, withPluginHooks } from "../plugin-on-agent.js";

const GUARD = { org: "org_1", slug: "guard" };
const CONFIG = create(HookConfigSchema, {
  format: HookFormat.CLAUDE_CODE,
  groups: [
    {
      event: "PreToolUse",
      handlers: [
        { command: "python3", args: ["guard.py", "${user_config.API_TOKEN}", "${user_config.REGION}"] },
        { command: "echo ${user_config.SHELL_ONLY}" },
      ],
    },
  ],
});

const AGENT: AgentInput = {
  org: "org_1",
  name: "reviewer",
  instructions: "Review.",
  hooks: [{ inline: { format: HookFormat.CLAUDE_CODE, groups: [] } }],
  env: { REGION: { description: "Where it runs" } },
};

describe("withPluginHooks", () => {
  it("appends the plugin and declares the variables its hooks read that the agent does not", () => {
    const next = withPluginHooks(AGENT, GUARD, CONFIG);
    expect(next.hooks).toEqual([...(AGENT.hooks ?? []), { plugin: GUARD }]);
    expect(next.env).toEqual({ REGION: { description: "Where it runs" }, API_TOKEN: { isSecret: true } });
    expect(next.instructions).toBe("Review.");
    expect(hookVariablesToDeclare(AGENT, CONFIG)).toEqual(["API_TOKEN"]);
  });

  it("lists the plugin once when the agent already names it", () => {
    const once = withPluginHooks(AGENT, GUARD, CONFIG);
    expect(listsPluginHooks(once, GUARD)).toBe(true);
    const twice = withPluginHooks(once, GUARD, CONFIG);
    expect(twice.hooks).toEqual(once.hooks);
    expect(twice.env).toEqual(once.env);
  });

  it("declares a variable named __proto__ as a variable, not a prototype", () => {
    const proto = create(HookConfigSchema, {
      groups: [{ event: "PreToolUse", handlers: [{ command: "node", args: ["${user_config.__proto__}"] }] }],
    });
    const next = withPluginHooks({ org: "org_1", name: "a", instructions: "i" }, GUARD, proto);
    expect(Object.keys(next.env ?? {})).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(next.env)).toBe(Object.prototype);
  });

  it("adds only the reference for hooks it has not read", () => {
    const next = withPluginHooks({ org: "org_1", name: "a", instructions: "i" }, GUARD, undefined);
    expect(next.hooks).toEqual([{ plugin: GUARD }]);
    expect(next.env).toBeUndefined();
  });
});
