/**
 * Pins validate-thinking-mode.ts: fail-closed create-time validation of the
 * thinking mode a turn resolved (#772) against the BUNDLED registry, judged
 * on the harness the conversation runs on (#1280). Each case runs
 * ResolveRunConfig first, as the chain does, over a turn with no agent, so
 * the resolved settings are the request's own. The harness comes from the
 * stored session for a turn on an existing session — the row
 * ValidateSessionOrganization recorded under STORED_SESSION_KEY, so neither
 * step reads the store for it — else the new conversation's session_spec,
 * UNSPECIFIED read as native; a session id with no recorded row (a dangling
 * id) is judged on the default harness. The bundled rows it leans on: claude-opus-4-6 declares
 * `thinking` on its cursor entry and composer-2.5 declares none;
 * claude-sonnet-5 is adaptive on its native entry and claude-haiku-4.5 is
 * budget-shaped; claude-fable-5's native entry requires thinking.
 */
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import {
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { bundledModelRegistryDocument } from "../../../modelcatalog/bundled.js";
import { ModelRegistryStore } from "../../../modelcatalog/model-registry-store.js";
import { STORED_SESSION_KEY } from "../session-binding.js";
import type { Store } from "../../../store/interface.js";
import { newResolveRunConfigStep } from "../resolve-run-config.js";
import { newValidateThinkingModeStep } from "../validate-thinking-mode.js";

/** The resolution's deps for a turn with no agent: nothing is read. */
const unreadStore = {
  store: {} as Store,
  runLanes: undefined,
  scheduleProfile: undefined,
};

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const registry = new ModelRegistryStore({
  bundledDocument: bundledModelRegistryDocument(),
  upstreamOrigin: "http://unused.test",
  refreshEnabled: false,
  logger: silentLogger,
});

type SpecInit = MessageInitShape<typeof AgentRunSpecSchema>;
type RunConfigInit = NonNullable<SpecInit["runConfig"]>;

type TargetInit = SpecInit["target"];

function contextFor(
  config: RunConfigInit | undefined,
  target: TargetInit,
  recorded: Session | undefined,
): RequestContext<typeof AgentRunSchema> {
  const ctx = new RequestContext(
    AgentRunSchema,
    create(AgentRunSchema, {
      spec: {
        message: "hello",
        target,
        ...(config === undefined ? {} : { runConfig: config }),
      },
    }),
    testCallerIdentity(),
    ApiResourceKind.agent_run,
  );
  if (recorded !== undefined) {
    ctx.set(STORED_SESSION_KEY, recorded);
  }
  return ctx;
}

const onCursor: TargetInit = {
  case: "sessionSpec",
  value: { harness: Harness.CURSOR },
};
const onNative: TargetInit = {
  case: "sessionSpec",
  value: { harness: Harness.NATIVE },
};

async function passes(
  config: RunConfigInit | undefined,
  target: TargetInit = { case: undefined },
  recorded?: Session,
): Promise<void> {
  const ctx = contextFor(config, target, recorded);
  await newResolveRunConfigStep(unreadStore).execute(ctx);
  await newValidateThinkingModeStep(registry).execute(ctx);
}

async function refusal(
  config: RunConfigInit,
  target: TargetInit = { case: undefined },
  recorded?: Session,
): Promise<ConnectError> {
  try {
    await passes(config, target, recorded);
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a fail-closed refusal, step passed");
}

/** The session ValidateSessionOrganization would have recorded. */
function storedSession(id: string, harness: Harness): Session {
  return create(SessionSchema, {
    metadata: { id, org: "acme" },
    spec: { harness },
  });
}

/** The target oneof's existing-session arm. */
function inSession(sessionId: string): TargetInit {
  return { case: "sessionId", value: sessionId };
}

describe("ValidateThinkingMode: modes that need no harness", () => {
  it("no run_config passes", async () => {
    await expect(passes(undefined)).resolves.toBeUndefined();
  });

  it("explicit DISABLED passes without a model", async () => {
    await expect(passes({ thinkingMode: ThinkingMode.DISABLED })).resolves.toBeUndefined();
  });
});

describe("ValidateThinkingMode on the cursor harness", () => {
  it("ENABLED with a thinking-capable cursor model passes", async () => {
    await expect(
      passes({ modelName: "claude-opus-4-6", thinkingMode: ThinkingMode.ENABLED }, onCursor),
    ).resolves.toBeUndefined();
  });

  it("ENABLED combines freely with FAST — the combination bills as the fast variant", async () => {
    await expect(
      passes(
        { modelName: "claude-opus-4-6", serviceTier: ServiceTier.FAST, thinkingMode: ThinkingMode.ENABLED },
        onCursor,
      ),
    ).resolves.toBeUndefined();
  });

  it("ENABLED without model_name fails closed, naming the cursor models that think", async () => {
    const err = await refusal({ thinkingMode: ThinkingMode.ENABLED }, onCursor);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("requires a model_name");
    expect(err.rawMessage).toContain("claude-opus-4-6");
  });

  it("ENABLED on a cursor model without the capability fails closed", async () => {
    const err = await refusal({ modelName: "composer-2.5", thinkingMode: ThinkingMode.ENABLED }, onCursor);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("no thinking capability");
    expect(err.rawMessage).toContain("composer-2.5");
    expect(err.rawMessage).toContain("cursor harness");
  });

  it("ENABLED on a native-only model fails closed on cursor: the cursor entry is the one that decides", async () => {
    const err = await refusal({ modelName: "claude-sonnet-4.6", thinkingMode: ThinkingMode.ENABLED }, onCursor);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("cursor harness");
  });

  it("DISABLED on claude-fable-5 passes on cursor: only its native entry requires thinking", async () => {
    await expect(
      passes({ modelName: "claude-fable-5", thinkingMode: ThinkingMode.DISABLED }, onCursor),
    ).resolves.toBeUndefined();
  });
});

describe("ValidateThinkingMode on the native harness (#1280)", () => {
  it("ENABLED on an adaptive native model passes — the #1280 case, claude-sonnet-5 on a native session", async () => {
    await expect(
      passes({ modelName: "claude-sonnet-5", thinkingMode: ThinkingMode.ENABLED }, onNative),
    ).resolves.toBeUndefined();
  });

  it("ENABLED on a budget-shaped native model passes", async () => {
    await expect(
      passes({ modelName: "claude-haiku-4.5", thinkingMode: ThinkingMode.ENABLED }, onNative),
    ).resolves.toBeUndefined();
  });

  it("an UNSPECIFIED harness is native", async () => {
    await expect(
      passes({ modelName: "claude-sonnet-4.6", thinkingMode: ThinkingMode.ENABLED }, { case: "sessionSpec", value: {} }),
    ).resolves.toBeUndefined();
    await expect(passes({ modelName: "claude-sonnet-4.6", thinkingMode: ThinkingMode.ENABLED })).resolves.toBeUndefined();
  });

  it("ENABLED on a model with no native entry fails closed, naming the native models that think", async () => {
    const err = await refusal({ modelName: "composer-2.5", thinkingMode: ThinkingMode.ENABLED }, onNative);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("native harness");
    expect(err.rawMessage).toContain("claude-sonnet-5");
    expect(err.rawMessage).toContain("claude-haiku-4.5");
  });

  it("ENABLED on an unknown model fails closed", async () => {
    const err = await refusal({ modelName: "not-a-model", thinkingMode: ThinkingMode.ENABLED }, onNative);
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("an explicit DISABLED on a model that requires thinking fails closed", async () => {
    const err = await refusal({ modelName: "claude-fable-5", thinkingMode: ThinkingMode.DISABLED }, onNative);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("always thinks");
    expect(err.rawMessage).toContain("claude-fable-5");
  });

  it("UNSPECIFIED and ENABLED pass on a model that requires thinking", async () => {
    await expect(passes({ modelName: "claude-fable-5" }, onNative)).resolves.toBeUndefined();
    await expect(
      passes({ modelName: "claude-fable-5", thinkingMode: ThinkingMode.ENABLED }, onNative),
    ).resolves.toBeUndefined();
  });

  it("an explicit DISABLED passes on a model that may turn thinking off", async () => {
    await expect(
      passes({ modelName: "claude-sonnet-5", thinkingMode: ThinkingMode.DISABLED }, onNative),
    ).resolves.toBeUndefined();
  });
});

describe("ValidateThinkingMode reads the recorded session's harness", () => {
  it("a turn on a stored cursor session is judged on cursor", async () => {
    const cursor = storedSession("ses_cursor", Harness.CURSOR);

    await expect(
      passes(
        { modelName: "claude-opus-4-6", thinkingMode: ThinkingMode.ENABLED },
        inSession("ses_cursor"),
        cursor,
      ),
    ).resolves.toBeUndefined();
    const err = await refusal(
      { modelName: "claude-sonnet-4.6", thinkingMode: ThinkingMode.ENABLED },
      inSession("ses_cursor"),
      cursor,
    );
    expect(err.rawMessage).toContain("cursor harness");
  });

  it("a turn on a stored native session is judged on native", async () => {
    await expect(
      passes(
        { modelName: "claude-sonnet-5", thinkingMode: ThinkingMode.ENABLED },
        inSession("ses_native"),
        storedSession("ses_native", Harness.NATIVE),
      ),
    ).resolves.toBeUndefined();
  });

  it("a session id with no recorded session (a dangling id) is judged on the default native harness", async () => {
    await expect(
      passes(
        { modelName: "claude-sonnet-5", thinkingMode: ThinkingMode.ENABLED },
        inSession("ses_missing"),
      ),
    ).resolves.toBeUndefined();
    const err = await refusal(
      { modelName: "composer-2.5", thinkingMode: ThinkingMode.ENABLED },
      inSession("ses_missing"),
    );
    expect(err.code).toBe(Code.InvalidArgument);
  });
});
