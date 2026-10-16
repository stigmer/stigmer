# @stigmer/apis

Generated TypeScript protobuf stubs for the Stigmer platform APIs.

## Install

```bash
npm install @stigmer/apis @bufbuild/protobuf
```

## Usage

Import service descriptors and message types using the full proto path:

```typescript
import { AgentExecutionCommandService } from "@stigmer/apis/ai/stigmer/agentic/agentexecution/v1/command_connect";
import { CreateAgentExecutionRequest } from "@stigmer/apis/ai/stigmer/agentic/agentexecution/v1/command_pb";
```

Use with `@stigmer/rpc-client` to create typed service clients:

```typescript
import { useServiceClient } from "@stigmer/rpc-client";
import { AgentExecutionCommandService } from "@stigmer/apis/ai/stigmer/agentic/agentexecution/v1/command_connect";

const client = useServiceClient(AgentExecutionCommandService);
```

## Generation

Stubs are generated from `.proto` definitions in `apis/` using [Buf](https://buf.build) and `@bufbuild/protobuf`.

## License

Apache-2.0
