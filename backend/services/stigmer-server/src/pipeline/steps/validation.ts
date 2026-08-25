/**
 * ValidateProto — ports steps/validation.go. Redundant on the RPC path
 * (the protovalidate interceptor already validated at the boundary) but
 * deliberately retained: it is the ONLY validation on the direct-call path
 * unit tests use, and the shared validator makes the overlap free.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { DescMessage } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import type { Validator } from "@bufbuild/protovalidate";

import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";

// Process-wide shared validator (Go SharedValidator): constraints compile
// once, not per request.
let sharedValidator: Validator | undefined;

export function validator(): Validator {
  if (sharedValidator === undefined) {
    sharedValidator = createValidator();
  }
  return sharedValidator;
}

export function newValidateProtoStep<Desc extends DescMessage>(): PipelineStep<Desc> {
  return {
    name: "ValidateProto",
    execute(ctx: RequestContext<Desc>): void {
      const result = validator().validate(ctx.schema, ctx.input);
      if (result.kind === "valid") {
        return;
      }
      if (result.kind === "invalid") {
        throw new ConnectError(result.error.message, Code.InvalidArgument);
      }
      // A rule that fails to compile/evaluate is a server defect, not bad
      // input (same mapping as the transport interceptor).
      throw new ConnectError(
        `validation could not run: ${result.error.message}`,
        Code.Internal,
      );
    },
  };
}
