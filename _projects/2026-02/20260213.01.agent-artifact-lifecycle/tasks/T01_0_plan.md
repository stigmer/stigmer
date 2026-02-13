# Task T01: Agent Artifact Lifecycle - Implementation Plan (Revised)

**Created**: 2026-02-13
**Revised**: 2026-02-13 (Simplified approach - no separate Artifact resource)
**Status**: PENDING REVIEW
**Type**: Feature Development
**Research**: [research.agent-artifact-io-model/04.report.gpt.md](../../20260207.03.cli-platform-capabilities/research.agent-artifact-io-model/04.report.gpt.md)

⚠️ **This plan requires your review before execution**

---

## Executive Summary

**Simplified Approach**: Extend `AgentExecutionSpec` and `AgentExecutionStatus` directly. No new `Artifact` resource.

| Input | Output |
|-------|--------|
| Add `attachments` to `AgentExecutionSpec` | Add `outputs` to `AgentExecutionStatus` |
| Files uploaded with execution request | Files downloadable via signed URLs |

**Key Research Findings We're Using:**
- Daytona HAS download APIs: `fs.download_file()`, `fs.download_files()`
- Temporal constraint: Pass references/URLs, not bytes in workflow history
- Store outputs in R2 (existing infrastructure)

---

## Three Milestones

### Milestone 1: Attachments & Outputs (MVP)
**Goal**: Pass files into agent, download files created by agent

| Component | Deliverable |
|-----------|-------------|
| Proto | `attachments` in `AgentExecutionSpec` |
| Proto | `outputs` in `AgentExecutionStatus` |
| Agent Runner | Inject attachments into sandbox |
| Agent Runner | `publish_output` tool for agents |
| Agent Runner | Upload outputs to R2, return download URLs |
| CLI | `--attach` flag for `stigmer run agent` |
| CLI | Download command for execution outputs |

### Milestone 2: Persistent Workspace (Daytona Volumes)
**Goal**: Working directory survives sandbox restarts

| Component | Deliverable |
|-----------|-------------|
| Sandbox Manager | Mount Daytona Volume at `/workspace` |
| Volume Isolation | Per-user or per-project subpaths |

### Milestone 3: Lifecycle Automation
**Goal**: Retention, auto-cleanup

| Component | Deliverable |
|-----------|-------------|
| Output expiration | Download URLs expire after N days |
| Cleanup | Remove expired outputs from R2 |

---

## Detailed Implementation Plan

### Phase 1: Proto Changes

#### 1.1 Extend AgentExecutionSpec (Input)

```protobuf
// apis/ai/stigmer/agentic/agentexecution/v1/spec.proto

message AgentExecutionSpec {
  string message = 1;
  string session_id = 2;
  string agent_id = 3;
  ExecutionConfig execution_config = 4;
  map<string, ExecutionValue> runtime_env = 5;
  bytes callback_token = 6;
  bool auto_approve_all = 7;
  string parent_workflow_id = 8;
  
  // NEW: Files attached to this execution
  repeated Attachment attachments = 10;
}

message Attachment {
  string filename = 1;           // Original filename (e.g., "spec.yaml")
  bytes content = 2;             // File bytes (for files < 4MB)
  string storage_key = 3;        // OR: Pre-uploaded to R2, reference by key
  string mount_path = 4;         // Where to inject in sandbox (e.g., "/inputs/spec.yaml")
  string content_type = 5;       // MIME type (optional)
}
```

#### 1.2 Extend AgentExecutionStatus (Output)

