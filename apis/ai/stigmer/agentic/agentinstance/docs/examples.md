# AgentInstance Examples

Complete examples from minimal configuration to full-featured multi-environment instances. All YAML and CLI commands reflect actual field names and enum values.

---

## Minimal — No Environment Binding

The simplest valid instance. No secrets are supplied — the agent uses its own defaults only. Works for agents that require no external credentials.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: my-agent-default
  org: acme-corp
spec:
  agent_id: agt_abc123
```

```bash
stigmer agent instance apply instance.yaml
```

---

## With a Description

Add a description to distinguish this instance from others when listing or inspecting via the API.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: github-bot-production
  org: acme-corp
spec:
  agent_id: agt_abc123
  description: "Production GitHub bot — configured for the main monorepo"
```

---

## Single Environment Binding

Bind one Environment resource to supply secrets to the agent. The environment's values are merged on top of the agent's declared defaults.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: github-bot-prod
  org: acme-corp
spec:
  agent_id: agt_abc123
  description: "GitHub bot with production credentials"
  environment_refs:
    - kind: 52
      id: env_gh_prod789
      name: github-prod-secrets
      org: acme-corp
```

```bash
stigmer agent instance create \
  --agent my-github-agent \
  --env github-prod-secrets \
  --name "GitHub Bot Production" \
  --org acme-corp
```

---

## Layered Environments — Base + Override

Bind multiple environments to layer configuration. The base environment holds non-secret defaults; the override environment adds or replaces specific values (e.g., production credentials on top of staging defaults).

Later entries in `environment_refs` take precedence over earlier ones for any shared key.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: github-bot-prod-layered
  org: acme-corp
spec:
  agent_id: agt_abc123
  description: "GitHub bot — base config merged with prod secrets"
  environment_refs:
    - kind: 52
      id: env_base_config001
      name: base-config
      org: acme-corp
    - kind: 52
      id: env_gh_prod789
      name: github-prod-secrets
      org: acme-corp
```

Merge result: all keys from `base-config`, with any overlapping keys overridden by `github-prod-secrets`.

---

## Three-Layer Stack — Base, Team, and Production

A common enterprise pattern: global defaults, team-level configuration, and environment-specific secrets.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: code-reviewer-platform-prod
  org: acme-corp
  labels:
    env: production
    team: platform
spec:
  agent_id: agt_reviewer456
  description: "Code reviewer for the platform team — production GitHub + Jira"
  environment_refs:
    - kind: 52
      id: env_global_defaults001
      name: global-defaults
      org: acme-corp
    - kind: 52
      id: env_platform_team002
      name: platform-team-config
      org: acme-corp
    - kind: 52
      id: env_prod_secrets003
      name: production-secrets
      org: acme-corp
```

Priority (lowest → highest): `global-defaults` → `platform-team-config` → `production-secrets`.

---

## Staging vs. Production — Same Agent, Different Instances

Use separate instances to target different environments without duplicating the agent definition.

**Staging instance:**

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: github-bot-staging
  org: acme-corp
  labels:
    env: staging
spec:
  agent_id: agt_abc123
  description: "GitHub bot — staging environment"
  environment_refs:
    - kind: 52
      id: env_gh_staging111
      name: github-staging-secrets
      org: acme-corp
```

**Production instance:**

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: github-bot-production
  org: acme-corp
  labels:
    env: production
spec:
  agent_id: agt_abc123
  description: "GitHub bot — production environment"
  environment_refs:
    - kind: 52
      id: env_gh_prod789
      name: github-prod-secrets
      org: acme-corp
```

Run against the staging instance:

```bash
stigmer run my-github-agent "Review PR #42" --instance github-bot-staging
```

Run against the production instance:

```bash
stigmer run my-github-agent "Review PR #42" --instance github-bot-production
```

---

## Full-Featured — Labels, Annotations, and Layered Environments

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: infra-agent-prod
  org: acme-corp
  labels:
    env: production
    team: infrastructure
    tier: critical
  annotations:
    owner: "infra-team@acme.com"
    runbook: "https://internal.acme.com/runbooks/infra-agent"
  tags:
    - infrastructure
    - terraform
    - production
spec:
  agent_id: agt_infra999
  description: "Infrastructure agent — production AWS + Terraform credentials"
  environment_refs:
    - kind: 52
      id: env_base_infra001
      name: infra-base-config
      org: acme-corp
    - kind: 52
      id: env_aws_prod002
      name: aws-prod-credentials
      org: acme-corp
    - kind: 52
      id: env_tf_prod003
      name: terraform-prod-state
      org: acme-corp
```

---

## Inspecting an Instance After Creation

```bash
# View instance configuration
stigmer agent instance get infra-agent-prod --output yaml

# List all instances for this agent
stigmer agent instance list --agent my-infra-agent

# Delete the staging instance when no longer needed
stigmer agent instance delete github-bot-staging
```
