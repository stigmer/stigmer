/**
 * Pins validate-thinking-mode.ts: fail-closed create-time validation of the
 * thinking mode a turn resolved (#772) against the bundled registry plus two
 * test-local rows, judged
 * on the harness the conversation runs on (#1280). Each case runs
 * ResolveRunConfig first, as the chain does, over a turn with no agent, so
 * the resolved settings are the request's own. The harness comes from the
 * stored session for a turn on an existing session — the row
 * ValidateSessionOrganization recorded under STORED_SESSION_KEY, so neither
 * step reads the store for it — else the new conversation's session_spec,
 * UNSPECIFIED read as native; a session id with no recorded row (a dangling
 * id) is judged on the default harness. The bundled rows it leans on:
 * claude-opus-4.6 and claude-sonnet-5 are adaptive on both entries,
 * claude-haiku-4.5 is budget-shaped, and claude-fable-5 requires thinking.
 * Every bundled model thinks on both harnesses, so the test-local rows
 * carry the harness scoping: split-thinker requires thinking on its native
 * entry and declares no thinking on its claude entry, and claude-only has
 * an adaptive claude entry and no native one.
 */
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  ServiceTier,
  ThinkingMode,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

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
  routineProfile: undefined,
};

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** The bundled registry plus the two rows whose entries differ by harness. */
function documentWithSplitRows(): string {
  const document = JSON.parse(bundledModelRegistryDocument()) as { models: unknown[] };
  document.models.push(
    { id: "split-thinker", harness: "stigmer", capabilities: { thinking: true, thinkingRequired: true } },
    { id: "split-thinker", harness: "claude", capabilities: { thinking: false } },
    { id: "claude-only", harness: "claude", capabilities: { adaptiveThinking: true } },
  );
  return JSON.stringify(document);
}

const registry = new ModelRegistryStore({
  bundledDocument: documentWithSplitRows(),
  upstreamOrigin: "http://unused.test",
  refreshEnabled: false,
  logger: silentLogger,
});

type SpecInit = MessageInitShape<typeof RunSpecSchema>;
type RunConfigInit = NonNullable<SpecInit["runConfig"]>;

type TargetInit = SpecInit["target"];

function contextFor(
  config: RunConfigInit | undefined,
  target: TargetInit,
  recorded: Session | undefined,
): RequestContext<typeof RunSchema> {
  const ctx = new RequestContext(
    RunSchema,
    create(RunSchema, {
      spec: {
        message: "hello",
        target,
        ...(config === undefined ? {} : { runConfig: config }),
      },
    }),
    testCallerIdentity(),
    ApiResourceKind.run,
  );
  if (recorded !== undefined) {
    ctx.set(STORED_SESSION_KEY, recorded);
  }
  return ctx;
}

const onClaude: TargetInit = {
  case: "sessionSpec",
  value: { harness: Harness.CLAUDE },
};
const onNative: TargetInit = {
  case: "sessionSpec",
  value: { harness: Harness.STIGMER },
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

describe("ValidateThinkingMode on the claude harness", () => {
  it("ENABLED with a thinking-capable claude model passes", async () => {
    await expect(
      passes({ modelName: "claude-opus-4.6", thinkingMode: ThinkingMode.ENABLED }, onClaude),
    ).resolves.toBeUndefined();
  });

  it("ENABLED combines freely with FAST — the combination bills as the fast variant", async () => {
    await expect(
      passes(
        { modelName: "claude-opus-4.6", serviceTier: ServiceTier.FAST, thinkingMode: ThinkingMode.ENABLED },
        onClaude,
      ),
    ).resolves.toBeUndefined();
  });

  it("ENABLED without model_name fails closed, naming the claude models that think", async () => {
    const err = await refusal({ thinkingMode: ThinkingMode.ENABLED }, onClaude);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("requires a model_name");
    expect(err.rawMessage).toContain("claude-opus-4.6");
    expect(err.rawMessage).toContain("claude-only");
    expect(err.rawMessage).not.toContain("split-thinker");
  });

  it("ENABLED on a model whose claude entry declares no thinking fails closed: the claude entry is the one that decides", async () => {
    const err = await refusal({ modelName: "split-thinker", thinkingMode: ThinkingMode.ENABLED }, onClaude);
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("no thinking capability");
    expect(err.rawMessage).toContain("split-thinker");
    expect(err.rawMessage).toContain("claude harness");
  });

  it("DISABLED passes on claude when only the model's native entry requires thinking", async () => {
    await expect(
      passes({ modelName: "split-thinker", thinkingMode: ThinkingMode.DISABLED }, onClaude),
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
    const err = await refusal({ modelName: "claude-only", thinkingMode: ThinkingMode.ENABLED }, onNative);
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
    const split = await refusal({ modelName: "split-thinker", thinkingMode: ThinkingMode.DISABLED }, onNative);
    expect(split.rawMessage).toContain("always thinks");
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
  it("a turn on a stored claude session is judged on claude", async () => {
    const claude = storedSession("ses_claude", Harness.CLAUDE);

    await expect(
      passes(
        { modelName: "claude-only", thinkingMode: ThinkingMode.ENABLED },
        inSession("ses_claude"),
        claude,
      ),
    ).resolves.toBeUndefined();
    const err = await refusal(
      { modelName: "split-thinker", thinkingMode: ThinkingMode.ENABLED },
      inSession("ses_claude"),
      claude,
    );
    expect(err.rawMessage).toContain("claude harness");
  });

  it("a turn on a stored native session is judged on native", async () => {
    await expect(
      passes(
        { modelName: "claude-sonnet-5", thinkingMode: ThinkingMode.ENABLED },
        inSession("ses_native"),
        storedSession("ses_native", Harness.STIGMER),
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
      { modelName: "claude-only", thinkingMode: ThinkingMode.ENABLED },
      inSession("ses_missing"),
    );
    expect(err.code).toBe(Code.InvalidArgument);
  });
});