```protobuf
// apis/ai/stigmer/agentic/agentexecution/v1/status.proto

message AgentExecutionStatus {
  repeated AgentMessage messages = 1;
  repeated ToolCall tool_calls = 2;
  repeated SubAgentExecution sub_agent_executions = 3;
  ExecutionPhase phase = 4;
  UsageMetrics usage = 5;
  ContextInfo context_info = 6;
  
  // NEW: Files/directories created by agent
  repeated ExecutionOutput outputs = 10;
}

message ExecutionOutput {
  string name = 1;                           // Display name (e.g., "my-skill")
  string sandbox_path = 2;                   // Path in sandbox where created
  ExecutionOutputKind kind = 3;              // FILE or DIRECTORY
  int64 size_bytes = 4;                      // Total size
  string storage_key = 5;                    // R2 storage location
  string download_url = 6;                   // Signed URL for download
  google.protobuf.Timestamp created_at = 7;
  google.protobuf.Timestamp expires_at = 8; // URL expiration
}

enum ExecutionOutputKind {
  EXECUTION_OUTPUT_KIND_UNSPECIFIED = 0;
  EXECUTION_OUTPUT_KIND_FILE = 1;
  EXECUTION_OUTPUT_KIND_DIRECTORY = 2;  // Stored as ZIP
}
```

---

### Phase 2: Agent Runner Implementation (Python)

#### 2.1 Inject Attachments into Sandbox

```python
# backend/services/agent-runner/worker/activities/execute_graphton.py

async def inject_attachments(sandbox, attachments: list, r2_client):
    """Download attachments and inject into sandbox."""
    for attachment in attachments:
        if attachment.content:
            # Inline content
            content = attachment.content
        elif attachment.storage_key:
            # Pre-uploaded to R2
            content = await r2_client.download(attachment.storage_key)
        else:
            continue
        
        # Upload to sandbox at specified mount path
        await sandbox.fs.upload_files([
            FileUpload(path=attachment.mount_path, content=content)
        ])
        logger.info(f"Injected attachment {attachment.filename} at {attachment.mount_path}")
```

#### 2.2 Publish Output Tool

```python
# backend/services/agent-runner/worker/tools/publish_output.py

async def publish_output(
    sandbox,
    r2_client,
    execution_id: str,
    path: str,
    name: str,
) -> ExecutionOutput:
    """
    Publish a file or directory from sandbox as a downloadable output.
    
    Args:
        path: Path in sandbox (e.g., "/workspace/my-skill")
        name: Display name for the output
    
    Returns:
        ExecutionOutput with download URL
    """
    # Check if path is file or directory
    file_info = await sandbox.fs.get_file_info(path)
    
    if file_info.is_dir:
        # Zip directory and download
        zip_path = f"/tmp/{name}.zip"
        await sandbox.process.exec(f"cd {path} && zip -r {zip_path} .")
        content = await sandbox.fs.download_file(zip_path)
        kind = ExecutionOutputKind.DIRECTORY
        filename = f"{name}.zip"
    else:
        # Download single file
        content = await sandbox.fs.download_file(path)
        kind = ExecutionOutputKind.FILE
        filename = name
    
    # Upload to R2
    storage_key = f"outputs/{execution_id}/{filename}"
    await r2_client.upload(storage_key, content)
    
    # Generate signed download URL (expires in 7 days)
    download_url = r2_client.generate_signed_url(storage_key, expires_in=7*24*3600)
    
    return ExecutionOutput(
        name=name,
        sandbox_path=path,
        kind=kind,
        size_bytes=len(content),
        storage_key=storage_key,
        download_url=download_url,
        created_at=now(),
        expires_at=now() + timedelta(days=7),
    )
```

#### 2.3 Register Tool with Agent

```python
# In graphton agent setup
tools = [
    # ... existing tools ...
    Tool(
        name="publish_output",
        description="Publish a file or directory as a downloadable output. Use this when you've created something the user should be able to download.",
        parameters={
            "path": {"type": "string", "description": "Path in sandbox to publish"},
            "name": {"type": "string", "description": "Display name for the output"},
        },
        handler=lambda path, name: publish_output(sandbox, r2_client, execution_id, path, name),
    ),
]
```

---

### Phase 3: CLI Implementation (Go)

#### 3.1 Add `--attach` Flag to Run Command

