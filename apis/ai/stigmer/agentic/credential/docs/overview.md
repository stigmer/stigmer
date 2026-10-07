A Credential is a saved set of secret values that belongs to a person or to
an organization: your own Linear sign-in or OpenAI key, or the organization's
shared Datadog key. Each field fills the key of the same name that an agent,
an MCP server or a git host needs. A run uses the credential of the person who
started it for what it `serves`, an organization credential the person may
use, or a credential assigned on the schedule, share link, channel or platform
client that started it. A person can reveal their own credential's values; an
organization's credential is write-only. Credentials are created with their
values in the console, the CLI or the API, never applied from a file; this is
one as the API returns it, its secret value redacted.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Credential
metadata:
  name: Datadog (on-call)
  org: acme-corp
spec:
  organization: org_01jq8m6z4v3k2x9w7t5r1n0p8c
  description: "Read-only Datadog key for the incident agent"
  fields:
    DD_API_KEY:
      value: "***REDACTED***"
    DD_SITE:
      value: "datadoghq.com"
      plain: true
  serves:
    - agent:
        kind: agent
        slug: incident-agent
```
