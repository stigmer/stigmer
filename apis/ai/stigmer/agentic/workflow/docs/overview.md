A Workflow defines a multi-step task orchestration. It declares the sequence of
tasks to execute, including HTTP calls, gRPC calls, conditional branching,
parallel execution, error handling, and AI agent invocations.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: data-pipeline
  slug: data-pipeline
spec:
  description: "Fetches data from an API, processes it, and notifies on completion"
  document:
    dsl: "1.0.0"
    namespace: acme
    name: data-pipeline
    version: "1.0.0"
  tasks:
    - name: fetchData
      kind: http_call
      task_config:
        method: GET
        endpoint:
          uri: "https://api.example.com/data"
      export:
        as: "${.}"
    - name: processResults
      kind: agent_call
      task_config:
        agent: acme/data-analyst
        message: "Analyze this data: ${ $context.fetchData.body }"
```
