/**
 * What a trace says about a model the runner built: where it is served
 * from, in OpenTelemetry's GenAI provider names, the registry id it was
 * asked for, and the provider API id it resolved to.
 *
 * `buildChatModel` (`model-client.ts`) records each model it builds, by the
 * model instance; the Stigmer harness's span middleware reads them from the
 * request's model (`middleware/otel-spans.ts`). So one middleware serves the
 * parent's graph and every sub-agent's, each on the model it runs, with no
 * per-stack configuration and no guess from a model's name. A module of its
 * own, so a reader needs nothing of the model builder.
 */

export interface ChatModelFacts {
  readonly providerName: string;
  readonly requestModel: string;
  readonly responseModel: string;
}

const MODEL_FACTS = new WeakMap<object, ChatModelFacts>();

/** Record what the builder knows of `model`. */
export function recordChatModelFacts(model: object, facts: ChatModelFacts): void {
  MODEL_FACTS.set(model, facts);
}

/** The facts recorded for `model`; `undefined` for a model the runner did not build. */
export function chatModelFacts(model: unknown): ChatModelFacts | undefined {
  return typeof model === "object" && model !== null ? MODEL_FACTS.get(model) : undefined;
}
