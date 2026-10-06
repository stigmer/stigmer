# AgentExecution Examples

Complete examples from minimal trigger to full-featured execution spec. All CLI commands and YAML fragments reflect actual field names and enum values.

---

## Minimal Execution — Just a Message

The simplest way to trigger an execution. Name the agent in `session_spec.agent_ref` and provide a `message`. A session is created on the agent's current version; omit `session_spec` and the built-in assistant answers.

**CLI:**

```bash
stigmer run my-agent "What files are in the current directory?"
```

**YAML (if constructing via API):**

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentExecution
metadata:
  org: acme
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
  message: "What files are in the current directory?"
```

---

## Continue an Existing Session

Append a new execution to an existing session, preserving conversation history.

**CLI:**

```bash
stigmer run my-agent "Now summarize what you found" --session ses_abc123
```

**YAML:**

```yaml
spec:
  session_id: ses_abc123
  message: "Now summarize what you found"
```

---

## Choose the Model for One Message

Ask for a specific model for this message. It replaces the agent's default model for this message only; the agent's cost and tool-round caps still apply, since a message can lower a cap but never raise it.

**CLI:**

```bash
stigmer run my-agent "Analyze this code" --model claude-sonnet-4.5
```

**YAML:**

```yaml
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
  message: "Analyze this code"
  run_config:
    model_name: "claude-sonnet-4.5"
```

**Adjust the agent's model without replacing it** — a message may set thinking or the speed tier alone, and they apply to the model the agent's defaults chose:

```yaml
spec:
  session_id: ses_abc123
  message: "Quick question: which file defines the retry policy?"
  run_config:
    thinking_mode: THINKING_MODE_DISABLED
```

---

## Attach an Input File

Pass a file into the agent's sandbox for it to read.

**CLI:**

```bash
stigmer run config-validator "Validate this configuration" --attach ./app-config.yaml
```

**YAML (after uploading the file via `uploadAttachment`):**

```yaml
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
  message: "Validate this configuration file and report any issues"
  attachments:
    - filename: "app-config.yaml"
      storage_key: "attachments/01HGXXX.../app-config.yaml"
      mount_path: "/inputs/app-config.yaml"
      content_type: "application/yaml"
```

The agent reads the file from `/inputs/app-config.yaml` inside its sandbox.

---

## Attach Multiple Files

```bash
stigmer run data-processor "Validate data against the schema using the rules file" \
  --attach ./data.csv \
  --attach ./schema.json \
  --attach ./validation-rules.yaml
```

```yaml
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
  message: "Validate data against the schema using the rules file"
  attachments:
    - filename: "data.csv"
      storage_key: "attachments/01HGXXX.../data.csv"
      mount_path: "/inputs/data.csv"
    - filename: "schema.json"
      storage_key: "attachments/01HGYYY.../schema.json"
      mount_path: "/inputs/schema.json"
    - filename: "validation-rules.yaml"
      storage_key: "attachments/01HGZZZ.../validation-rules.yaml"
      mount_path: "/inputs/validation-rules.yaml"
```

---

## Attach a Directory

The CLI zips the directory automatically and sets `extract: true`.

```bash
stigmer run code-reviewer "Review this project for security vulnerabilities" --attach ./src/
```

```yaml
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
  message: "Review this project for security vulnerabilities"
  attachments:
    - filename: "src.zip"
      storage_key: "attachments/01HGXXX.../src.zip"
      mount_path: "/inputs/src/"
      extract: true
```

---

## Runtime Environment Variables

Inject secrets or configuration at execution time. These are available only for this execution and are deleted when it completes.

```yaml
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
  message: "Query the production database and summarize recent errors"
  runtime_env:
    DATABASE_URL:
      value: "postgresql://user:pass@host:5432/prod"
      is_secret: true
    LOG_LEVEL:
      value: "INFO"
      is_secret: false
```

Use `runtime_env` for B2B integrations where each caller provides their own credentials at invocation time.

---

## Auto-Approve All Tool Calls (for Automation)

Bypass all HITL approval gates. Use in trusted CI/CD pipelines where human approval is impractical.

**CLI:**

```bash
stigmer run deployment-agent "Deploy version 2.4.1 to staging" --auto-approve
```

**YAML:**

```yaml
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
  message: "Deploy version 2.4.1 to staging"
  auto_approve_all: true
