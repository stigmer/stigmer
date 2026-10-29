/**
 * Protovalidate interceptor — chain position 3, the boundary validator, on
 * both unary and streaming calls.
 *
 * Every request message is validated against its proto rules BEFORE any
 * handler code, including in-process calls through the router transport —
 * that traversal is the one-validation property router-transport.test.ts
 * proves.
 * Client/bidi-streaming requests validate each message as it arrives.
 *
 * Violations map to InvalidArgument carrying the library's violation text,
 * as protovalidate-es formats it.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import type { DescMessage } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import type { Validator } from "@bufbuild/protovalidate";

export function createProtovalidateInterceptor(): Interceptor {
  const validator = createValidator();

  return (next) => (request) => {
    if (!request.stream) {
      assertValid(validator, request.method.input, request.message);
      return next(request);
    }
    return next({
      ...request,
      message: validateEach(validator, request.method.input, request.message),
    });
  };
}

function assertValid(
  validator: Validator,
  schema: DescMessage,
  message: unknown,
): void {
  const result = validator.validate(schema, message as Message);
  if (result.kind === "valid") {
    return;
  }
  if (result.kind === "invalid") {
    throw new ConnectError(result.error.message, Code.InvalidArgument);
  }
  // A rule that fails to compile/evaluate is a server defect, not bad input.
  throw new ConnectError(
    `validation could not run: ${result.error.message}`,
    Code.Internal,
  );
}

async function* validateEach<T>(
  validator: Validator,
  schema: DescMessage,
  messages: AsyncIterable<T>,
): AsyncIterable<T> {
  for await (const message of messages) {
    assertValid(validator, schema, message);
    yield message;
  }
}
