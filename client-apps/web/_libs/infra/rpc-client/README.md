# @stigmer/rpc-client

Connect-RPC transport, auth interceptor, and typed service client factory for Stigmer APIs.

## Install

```bash
npm install @stigmer/rpc-client
```

Peer dependencies: `react`, `@bufbuild/protobuf`, `@connectrpc/connect`, `@connectrpc/connect-web`

## Usage

### 1. Wrap your app with the transport provider

```tsx
import { StigmerTransportProvider } from "@stigmer/rpc-client";

function App() {
  return (
    <StigmerTransportProvider
      serverUrl="http://localhost:8090"
      getAccessToken={() => Promise.resolve(myToken)}
    >
      <MyApp />
    </StigmerTransportProvider>
  );
}
```

### 2. Use typed service clients in components

```tsx
import { useServiceClient } from "@stigmer/rpc-client";
import { AgentExecutionQueryService } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_connect";

function MyComponent() {
  const client = useServiceClient(AgentExecutionQueryService);
  // client is fully typed — call any RPC method directly
}
```

### Non-React usage

```typescript
import { createStigmerTransport } from "@stigmer/rpc-client";
import { createClient } from "@connectrpc/connect";

const transport = createStigmerTransport({
  serverUrl: "http://localhost:8090",
});
const client = createClient(SomeService, transport);
```

## Exports

- `StigmerTransportProvider` — React context provider
- `useStigmerTransport()` — access the transport from context
- `useServiceClient(service)` — typed client factory hook
- `createStigmerTransport(config)` — imperative factory (no React)
- `createAuthInterceptor`, `errorStripInterceptor` — interceptors

## License

Apache-2.0
