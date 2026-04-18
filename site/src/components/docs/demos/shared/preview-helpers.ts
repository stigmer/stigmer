/**
 * Shared helpers for scenario preview fixtures.
 *
 * Builds MSW handlers from protobuf service descriptors using the
 * Connect-RPC URL convention: POST {base}/{ServiceTypeName}/{MethodName}
 */

import { http, HttpResponse } from "msw";

interface ServiceDescriptor {
  readonly typeName: string;
  readonly method: Record<string, { readonly name: string }>;
}

/**
 * Create an MSW handler for a Connect-RPC unary method.
 *
 * Uses JSON encoding — the PreviewProviders client is configured with
 * `useBinaryFormat: false` so MSW sees JSON request/response bodies.
 */
export function connectFixture(
  service: ServiceDescriptor,
  methodKey: string,
  handler: (input?: unknown) => unknown,
) {
  const method = service.method[methodKey];
  if (!method) {
    throw new Error(
      `Method "${methodKey}" not found on ${service.typeName}. ` +
      `Available: ${Object.keys(service.method).join(", ")}`,
    );
  }
  return http.post(`*/${service.typeName}/${method.name}`, async ({ request }) => {
    const body = await request.json().catch(() => undefined);
    const result = handler(body);
    return HttpResponse.json(result as Record<string, unknown>);
  });
}
