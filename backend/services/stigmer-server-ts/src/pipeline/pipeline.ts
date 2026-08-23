/**
 * Pipeline executor — ports backend/libs/go/grpc/request/pipeline/
 * {pipeline,step,error}.go. Steps run in order; the first error halts the
 * chain.
 *
 * The error contract is Go's PipelineError.GRPCStatus, verbatim in
 * ConnectRPC terms (stigmer/stigmer#478):
 *   - a step that throws a ConnectError has its code AND message preserved
 *     on the wire (the clean domain message — no step-name prefix);
 *   - a step that throws anything else reaches the wire as
 *     Internal/"internal server error" — the raw text can carry
 *     storage-engine detail or filesystem paths, which an anonymous caller
 *     must never see. The original error rides `cause`.
 * The step name and real error are logged HERE (Go's pipeline logs them via
 * log.Printf; the transport logging interceptor separately records the
 * wire-level outcome). Nothing diverges silently.
 *
 * Tracing spans are not ported: the TS server has no telemetry seam yet and
 * Go's default is a no-op tracer — the span plumbing would be machinery
 * without a consumer. It returns together with a real telemetry decision.
 */
import { ConnectError } from "@connectrpc/connect";
import type { DescMessage } from "@bufbuild/protobuf";

import type { Logger } from "../boot/logger.js";
import { internalError } from "./errors.js";
import type { RequestContext } from "./request-context.js";

/** One step in request processing (Go PipelineStep). */
export interface PipelineStep<Desc extends DescMessage> {
  /** Human-readable step name — the shared vocabulary (guidelines §3). */
  readonly name: string;
  /** Runs the step; throwing halts the pipeline. May be sync or async. */
  execute(ctx: RequestContext<Desc>): void | Promise<void>;
}

/**
 * The wire description for a step that threw a plain (non-Connect) error —
 * Go's internalFallbackMessage, byte-identical.
 */
export const INTERNAL_FALLBACK_MESSAGE = "internal server error";

export class Pipeline<Desc extends DescMessage> {
  constructor(
    private readonly pipelineName: string,
    private readonly steps: ReadonlyArray<PipelineStep<Desc>>,
    private readonly logger: Logger,
  ) {}

  get name(): string {
    return this.pipelineName;
  }

  get stepCount(): number {
    return this.steps.length;
  }

  /** Runs all steps in order; throws the first failure as a ConnectError. */
  async execute(ctx: RequestContext<Desc>): Promise<void> {
    for (const step of this.steps) {
      const startedAt = performance.now();
      try {
        await step.execute(ctx);
      } catch (error) {
        // The real error is logged here with its step (Go pipeline.go's
        // failure log line); the wire gets the sanitized form below.
        this.logger.warn("pipeline step failed", {
          pipeline: this.pipelineName,
          step: step.name,
          durationMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof ConnectError) {
          throw error;
        }
        throw internalError(error, INTERNAL_FALLBACK_MESSAGE);
      }
      this.logger.debug("pipeline step completed", {
        pipeline: this.pipelineName,
        step: step.name,
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
  }
}

/** Fluent builder (Go NewPipeline(name).AddStep(...).Build()). */
export class PipelineBuilder<Desc extends DescMessage> {
  private readonly steps: Array<PipelineStep<Desc>> = [];

  constructor(
    private readonly name: string,
    private readonly logger: Logger,
  ) {}

  addStep(step: PipelineStep<Desc>): this {
    this.steps.push(step);
    return this;
  }

  build(): Pipeline<Desc> {
    return new Pipeline(this.name, this.steps, this.logger);
  }
}

export function newPipeline<Desc extends DescMessage>(
  name: string,
  logger: Logger,
): PipelineBuilder<Desc> {
  return new PipelineBuilder(name, logger);
}
