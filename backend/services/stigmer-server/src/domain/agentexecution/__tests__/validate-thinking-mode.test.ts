/**
 * Pins validate-thinking-mode.ts: fail-closed create-time validation of
 * ExecutionConfig.thinking_mode (#772) against the BUNDLED registry, judged
 * on the harness the execution will run on (#1280). The harness comes from
 * the stored session for a turn on an existing session, else the bootstrap
 * session_spec, UNSPECIFIED read as native; a real SQLite store holds the
 * sessions. The bundled rows it leans on: claude-opus-4-6 declares
 * `thinking` on its cursor entry and composer-2.5 declares none;
 * claude-sonnet-5 is adaptive on its native entry and claude-haiku-4.5 is
 * budget-shaped; claude-fable-5's native entry requires thinking.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { bundledModelRegistryDocument } from "../../workflow/registry/bundled.js";
import { ModelRegistryStore } from "../../workflow/registry/model-registry-store.js";
import { newValidateThinkingModeStep } from "../validate-thinking-mode.js";

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

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "validate-thinking-mode-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type SpecInit = MessageInitShape<typeof AgentExecutionSpecSchema>;
type ExecutionConfigInit = NonNullable<SpecInit["executionConfig"]>;

function contextFor(
  config: ExecutionConfigInit | undefined,
  target: Pick<SpecInit, "sessionId" | "sessionSpec"> = {},
): RequestContext<typeof AgentExecutionSchema> {
  return new RequestContext(
    AgentExecutionSchema,
    create(AgentExecutionSchema, {
      spec: {
        message: "hello",
        ...target,
        ...(config === undefined ? {} : { executionConfig: config }),
      },
    }),
    testCallerIdentity(),
    ApiResourceKind.agent_execution,
  );
}

const onCursor = { sessionSpec: { harness: Harness.CURSOR } };
const onNative = { sessionSpec: { harness: Harness.NATIVE } };

async function passes(
  config: ExecutionConfigInit | undefined,
  target: Pick<SpecInit, "sessionId" | "sessionSpec"> = {},
  onStore: Store = store,
): Promise<void> {
  await newValidateThinkingModeStep(registry, onStore).execute(contextFor(config, target));
}

async function refusal(
  config: ExecutionConfigInit,
  target: Pick<SpecInit, "sessionId" | "sessionSpec"> = {},
  onStore: Store = store,
): Promise<ConnectError> {
  try {
    await passes(config, target, onStore);
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a fail-closed refusal, step passed");
}

async function storeSession(id: string, harness: Harness): Promise<void> {
  await store.saveResource(
    ApiResourceKind.session,
    id,
    SessionSchema,
    create(SessionSchema, { metadata: { id, org: "acme" }, spec: { harness } }),
  );
}

describe("ValidateThinkingMode: modes that need no harness", () => {
  it("no execution_config passes", async () => {
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
    expect(err.rawMessage).toContain("requires execution_config.model_name");
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
      passes({ modelName: "claude-sonnet-4.6", thinkingMode: ThinkingMode.ENABLED }, { sessionSpec: {} }),
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

describe("ValidateThinkingMode reads a stored session's harness", () => {
  it("a turn on a stored cursor session is judged on cursor", async () => {
    await storeSession("ses_cursor", Harness.CURSOR);

    await expect(
      passes({ modelName: "claude-opus-4-6", thinkingMode: ThinkingMode.ENABLED }, { sessionId: "ses_cursor" }),
    ).resolves.toBeUndefined();
    const err = await refusal({ modelName: "claude-sonnet-4.6", thinkingMode: ThinkingMode.ENABLED }, { sessionId: "ses_cursor" });
    expect(err.rawMessage).toContain("cursor harness");
  });

  it("a turn on a stored native session is judged on native, whatever the request's session_spec says", async () => {
    await storeSession("ses_native", Harness.NATIVE);

    await expect(
      passes(
        { modelName: "claude-sonnet-5", thinkingMode: ThinkingMode.ENABLED },
        { sessionId: "ses_native", sessionSpec: { harness: Harness.CURSOR } },
      ),
    ).resolves.toBeUndefined();
  });

  it("a dangling session id is judged on the default native harness", async () => {
    await expect(
      passes({ modelName: "claude-sonnet-5", thinkingMode: ThinkingMode.ENABLED }, { sessionId: "ses_missing" }),
    ).resolves.toBeUndefined();
  });

  it("a store fault is Internal, never a reading of the session", async () => {
    const faulty = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "getResource") {
          return async () => {
            throw new Error("simulated store fault");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const err = await refusal(
      { modelName: "claude-sonnet-5", thinkingMode: ThinkingMode.ENABLED },
      { sessionId: "ses_any" },
      faulty,
    );
    expect(err.code).toBe(Code.Internal);
  });

  it("a mode that needs no harness never reads the store", async () => {
    const untouchable = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "getResource") {
          throw new Error("the store must not be read");
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await expect(passes(undefined, { sessionId: "ses_any" }, untouchable)).resolves.toBeUndefined();
    await expect(
      passes({ thinkingMode: ThinkingMode.DISABLED }, { sessionId: "ses_any" }, untouchable),
    ).resolves.toBeUndefined();
  });
});
