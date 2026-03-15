// Configuration types
export type { StigmerRpcConfig, TokenProvider } from "./types";

// Transport factory (non-React, usable in tests and scripts)
export { createStigmerTransport } from "./transport";

// Interceptors (for custom transport compositions)
export { createAuthInterceptor, errorStripInterceptor } from "./interceptors";

// React context and provider
export { StigmerTransportContext } from "./context";
export { StigmerTransportProvider } from "./provider";
export type { StigmerTransportProviderProps } from "./provider";

// React hooks
export { useStigmerTransport, useServiceClient } from "./hooks";

// Re-exports for consumer convenience
export { createClient } from "@connectrpc/connect";
export type { Client, Transport, Interceptor } from "@connectrpc/connect";
export type { DescService } from "@bufbuild/protobuf";