```go
// client-apps/cli/cmd/stigmer/root/run.go

var attachFiles []string

func init() {
    runAgentCmd.Flags().StringArrayVar(&attachFiles, "attach", nil, 
        "Attach file or directory to agent execution (can be used multiple times)")
}

func buildAgentExecutionSpec(message string, attachFiles []string) (*agentexecutionv1.AgentExecutionSpec, error) {
    spec := &agentexecutionv1.AgentExecutionSpec{
        Message: message,
    }
    
    for _, path := range attachFiles {
        attachment, err := createAttachment(path)
        if err != nil {
            return nil, fmt.Errorf("failed to create attachment for %s: %w", path, err)
        }
        spec.Attachments = append(spec.Attachments, attachment)
    }
    
    return spec, nil
}

func createAttachment(path string) (*agentexecutionv1.Attachment, error) {
    info, err := os.Stat(path)
    if err != nil {
        return nil, err
    }
    
    filename := filepath.Base(path)
    mountPath := "/inputs/" + filename
    
    if info.IsDir() {
        // Zip directory
        content, err := zipDirectory(path)
        if err != nil {
            return nil, err
        }
        return &agentexecutionv1.Attachment{
            Filename:  filename + ".zip",
            Content:   content,
            MountPath: mountPath + ".zip",
        }, nil
    }
    
    // Single file
    content, err := os.ReadFile(path)
    if err != nil {
        return nil, err
    }
    
    return &agentexecutionv1.Attachment{
        Filename:  filename,
        Content:   content,
        MountPath: mountPath,
    }, nil
}
```

#### 3.2 Display Outputs in Execution Result

```go
// After execution completes, display outputs
func displayExecutionOutputs(status *agentexecutionv1.AgentExecutionStatus) {
    if len(status.Outputs) == 0 {
        return
    }
    
    fmt.Println("\n📦 Outputs:")
    for _, output := range status.Outputs {
        icon := "📄"
        if output.Kind == agentexecutionv1.ExecutionOutputKind_DIRECTORY {
            icon = "📁"
        }
        fmt.Printf("  %s %s (%s)\n", icon, output.Name, humanize.Bytes(uint64(output.SizeBytes)))
        fmt.Printf("     Download: %s\n", output.DownloadUrl)
        fmt.Printf("     Expires: %s\n", output.ExpiresAt.AsTime().Format(time.RFC3339))
    }
}
```

#### 3.3 Download Command

```go
// client-apps/cli/cmd/stigmer/root/execution.go

// stigmer execution download <execution-id> [output-name] --out ./
var downloadCmd = &cobra.Command{
    Use:   "download <execution-id> [output-name]",
    Short: "Download outputs from an agent execution",
    RunE: func(cmd *cobra.Command, args []string) error {
        executionID := args[0]
        outputName := ""
        if len(args) > 1 {
            outputName = args[1]
        }
        
        // Get execution status
        execution, err := client.GetAgentExecution(ctx, executionID)
        if err != nil {
            return err
        }
        
        for _, output := range execution.Status.Outputs {
            if outputName != "" && output.Name != outputName {
                continue
            }
            
            // Download from URL
            resp, err := http.Get(output.DownloadUrl)
            if err != nil {
                return err
            }
            defer resp.Body.Close()
            
            // Save to file
            outPath := filepath.Join(outDir, output.Name)
            if output.Kind == agentexecutionv1.ExecutionOutputKind_DIRECTORY {
                outPath += ".zip"
            }
            
            f, err := os.Create(outPath)
            if err != nil {
                return err
            }
            defer f.Close()
            
            _, err = io.Copy(f, resp.Body)
            if err != nil {
                return err
            }
            
            fmt.Printf("Downloaded %s to %s\n", output.Name, outPath)
        }
        
        return nil
    },
}
```

---

### Phase 4: Daytona Volume Integration (Milestone 2)

#### 4.1 Mount Persistent Workspace

