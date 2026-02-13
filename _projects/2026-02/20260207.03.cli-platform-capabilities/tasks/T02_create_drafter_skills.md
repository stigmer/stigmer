# Task: Create Agent-Drafter Skill Using `stigmer draft skill`

## Overview

This document covers the **end-to-end workflow** for creating skills using the `stigmer draft skill` command. The goal is to test the full artifact lifecycle:

1. Start Stigmer server (with Anthropic instead of Ollama)
2. Run `stigmer draft skill` with attachments (proto files, SDK references)
3. Agent creates skill → outputs artifact → CLI downloads it
4. Verify the generated skill

**We do NOT manually create skills** - the `skill-creator-agent` does that for us.

---

## Part 1: LLM Provider Configuration

### Current Architecture

The agent-runner loads LLM configuration from environment variables with **mode-aware defaults**:

| Mode | Default Provider | Default Model |
|------|------------------|---------------|
| `local` | `ollama` | `qwen2.5-coder:7b` |
| `cloud` | `anthropic` | `claude-sonnet-4.5` |

### Environment Variables

```bash
# Provider selection
STIGMER_LLM_PROVIDER=anthropic|ollama|openai

# Model selection  
STIGMER_LLM_MODEL=<model-name>

# API Key (required for anthropic/openai)
ANTHROPIC_API_KEY=sk-ant-...
# or
STIGMER_LLM_API_KEY=sk-ant-...

# Ollama base URL (required for ollama)
OLLAMA_BASE_URL=http://localhost:11434
```

### Available Models

**Anthropic**:
- `claude-opus-4` (premium)
- `claude-sonnet-4.5` (standard - recommended)
- `claude-haiku-4` (economy)
- `claude-sonnet-3.5`, `claude-haiku-3.5`

**OpenAI**:
- `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4`, `o1`, `o1-mini`

**Ollama** (local):
- `qwen2.5-coder:7b`, `qwen2.5-coder:14b`
- `codellama:7b`, `codellama:13b`
- `deepseek-coder-v2:16b`, `llama3.2:3b`, `mistral:7b`

---

## Part 2: Switching from Ollama to Anthropic (Local Mode)

### Option A: Use `stigmer config` (Recommended)

The CLI has a built-in configuration system stored at `~/.stigmer/config.yaml`:

```bash
# Set provider and model via CLI
stigmer config set llm.provider anthropic
stigmer config set llm.model claude-sonnet-4.5

# Verify configuration
stigmer config list

# API key must be set via environment variable (for security)
export ANTHROPIC_API_KEY=sk-ant-api03-xxxxx

# Then start server
stigmer server
```

**Why this is recommended:**
- Provider/model are persisted in config file
- Only API key needs to be in environment (security best practice)
- No need to remember env vars each time

### Option B: Environment Variables Only

```bash
# Set all via environment
export STIGMER_LLM_PROVIDER=anthropic
export STIGMER_LLM_MODEL=claude-sonnet-4.5
export ANTHROPIC_API_KEY=sk-ant-api03-xxxxx

# Then start server
stigmer server
```

### Option C: Inline with Command (Quick Testing)

```bash
# One-liner (good for testing)
STIGMER_LLM_PROVIDER=anthropic \
STIGMER_LLM_MODEL=claude-sonnet-4.5 \
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx \
stigmer server
```

### Configuration File Location

```bash
# Show config file path
stigmer config path
# Output: ~/.stigmer/config.yaml

# View all current settings
stigmer config list
```

### Example `~/.stigmer/config.yaml`

```yaml
backend:
  type: local
  local:
    llm:
      provider: anthropic
      model: claude-sonnet-4.5
    temporal:
      managed: true
    execution:
      mode: local
```

### Verification

After starting the server, check the logs for:
```
LLM Config: provider=anthropic model=claude-sonnet-4.5
```

---

## Part 3: End-to-End Testing Flow

### Prerequisites

1. **Stigmer CLI built** (latest with `draft skill` command)
2. **Server running** with Anthropic configured
3. **Reference files** to attach (proto, SDK docs, examples)

### Step 1: Prepare Attachment Files

Gather the reference materials for the skill you want to create. For an **agent-drafter skill**, you'd attach:

```bash
# Create a workspace for your attachments
mkdir -p ~/stigmer-test/agent-drafter-input

# Copy relevant proto files
cp /path/to/stigmer/apis/protos/ai/stigmer/agentic/agent/v1/agent.proto \
   ~/stigmer-test/agent-drafter-input/

# Copy SDK examples or documentation
cp /path/to/examples/agent-example.yaml \
   ~/stigmer-test/agent-drafter-input/

# You can also create a requirements.md with your specific needs
cat > ~/stigmer-test/agent-drafter-input/requirements.md << 'EOF'
# Agent Drafter Skill Requirements

Create a skill that helps AI assistants create valid Stigmer Agent YAML files.

## Key Information to Include:
1. The Agent proto structure (apiVersion, kind, metadata, spec)
2. Required fields: name, description, instructions
3. Optional fields: skill_refs, mcp_refs, labels
4. Validation rules for agent names (lowercase, hyphens)
5. Examples of well-structured agents

## Output:
A SKILL.md file with clear, actionable guidance for creating agents.
EOF
```

### Step 2: Start Stigmer Server (with Anthropic)

```bash
# Terminal 1: Start server with Anthropic
export STIGMER_LLM_PROVIDER=anthropic
export STIGMER_LLM_MODEL=claude-sonnet-4.5
export ANTHROPIC_API_KEY=sk-ant-api03-xxxxx

stigmer server
```

Wait for:
```
Seedpack bootstrap completed successfully
Server listening on localhost:50051
```

### Step 3: Run `stigmer draft skill`

```bash
# Terminal 2: Run draft skill command
stigmer draft skill \
  --attach ~/stigmer-test/agent-drafter-input/agent.proto \
  --attach ~/stigmer-test/agent-drafter-input/agent-example.yaml \
  --attach ~/stigmer-test/agent-drafter-input/requirements.md \
  --output ~/stigmer-test/agent-drafter-output \
  --follow \
  "Create an agent-drafter skill that helps AI create valid Stigmer Agent YAML files. Include the proto structure, required/optional fields, validation rules, and examples."
```

**Flags explained**:
- `--attach`: Files to provide as context to the agent
- `--output`: Directory where the generated skill will be downloaded
- `--follow`: Stream agent execution logs in real-time
- The message at the end is your prompt to the skill-creator-agent

### Step 4: Observe the Flow

You should see:
```
Using system agent: skill-creator-agent
Attached 3 file(s) as context
Invoking skill-creator-agent...
Execution ID: exec-abc123

[Agent logs streaming...]

Execution completed successfully
Downloading artifacts...
Skill saved to: /Users/you/stigmer-test/agent-drafter-output
```

### Step 5: Verify Generated Skill

```bash
# Check what was generated
ls -la ~/stigmer-test/agent-drafter-output/

# Should see:
# - SKILL.md (the main skill file)
# - references/ (if the agent created any)
# - scripts/ (if the agent created any)

# Read the generated SKILL.md
cat ~/stigmer-test/agent-drafter-output/SKILL.md
```

---

## Part 4: Troubleshooting

### Problem: "skill-creator-agent not found"

**Cause**: Bootstrap hasn't completed or failed.

**Solution**:
```bash
# Check server logs for bootstrap status
# Look for: "Seedpack bootstrap completed successfully"

# If bootstrap failed, check:
# 1. Server logs for errors
# 2. Ensure manifest.json is valid
# 3. Restart server
```

### Problem: "api_key is required for anthropic provider"

**Cause**: `ANTHROPIC_API_KEY` not set or not visible to agent-runner.

**Solution**:
```bash
# Verify the key is set
echo $ANTHROPIC_API_KEY

# Make sure it's exported (not just set)
export ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
```

### Problem: Agent times out or fails

**Cause**: Model may be struggling with the task.

**Solutions**:
1. Try a more capable model: `STIGMER_LLM_MODEL=claude-opus-4`
2. Simplify the prompt
3. Reduce attachment size
4. Check execution logs: `stigmer get execution <exec-id>`

### Problem: No artifacts generated

**Cause**: Agent completed but didn't create output files.

**Solution**:
```bash
# Check execution details
stigmer get execution <exec-id>

# Look at the agent's response - it may have output to stdout
# instead of creating files
```

---

## Part 5: Example Reference Files for Agent-Drafter Skill

### agent.proto (simplified excerpt)

