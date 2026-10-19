# Run Examples

Complete examples from minimal trigger to full-featured run spec. All CLI commands and YAML fragments reflect actual field names and enum values.

---

## Minimal Run — Just a Message

The simplest way to trigger a run. Name the agent in `session_spec.agent_ref` and provide a `message`. A session is created on the agent's current version; omit `session_spec` and the built-in assistant answers.

**CLI:**

```bash
stigmer run my-agent -m "What files are in the current directory?"
```

**YAML (if constructing via API):**

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Run
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

Append a new run to an existing session, preserving conversation history.

**CLI** (reopens the session; type the next message there):

```bash
stigmer resume ses_abc123
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
stigmer run my-agent -m "Analyze this code" --model claude-sonnet-4.5
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
stigmer run config-validator -m "Validate this configuration" --attach ./app-config.yaml
```

**YAML (after uploading the file with `FileCommandController.upload`, which returns its id):**

```yaml
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
  message: "Validate this configuration file and report any issues"
  file_ids:
    - file_01j9zq6v8w3x4y5z6a7b8c9d0e
```

The agent reads the file from `.stigmer/uploads/app-config.yaml`.

---

## Attach Multiple Files

```bash
stigmer run data-processor -m "Validate data against the schema using the rules file" \
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
  file_ids:
    - file_01j9zq6v8w3x4y5z6a7b8c9d0e
    - file_01j9zq7a1b2c3d4e5f6g7h8j9k
    - file_01j9zq7m4n5p6q7r8s9t0v1w2x
```

---

## Attach a Directory

The CLI uploads each file under the folder (hidden entries and links skipped, at most 500) into the conversation and lists each in its resources at its relative path.

```bash
stigmer run code-reviewer -m "Review this project for security vulnerabilities" --attach ./src/
```

```yaml
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
    resources:
      - file:
          file_id: file_01j9zq6v8w3x4y5z6a7b8c9d0e
          mount_path: src/main.go
      - file:
          file_id: file_01j9zq7a1b2c3d4e5f6g7h8j9k
          mount_path: src/handlers/auth.go
  message: "Review this project for security vulnerabilities"
```

The agent finds the files under `.stigmer/uploads/src/`.

---

## The Vaults a Conversation Uses

Name a new conversation's vaults on the first turn. Each turn uses the sender's own My vault first when `include_my_vault` is set, then the listed vaults in order; the first vault holding a key wins. Change them later with a session update.

```yaml
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
    include_my_vault: true
    vaults:
      - kind: vault
        org: acme
        slug: support-tools
  message: "Query the production database and summarize recent errors"
```

For integrations where each customer brings their own credentials, keep a vault per customer (`external_id`) and name it on that customer's conversations.

---

## Auto-Approve All Tool Calls (for Automation)

Bypass all HITL approval gates. Use in trusted CI/CD pipelines where human approval is impractical.

**CLI:**

```bash
stigmer run deployment-agent -m "Deploy version 2.4.1 to staging" --auto-approve
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

Context summarization needs no settings: it follows the model's Model Registry entry.

---

## Full-Featured Run Spec

A run with all optional fields populated — run settings, runtime secrets, files, and workspace refs.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Run
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

  auto_approve_all: false  # require explicit approval for destructive operations

  file_ids:
    - file_01j9zq6v8w3x4y5z6a7b8c9d0e  # migration-001.sql

  workspace_file_refs:
    - "db/schema/current.sql"
    - "db/schema/expected.sql"
```

---

## Watching and Controlling a Running Run

```bash
# Start the run without streaming; it prints the session to re-attach to
stigmer run my-agent -m "Long analysis task" --detach

# The run's id, as stigmer list run shows it
RUN_ID=run_abc123

# Follow its events from the session's log
stigmer runs logs "$RUN_ID" --follow

# Pause it to review progress
stigmer runs pause "$RUN_ID" --reason "Reviewing intermediate results"

# Resume when ready
stigmer runs resume "$RUN_ID"

# Stop it: interrupts the session, ending every unfinished turn
stigmer runs cancel "$RUN_ID"

# If it does not stop, force terminate
stigmer runs terminate "$RUN_ID" --reason "Not responding to interrupt"
```

A failed run is retried from its last checkpoint with the `recover` RPC.

---

## Handling HITL Approval in a Script

```bash
RUN_ID=run_abc123   # a run started with stigmer run ... --detach, as stigmer list run shows it

# Poll until the run waits for an answer (or ends)
while true; do
  PHASE=$(stigmer get run "$RUN_ID" -o json | jq -r '.status.phase')

  if [ "$PHASE" = "RUN_WAITING_FOR_APPROVAL" ]; then
    # The stigmer.permission.asked line names the waiting tool use and why it asks
    stigmer runs logs "$RUN_ID" | grep stigmer.permission.asked
    read -p "Allow? [y/n] " decision

    # --tool-call may be left out while the run waits on one call
    case "$decision" in
      y) stigmer runs approve "$RUN_ID" ;;
      *) stigmer runs approve "$RUN_ID" --action deny --comment "Refused by the operator" ;;
    esac

  elif [ "$PHASE" = "RUN_COMPLETED" ] || [ "$PHASE" = "RUN_FAILED" ] || \
       [ "$PHASE" = "RUN_CANCELLED" ] || [ "$PHASE" = "RUN_TERMINATED" ]; then
    echo "Run ended: $PHASE"
    break
  fi

  sleep 5
done
```

A deny does not end the run: the agent reads the comment and continues. The answers are the session's `confirmToolUse`; see [hitl-approvals.md](hitl-approvals.md).

---

## Downloading Artifacts

```bash
# Wait for the run to complete, then list its artifacts
stigmer get run "$RUN_ID" -o json | jq '.status.artifacts[]'

# Download a specific artifact
stigmer download run "$RUN_ID" --artifact quarterly-report

# Or download every artifact when the run completes
stigmer run report-generator -m "Generate quarterly analysis report" --download ./out
```
