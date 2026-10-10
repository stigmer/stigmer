A Session is a persistent conversation that groups multiple runs together
and preserves the message thread, workspace files, and sandbox state across
every turn. `agent_ref` names the agent it runs (empty: the built-in assistant),
and the server pins the version that reference resolved to in
`status.agent_id` and `status.agent_version_hash`, so an author's later saves
never change an open conversation; an update with `agent_ref.version: latest`
moves it to the agent's current version, and a tag or hash pins that version.
`plugins` adds plugins to the agent's for this conversation, each whole (a chat
with no agent gets its tools from these); the agent's tool lists govern them
like its own.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Session
metadata:
  name: refactor-auth-module
  org: acme
spec:
  agent_ref:
    kind: agent
    org: acme
    slug: code-reviewer
  subject: "Refactor the auth module"
  workspace_entries:
    - name: backend
      source:
        git_repo:
          url: https://github.com/acme/backend.git
          branch: main
  plugins:
    - kind: plugin
      slug: github
  skill_refs:
    - kind: skill
      slug: go-best-practices
```
