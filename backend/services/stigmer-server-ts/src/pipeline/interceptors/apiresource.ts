/**
 * API-resource interceptor — chain position 4, ported from
 * backend/libs/go/grpc/interceptors/apiresource/interceptor.go.
 *
 * Reads the `api_resource_kind` service option (field 90100,
 * apis/ai/stigmer/commons/apiresource/rpc_service_options.proto) from the
 * request's service descriptor and injects the kind into the request
 * context, where pipeline steps and audit stamping read it back. Injected
 * only when the option is present and not the unknown zero value — exactly
 * Go's gate (interceptor.go:154-173).
 *
 * Unary-only, as in Go: no stream variant is registered there
 * (server.go:253-254), and the context value is consumed by unary command
 * pipelines. TS needs no reflection cache — descriptors are static imports,
 * and getOption reads are cheap.
 */
import { createContextKey } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import { getOption, hasOption } from "@bufbuild/protobuf";
import { api_resource_kind } from "@stigmer/protos/ai/stigmer/commons/apiresource/rpc_service_options_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

/**
 * Context key for the resolved kind; the default mirrors Go's "absent"
 * state (GetApiResourceKind returns unknown when the interceptor did not
 * inject).
 */
export const apiResourceKindKey = createContextKey<ApiResourceKind>(
  ApiResourceKind.api_resource_kind_unknown,
  { description: "api_resource_kind service option of the target service" },
);

export function createApiResourceInterceptor(): Interceptor {
  return (next) => (request) => {
    if (!request.stream && hasOption(request.service, api_resource_kind)) {
      const kind = getOption(request.service, api_resource_kind);
      if (kind !== ApiResourceKind.api_resource_kind_unknown) {
        request.contextValues.set(apiResourceKindKey, kind);
      }
    }
    return next(request);
  };
}
