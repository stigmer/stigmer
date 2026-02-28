# Environment Examples

Complete examples from minimal configuration to full-featured multi-key environments. All YAML and CLI commands reflect actual field names.

---

## Minimal — Description Only

The simplest valid environment. Useful as a placeholder or for agents that declare variables but fill their values at runtime.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: my-env
  org: acme-corp
spec:
  description: "Placeholder environment — values to be populated before use"
```

```bash
stigmer environment apply env.yaml
```

---

## Non-Secret Configuration Only

Store plain configuration values that do not require encryption — region names, log levels, feature flags, URLs.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: global-defaults
  org: acme-corp
spec:
  description: "Shared non-secret configuration defaults for all agents"
  data:
    LOG_LEVEL:
      value: "info"
      is_secret: false
      description: "Default log verbosity"
    AWS_REGION:
      value: "us-west-2"
      is_secret: false
      description: "Primary AWS region"
    FEATURE_FLAG_HITL:
      value: "true"
      is_secret: false
      description: "Enable human-in-the-loop approval steps"
```

---

## Secrets Only

Store sensitive credentials that must be encrypted at rest and redacted in logs.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: github-prod-secrets
  org: acme-corp
spec:
  description: "GitHub production credentials for the main monorepo bot"
  data:
    GITHUB_TOKEN:
      value: "ghp_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
      description: "GitHub personal access token with repo and PR permissions"
    GITHUB_WEBHOOK_SECRET:
      value: "whsec_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
      description: "Webhook secret for verifying GitHub event payloads"
```

---

## Mixed — Secrets and Plain Config Together

Combine secrets and non-secret values in a single environment. Each key is independently marked.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: aws-prod
  org: acme-corp
spec:
  description: "AWS production credentials and configuration"
  data:
    AWS_REGION:
      value: "us-east-1"
      is_secret: false
      description: "AWS region for all resource operations"
    AWS_ACCESS_KEY_ID:
      value: "AKIAIOSFODNN7EXAMPLE"
      is_secret: true
      description: "AWS access key for the deployment service account"
    AWS_SECRET_ACCESS_KEY:
      value: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      is_secret: true
      description: "AWS secret key for the deployment service account"
    S3_BUCKET:
      value: "acme-prod-artifacts"
      is_secret: false
      description: "S3 bucket for build artifacts"
```

---

## Multiple Services — All Credentials in One Environment

Bundle credentials for several services into a single environment for agents that integrate with many APIs.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: infra-agent-prod-creds
  org: acme-corp
spec:
  description: "All production credentials for the infrastructure agent"
  data:
    GITHUB_TOKEN:
      value: "ghp_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
      description: "GitHub token for PR and repository operations"
    JIRA_API_TOKEN:
      value: "jira_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
      description: "Jira API token for ticket management"
    JIRA_BASE_URL:
      value: "https://acme.atlassian.net"
      is_secret: false
      description: "Jira instance URL"
    DATADOG_API_KEY:
      value: "ddapikey_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
      description: "Datadog API key for metrics and alerts"
    DATADOG_SITE:
      value: "datadoghq.com"
      is_secret: false
      description: "Datadog site region"
    SLACK_BOT_TOKEN:
      value: "xoxb-xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
      description: "Slack bot token for sending notifications"
```

---

## Staging vs. Production — Same Keys, Different Values

Use separate environments for staging and production so the same AgentInstance can be promoted by swapping a single environment reference.

**Staging:**

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: github-staging-secrets
  org: acme-corp
  labels:
    env: staging
spec:
  description: "GitHub staging credentials — test repositories only"
  data:
    GITHUB_TOKEN:
      value: "ghp_staging_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
      description: "GitHub token scoped to staging repos"
    LOG_LEVEL:
      value: "debug"
      is_secret: false
```

**Production:**

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: github-prod-secrets
  org: acme-corp
  labels:
    env: production
spec:
  description: "GitHub production credentials — main monorepo"
  data:
    GITHUB_TOKEN:
      value: "ghp_prod_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
      description: "GitHub token scoped to production repos"
    LOG_LEVEL:
      value: "warn"
      is_secret: false
```

---

## Full-Featured — Labels, Annotations, Tags, and Mixed Values

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: platform-team-prod
  org: acme-corp
  labels:
    env: production
    team: platform
    tier: critical
  annotations:
    owner: "platform-team@acme.com"
    runbook: "https://internal.acme.com/runbooks/platform-env"
  tags:
    - production
    - platform
    - credentials
spec:
  description: "Platform team production credentials — GitHub, Jira, and AWS"
  data:
    GITHUB_TOKEN:
      value: "ghp_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
      description: "GitHub token for monorepo access"
    AWS_REGION:
      value: "us-east-1"
      is_secret: false
      description: "Primary AWS region"
    AWS_ACCESS_KEY_ID:
      value: "AKIAIOSFODNN7EXAMPLE"
      is_secret: true
      description: "AWS access key for platform CI/CD account"
    AWS_SECRET_ACCESS_KEY:
      value: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      is_secret: true
      description: "AWS secret key for platform CI/CD account"
    JIRA_API_TOKEN:
      value: "jira_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
      description: "Jira API token for the platform bot user"
    JIRA_BASE_URL:
      value: "https://acme.atlassian.net"
      is_secret: false
      description: "Jira instance URL"
    LOG_LEVEL:
      value: "info"
      is_secret: false
      description: "Log verbosity for production"
```

```bash
stigmer environment apply env.yaml
```

---

## Rotating a Secret

To rotate a secret, update the environment with the new value. All future executions referencing this environment will use the new secret immediately — no changes needed to any AgentInstance.

```yaml
# env-rotate.yaml — same structure, new secret value
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: github-prod-secrets
  org: acme-corp
spec:
  description: "GitHub production credentials for the main monorepo bot"
  data:
    GITHUB_TOKEN:
      value: "ghp_NEW_TOKEN_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
      description: "GitHub personal access token — rotated 2026-02-28"
```

```bash
stigmer environment update env-rotate.yaml
```

---

## Inspecting an Environment After Creation

```bash
# View environment configuration (secret values are redacted)
stigmer environment get github-prod-secrets --output yaml

# List all environments in the org
stigmer environment list --org acme-corp

# Delete an environment (will cause future executions referencing it to fail)
stigmer environment delete github-staging-secrets
```