```

---

## Cap the Cost of One Message

Stop the message once its estimated cost reaches the cap; the work done so far is kept. A cap tighter than the agent's applies; a looser one leaves the agent's cap in force.

```yaml
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
  message: "Analyze all PRs from the past 6 months and identify patterns"
  run_config:
    max_cost_usd: 0.50
    max_tool_result_chars: 20000
```

Context summarization needs no settings: it follows the model's Model Registry entry, and `status.context_info` reports it.

---

## Full-Featured Execution Spec

An execution with all optional fields populated — run settings, runtime secrets, attachments, and workspace refs.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentExecution
metadata:
  org: acme-corp
  name: migration-run-1
  labels:
    triggered-by: ci-pipeline
    environment: staging
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: migration-agent
  message: |
    Migrate the database schema using the provided migration file.
    Validate the migration against the schema spec before applying.
    Report any conflicts or warnings.

  run_config:
    model_name: "claude-sonnet-4.5"
    thinking_mode: THINKING_MODE_ENABLED
    max_cost_usd: 3.00

  runtime_env:
    DATABASE_URL:
      value: "postgresql://user:pass@staging-db:5432/app"
      is_secret: true
    MIGRATION_DRY_RUN:
      value: "false"
      is_secret: false

  auto_approve_all: false  # require explicit approval for destructive operations

  attachments:
    - filename: "migration-001.sql"
      storage_key: "attachments/01HGXXX.../migration-001.sql"
      mount_path: "/inputs/migration.sql"
      content_type: "text/plain"

  workspace_file_refs:
    - "db/schema/current.sql"
    - "db/schema/expected.sql"
```

---

## Watching and Controlling a Running Execution

```bash
# Trigger the execution
EX_ID=$(stigmer run my-agent "Long analysis task" --output id)

# Watch streaming output in real time
stigmer agent execution watch "$EX_ID"

# Pause it to review progress
stigmer agent execution pause "$EX_ID" --reason "Reviewing intermediate results"

# Resume when ready
stigmer agent execution resume "$EX_ID"

# If it gets stuck, cancel gracefully
stigmer agent execution cancel "$EX_ID" --reason "Task definition was incorrect"

# If cancel doesn't work, force terminate
stigmer agent execution terminate "$EX_ID" --reason "Not responding to cancel"

# If it fails, recover from last checkpoint
stigmer agent execution recover "$EX_ID"
```

---

## Handling HITL Approval in a Script

```bash
# Trigger an execution that may require approval
EX_ID=$(stigmer run deployment-agent "Deploy to production" --output id)

# Poll until approval is needed (or execution completes)
while true; do
  PHASE=$(stigmer agent execution get "$EX_ID" --output json | jq -r '.status.phase')

  if [ "$PHASE" = "EXECUTION_WAITING_FOR_APPROVAL" ]; then
    # Get the pending approval details
    PENDING=$(stigmer agent execution get "$EX_ID" --output json | \
      jq -r '.status.pending_approvals[0]')
    TOOL_CALL_ID=$(echo "$PENDING" | jq -r '.tool_call_id')
    MESSAGE=$(echo "$PENDING" | jq -r '.message')

    echo "Approval required: $MESSAGE"
    read -p "Approve? [y/n/s(kip)] " decision

    case "$decision" in
      y) stigmer agent execution approve "$EX_ID" --tool-call-id "$TOOL_CALL_ID" ;;
      s) stigmer agent execution skip "$EX_ID" --tool-call-id "$TOOL_CALL_ID" ;;
      *) stigmer agent execution reject "$EX_ID" --tool-call-id "$TOOL_CALL_ID"; break ;;
    esac

  elif [ "$PHASE" = "EXECUTION_COMPLETED" ]; then
    echo "Execution completed successfully."
    break

  elif [ "$PHASE" = "EXECUTION_FAILED" ]; then
    echo "Execution failed."
    break
  fi

  sleep 5
done
```

---

## Downloading Artifacts

```bash
# Trigger an agent that produces output files
EX_ID=$(stigmer run report-generator "Generate quarterly analysis report" --output id)

# Wait for completion, then list artifacts
stigmer agent execution get "$EX_ID" --output json | jq '.status.artifacts[]'

# Download a specific artifact
stigmer agent execution download "$EX_ID" --artifact quarterly-report

# Refresh an expired URL
stigmer agent execution get-artifact-url "$EX_ID" \
  --storage-key "artifacts/${EX_ID}/quarterly-report.pdf"
```
