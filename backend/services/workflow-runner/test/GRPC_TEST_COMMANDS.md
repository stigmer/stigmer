# gRPC Testing Commands for Workflow Runner

## Prerequisites

```bash
# Install grpcurl if you don't have it
brew install grpcurl
```

## Test 1: Simple Fetch Workflow (Recommended First Test)

```bash
grpcurl \
  -plaintext \
  -d '{
    "workflow_execution_id": "wfx-test-001",
    "workflow_yaml": "document:\n  dsl: \"1.0.0\"\n  namespace: demo\n  name: test-simple-fetch\n  version: \"1.0.0\"\n  description: \"Simple fetch test\"\ndo:\n  - initContext:\n      set:\n        apiBase: https://jsonplaceholder.typicode.com\n  - fetchData:\n      call: http\n      with:\n        method: GET\n        endpoint:\n          uri: ${ $context.apiBase + \"/posts/1\" }\n        headers:\n          Content-Type: application/json\n      export:\n        as: ${ . }\n  - processResponse:\n      set:\n        postBody: ${ $context.body }\n        postTitle: ${ $context.title }\n        postId: ${ $context.id }\n        status: completed"
  }' \
  localhost:9090 \
  ai.stigmer.agentic.workflowrunner.v1.WorkflowRunnerServiceController/executeAsync
```

## Test 2: Using YAML from File (Cleaner)

First, create a JSON request file:

```bash
cat > /tmp/workflow-request.json <<'EOF'
{
  "workflow_execution_id": "wfx-test-002",
  "workflow_yaml": "document:\n  dsl: \"1.0.0\"\n  namespace: demo\n  name: test-simple-fetch\n  version: \"1.0.0\"\ndo:\n  - initContext:\n      set:\n        apiBase: https://jsonplaceholder.typicode.com\n  - fetchData:\n      call: http\n      with:\n        method: GET\n        endpoint:\n          uri: ${ $context.apiBase + \"/posts/1\" }\n      export:\n        as: ${ . }\n  - processResponse:\n      set:\n        status: completed"
}
EOF
```

Then make the call:

```bash
grpcurl \
  -plaintext \
  -d @ \
  localhost:9090 \
  ai.stigmer.agentic.workflowrunner.v1.WorkflowRunnerServiceController/executeAsync \
  < /tmp/workflow-request.json
```

## Test 3: Helper Script to Convert YAML to JSON Request

```bash
#!/bin/bash
# Save as: convert-yaml-to-grpc.sh

YAML_FILE=$1
EXECUTION_ID=${2:-"wfx-test-$(date +%s)"}

if [ -z "$YAML_FILE" ]; then
    echo "Usage: $0 <yaml-file> [execution-id]"
    exit 1
fi

# Read YAML and escape it for JSON
YAML_CONTENT=$(cat "$YAML_FILE" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}' | sed 's/\\n$//')

# Create JSON request
cat > /tmp/grpc-request.json <<EOF
{
  "workflow_execution_id": "$EXECUTION_ID",
  "workflow_yaml": "$YAML_CONTENT"
}
EOF

echo "Created request file: /tmp/grpc-request.json"
echo "Execution ID: $EXECUTION_ID"
echo ""
echo "To execute, run:"
echo "grpcurl -plaintext -d @ localhost:9090 ai.stigmer.agentic.workflowrunner.v1.WorkflowRunnerServiceController/executeAsync < /tmp/grpc-request.json"
```

Make it executable:

```bash
chmod +x convert-yaml-to-grpc.sh
```

Use it:

```bash
./convert-yaml-to-grpc.sh test-simple-fetch.yaml wfx-my-test-001
```

## Test 4: List Available Services (Verify Server is Running)

```bash
grpcurl -plaintext localhost:9090 list
```

Expected output:
```
ai.stigmer.agentic.workflowrunner.v1.WorkflowRunnerServiceController
grpc.health.v1.Health
grpc.reflection.v1alpha.ServerReflection
```

## Test 5: Describe the Service

```bash
grpcurl -plaintext localhost:9090 describe ai.stigmer.agentic.workflowrunner.v1.WorkflowRunnerServiceController
```

## Expected Response

If successful, you should get:

```json
{
  "workflowExecutionId": "wfx-test-001",
  "status": "running",
  "message": "Workflow execution started successfully",
  "temporalWorkflowId": "test-simple-fetch-20260117-...",
  "subscribeUrl": "",
  "statusUrl": ""
}
```

## Common Errors and Solutions

### 1. "failed to connect"
- **Cause**: Server not running
- **Solution**: Start workflow-runner service:
  ```bash
  cd backend/services/workflow-runner
  make run
  ```

### 2. "unknown service"
- **Cause**: Server doesn't have reflection enabled or wrong port
- **Solution**: Check server logs, verify port 9090

### 3. "unable to decode: failed to unmarshal Endpoint"
- **Cause**: Missing `export` clause on fetchData task
- **Solution**: Already fixed in test-simple-fetch.yaml!

### 4. "context variable not found"
- **Cause**: Task output not exported to context
- **Solution**: Add `export: { as: ${ . } }` to the task

## Debug Mode

Add `-v` flag to see full request/response:

```bash
grpcurl -v -plaintext -d @ localhost:9090 \
  ai.stigmer.agentic.workflowrunner.v1.WorkflowRunnerServiceController/executeAsync \
  < /tmp/grpc-request.json
```

## Quick Test with Hardcoded URL (No Context Variables)

```bash
grpcurl -plaintext -d '{
  "workflow_execution_id": "wfx-hardcoded-test",
  "workflow_yaml": "document:\n  dsl: \"1.0.0\"\n  namespace: demo\n  name: hardcoded-test\n  version: \"1.0.0\"\ndo:\n  - fetchData:\n      call: http\n      with:\n        method: GET\n        endpoint:\n          uri: https://jsonplaceholder.typicode.com/posts/1\n      export:\n        as: ${ . }\n  - processResponse:\n      set:\n        status: completed"
}' localhost:9090 ai.stigmer.agentic.workflowrunner.v1.WorkflowRunnerServiceController/executeAsync
```

This removes the context variable completely to isolate the issue.