```protobuf
// Excerpt from apis/protos/ai/stigmer/agentic/agent/v1/agent.proto

message Agent {
  // API version - always "agentic.stigmer.ai/v1"
  string api_version = 1;
  
  // Kind - always "Agent"
  string kind = 2;
  
  // Metadata about the agent
  AgentMetadata metadata = 3;
  
  // Agent specification
  AgentSpec spec = 4;
}

message AgentMetadata {
  string id = 1;
  string name = 2;  // lowercase, hyphen-separated
  map<string, string> labels = 3;
}

message AgentSpec {
  string description = 1;  // 1-2 sentence purpose
  string instructions = 2;  // Detailed agent instructions
  repeated ResourceRef skill_refs = 3;
  repeated ResourceRef mcp_refs = 4;
}

message ResourceRef {
  string kind = 1;  // "skill" or "mcpserver"
  string org = 2;   // Organization slug
  string slug = 3;  // Resource name
}
```

### agent-example.yaml

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer-agent
  labels:
    team: platform
spec:
  description: Reviews code for style, bugs, and best practices.
  instructions: |
    You are a code review assistant.

    ## Workflow
    1. Analyze the code for issues
    2. Provide constructive feedback
    3. Suggest improvements

    ## Principles
    - Be constructive, not critical
    - Explain the "why" behind suggestions
  skill_refs:
    - kind: skill
      org: local
      slug: code-review
```

---

## Part 6: Next Steps After Testing

Once `stigmer draft skill` works end-to-end:

1. **Create agent-drafter skill** using the flow above
2. **Create workflow-drafter skill** using the same flow
3. **Add to seedpack** (optional - for bootstrap)
4. **Implement `stigmer draft agent` CLI command**

### Adding Generated Skill to Seedpack (Optional)

If you want the generated skill to be part of bootstrap:

```bash
# 1. Copy generated skill to seedpack
cp -r ~/stigmer-test/agent-drafter-output/* \
  backend/libs/go/seedpack/skills/agent-drafter/

# 2. Create ZIP artifact
(cd backend/libs/go/seedpack/skills/agent-drafter && \
 zip -rq ../../artifacts/agent-drafter.zip .)

# 3. Calculate digest
shasum -a 256 backend/libs/go/seedpack/artifacts/agent-drafter.zip

# 4. Update manifest.json with new skill entry

# 5. Run tests
cd backend/libs/go/seedpack && go test -v ./...
```

---

## Summary: The Complete Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    SKILL CREATION FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Configure Anthropic (one-time setup)                        │
│     stigmer config set llm.provider anthropic                   │
│     stigmer config set llm.model claude-sonnet-4.5              │
│     export ANTHROPIC_API_KEY=sk-ant-...                         │
│                                                                 │
│  2. Start Server                                                │
│     stigmer server                                              │
│     (bootstrap creates skill-creator-agent)                     │
│                                                                 │
│  3. Prepare Attachments                                         │
│     - Proto files (agent.proto, workflow.proto)                 │
│     - Example YAMLs                                             │
│     - Requirements document                                     │
│                                                                 │
│  4. Run Draft Skill                                             │
│     stigmer draft skill \                                       │
│       --attach proto.file --attach example.yaml \               │
│       --output ./output --follow \                              │
│       "Create a skill for X"                                    │
│                                                                 │
│  5. Artifact Lifecycle                                          │
│     CLI → Server → skill-creator-agent executes                 │
│                  → Agent creates SKILL.md files                 │
│                  → Files uploaded as artifacts                  │
│                  → CLI downloads to --output dir                │
│                                                                 │
│  6. Verify Output                                               │
│     cat ./output/SKILL.md                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Locations Reference

| Component | Location |
|-----------|----------|
| draft_skill command | `client-apps/cli/cmd/stigmer/root/draft_skill.go` |
| draft_skill handler | `client-apps/cli/cmd/stigmer/root/draft_skill_handler.go` |
| skill-creator-agent | `backend/libs/go/seedpack/agents/skill-creator-agent.yaml` |
| skill-creator skill | `backend/libs/go/seedpack/skills/skill-creator/` |
| LLM config | `backend/services/agent-runner/worker/config.py` |
| Model registry | `backend/libs/python/graphton/src/graphton/core/model_registry.py` |
