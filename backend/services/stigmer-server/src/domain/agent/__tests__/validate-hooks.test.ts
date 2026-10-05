/**
 * Pins ValidateHooks (domain/agent/steps.ts), the step that checks an
 * agent's hook sources where the proto's rules cannot reach: each plugin
 * listed once by slug (the slug is what a run records as the deciding hook,
 * so two plugins sharing one would share a lease), one inline block at
 * most, and an inline block held to the rules a plugin's hooks are held to
 * at install: Claude Code's format, the two tool-call events, a matcher
 * the library accepts, an `if` in a permission rule's shape, no
 * fail_closed. An omitted format is filled with Claude Code's; a valid
 * block passes unchanged otherwise. The step is driven directly over a
 * request context; the chains that run it are pinned in agent.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { HookSource } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { HookFormat } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newValidateHooksStep } from "../steps.js";

type AgentInit = Parameters<typeof create<typeof AgentSchema>>[1];

function contextWith(hooks: unknown[]): RequestContext<typeof AgentSchema> {
  const init = {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: { name: "Guarded", org: "acme" },
    spec: { instructions: "help the user with their tasks", hooks },
  } as AgentInit;
  return new RequestContext(
    AgentSchema,
    create(AgentSchema, init),
    testCallerIdentity(),
    ApiResourceKind.agent,
  );
}

const plugin = (slug: string, org = "acme") => ({
  source: {
    case: "plugin",
    value: { kind: ApiResourceKind.plugin, org, slug },
  },
});

interface GroupInit {
  event: string;
  matcher?: string;
  handlers?: Array<{
    command: string;
    condition?: string;
    failClosed?: boolean;
  }>;
}

const inline = (groups: GroupInit[], format?: HookFormat) => ({
  source: {
    case: "inline",
    value: {
      ...(format !== undefined && { format }),
      groups: groups.map((g) => ({
        event: g.event,
        matcher: g.matcher ?? "",
        handlers: g.handlers ?? [{ command: "guard" }],
      })),
    },
  },
});

function refusal(hooks: unknown[]): ConnectError {
  try {
    newValidateHooksStep().execute(contextWith(hooks));
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected the step to refuse");
}

function inlineOf(
  ctx: RequestContext<typeof AgentSchema>,
): HookSource["source"] {
  return ctx.newState.spec!.hooks[0]!.source;
}

describe("ValidateHooks", () => {
  it("passes plugins with distinct slugs and one valid inline block, filling Claude Code's format", () => {
    const ctx = contextWith([
      inline([
        {
          event: "PreToolUse",
          matcher: "Bash|Write",
          handlers: [{ command: "guard", condition: "Bash(git push *)" }],
        },
        { event: "PostToolUse", matcher: "mcp__github__.*" },
      ]),
      plugin("safety"),
      plugin("audit", "globex"),
    ]);
    newValidateHooksStep().execute(ctx);
    const source = inlineOf(ctx);
    expect(source.case).toBe("inline");
    expect(source.case === "inline" && source.value.format).toBe(
      HookFormat.CLAUDE_CODE,
    );
  });

  it("keeps an explicit Claude Code format, and passes an agent with no hooks", () => {
    const ctx = contextWith([
      inline([{ event: "PreToolUse" }], HookFormat.CLAUDE_CODE),
    ]);
    newValidateHooksStep().execute(ctx);
    const source = inlineOf(ctx);
    expect(source.case === "inline" && source.value.format).toBe(
      HookFormat.CLAUDE_CODE,
    );
    expect(() => newValidateHooksStep().execute(contextWith([]))).not.toThrow();
  });

  it("leaves a source that names nothing to the proto's own oneof rule", () => {
    expect(() => newValidateHooksStep().execute(contextWith([{}]))).not.toThrow();
  });

  it.each([
    [
      "two plugins with one slug, even from two organizations",
      [plugin("safety"), plugin("safety", "globex")],
      "hooks lists plugin 'safety' more than once; list each plugin once, and never two plugins that share a slug",
    ],
    [
      "a second inline block",
      [inline([{ event: "PreToolUse" }]), inline([{ event: "PostToolUse" }])],
      "hooks carries more than one inline block; write the agent's own hooks in one block",
    ],
    [
      "a block in Cursor's format",
      [inline([{ event: "preToolUse" }], HookFormat.CURSOR)],
      "the agent's hooks block is in Cursor's format; an agent's own hooks are written in Claude Code's format",
    ],
    [
      "an event Stigmer does not run",
      [inline([{ event: "Stop" }])],
      "the agent's hooks block names event 'Stop', which Stigmer does not run; use PreToolUse or PostToolUse",
    ],
    [
      "a matcher that is not a list or a regular expression",
      [inline([{ event: "PreToolUse", matcher: "[a-" }])],
      "the agent's PreToolUse hook has matcher '[a-', which is not '*', a list of tool names or a regular expression",
    ],
    [
      "a condition that is not a permission rule",
      [
        inline([
          {
            event: "PreToolUse",
            handlers: [{ command: "g", condition: "git push" }],
          },
        ]),
      ],
      "the agent's PreToolUse hook has condition 'git push', which is not a permission rule such as 'Bash' or 'Bash(git push *)'",
    ],
    [
      "fail_closed on a Claude Code handler",
      [
        inline([
          {
            event: "PostToolUse",
            handlers: [{ command: "g", failClosed: true }],
          },
        ]),
      ],
      "the agent's PostToolUse hook sets fail_closed, which Claude Code hooks do not have: a Claude Code hook that fails lets the call through",
    ],
  ])("refuses %s with InvalidArgument", (_case, hooks, message) => {
    const error = refusal(hooks);
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(message);
  });
});