```python
# backend/services/agent-runner/worker/sandbox_manager.py

async def get_or_create_sandbox_with_workspace(session_id, user_id, project_id=None):
    """Create sandbox with persistent workspace volume."""
    
    # Determine volume subpath for isolation
    if project_id:
        subpath = f"{user_id}/{project_id}"
    else:
        subpath = f"{user_id}/{session_id}"
    
    sandbox = await daytona.create(
        # ... existing params ...
        volumes=[
            VolumeMount(
                volume_id="stigmer-workspaces",
                mount_path="/workspace",
                subpath=subpath,
            )
        ]
    )
    
    return sandbox
```

---

## Implementation Order

| Order | Task | Effort | Files |
|-------|------|--------|-------|
| 1 | Add `Attachment` message to spec.proto | Small | spec.proto |
| 2 | Add `ExecutionOutput` message to status.proto | Small | status.proto |
| 3 | Regenerate protos (buf generate) | Small | - |
| 4 | Implement attachment injection in agent-runner | Medium | execute_graphton.py |
| 5 | Implement `publish_output` tool | Medium | new: publish_output.py |
| 6 | Wire publish_output into agent tools | Small | graphton setup |
| 7 | Add `--attach` flag to CLI run command | Medium | run.go |
| 8 | Display outputs in CLI | Small | run.go |
| 9 | Add `stigmer execution download` command | Medium | new: execution.go |
| 10 | Daytona Volume integration | Medium | sandbox_manager.py |

---

## User Flow (End-to-End)

```bash
# 1. User runs agent with attachments
$ stigmer run agent local/skill-creator-agent \
    --attach ./k8s-api-spec.yaml \
    --attach ./example-manifests/ \
    -m "Create a skill for validating Kubernetes manifests"

# 2. Agent execution runs...
#    - Attachments injected at /inputs/k8s-api-spec.yaml, /inputs/example-manifests.zip
#    - Agent creates skill at /workspace/k8s-validator/
#    - Agent calls publish_output("/workspace/k8s-validator", "k8s-validator")

# 3. Execution completes, CLI shows:
✅ Agent execution completed

💬 Response:
I've created a Kubernetes manifest validator skill...

📦 Outputs:
  📁 k8s-validator (12.5 KB)
     Download: https://r2.stigmer.ai/outputs/exec-123/k8s-validator.zip?sig=...
     Expires: 2026-02-20T10:00:00Z

# 4. User downloads
$ stigmer execution download exec-123 k8s-validator --out ./
Downloaded k8s-validator to ./k8s-validator.zip

# 5. User can then push to registry
$ unzip k8s-validator.zip -d ./k8s-validator
$ stigmer push skill ./k8s-validator
```

---

## Success Criteria

1. ✅ `stigmer run agent ... --attach ./file.yaml` injects file into sandbox at `/inputs/`
2. ✅ Agent can call `publish_output("/workspace/my-skill", "my-skill")` 
3. ✅ Execution status includes `outputs` with download URLs
4. ✅ `stigmer execution download <id>` downloads outputs
5. ✅ skill-creator-agent can create skill and user can download it
6. ✅ (Milestone 2) `/workspace` persists across sandbox restarts

---

## Files to Create/Modify

### Modified Files
```
apis/ai/stigmer/agentic/agentexecution/v1/spec.proto      # Add Attachment
apis/ai/stigmer/agentic/agentexecution/v1/status.proto    # Add ExecutionOutput
backend/services/agent-runner/worker/activities/execute_graphton.py  # Inject attachments
client-apps/cli/cmd/stigmer/root/run.go                   # Add --attach flag
```

### New Files
```
backend/services/agent-runner/worker/tools/publish_output.py  # publish_output tool
client-apps/cli/cmd/stigmer/root/execution.go                 # download command
```

---

## Open Questions

1. **Large file handling**: For files > 4MB, should CLI pre-upload to R2 and pass `storage_key` instead of inline `content`?
2. **Output expiration**: 7 days default for download URLs - is this reasonable?
3. **Skill-specific flow**: Should `publish_output` have a `--push-to-registry` option to directly push skills?

---

## Review Questions

Please confirm:
1. Does this simpler approach (no separate Artifact resource) look right?
2. Is the `--attach` / `publish_output` / `outputs` flow clear?
3. Any concerns about the proto field additions?
