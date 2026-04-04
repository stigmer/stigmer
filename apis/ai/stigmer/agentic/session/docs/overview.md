A Session is a persistent conversation context that groups multiple executions
together. It preserves the message thread, workspace files, and sandbox state
across every turn in the conversation.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Session
metadata:
  name: refactor-auth-module
  org: acme
spec:
  agent_instance_id: agi_01j5q3k7m8r2s4tnz2hfp0q0c3
  subject: "Refactor the auth module"
  workspace_entries:
    - name: backend
      source:
        git_repo:
          url: https://github.com/acme/backend.git
          branch: main
  mcp_server_usages:
    - mcp_server_ref:
        kind: mcp_server
        slug: github
      enabled_tools: [search_code, create_pr]
  skill_refs:
    - kind: skill
      slug: go-best-practices
```
