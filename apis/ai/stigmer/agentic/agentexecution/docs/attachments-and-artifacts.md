# Attachments and Artifacts

How to pass input files to agent executions (attachments) and download files created by agents (artifacts).

---

## Overview

AgentExecution supports a complete file lifecycle:

- **Attachments** — input files you provide *before* execution starts. The agent reads them from the sandbox.
- **Artifacts** — output files the agent *creates during* execution and publishes for download.

```
You ──► uploadAttachment ──► storage_key ──► AgentExecution.spec.attachments
                                                         │
                                                 sandbox: /inputs/...
                                                         │
                                                   Agent reads files
                                                         │
                                              Agent calls publish_artifact
                                                         │
                                         AgentExecution.status.artifacts ──► download URL
```

---

## Attachments — Input Files

### How Attachments Work

Attachments are a two-step process: upload first, then reference in the execution.

**Step 1 — Upload the file:**

```bash
# The CLI handles this automatically. Internally, it calls uploadAttachment RPC.
# The server returns a storage_key.
```

**Step 2 — Reference the storage key when triggering the execution:**

```yaml
spec:
  agent_id: agt_abc123
  message: "Process this configuration file"
  attachments:
    - filename: "config.yaml"
      storage_key: "attachments/01HGXXX.../config.yaml"
      mount_path: "/inputs/config.yaml"
      content_type: "application/yaml"
```

**Via CLI (steps combined automatically):**

```bash
stigmer run my-agent "Process this config" --attach ./config.yaml
```

The CLI detects whether the file is inside the session's workspace or external, then:
- **External file**: Uploads via `uploadAttachment` RPC and sets `attachments[]`
- **File inside workspace**: Sets `workspace_file_refs[]` instead — no upload, no copy

### Attachment Fields

Defined by the `Attachment` message in `spec.proto`.

| Field | Type | Required | Description |
|---|---|---|---|
| `filename` | `string` | Yes (min_len: 1) | Original filename. Used for display and default mount path. Example: `"config.yaml"`. |
| `storage_key` | `string` | Yes (min_len: 1) | Reference to the pre-uploaded file. Obtained from `uploadAttachment`. Format: `"attachments/{ulid}/{filename}"`. |
| `mount_path` | `string` | No | Path in the sandbox where the file is placed. Defaults to `/inputs/{filename}` if omitted. |
| `content_type` | `string` | No | MIME type. Example: `"application/yaml"`, `"text/plain"`, `"application/zip"`. |
| `extract` | `bool` | No | When `true`, the attachment is treated as a ZIP archive and extracted at `mount_path`. Set automatically by the CLI for directory attachments. |
| `local_path` | `string` | No | Absolute path on the CLI host. In local mode, the runner reads directly from this path, skipping the storage download round-trip. Ignored in cloud mode. |

### Mount Path Behavior

If `mount_path` is not specified, the file is placed at `/inputs/{filename}`:

```yaml
# These are equivalent:
- filename: "data.csv"
  storage_key: "attachments/.../data.csv"
  # mount_path not set → defaults to /inputs/data.csv

- filename: "data.csv"
  storage_key: "attachments/.../data.csv"
  mount_path: "/inputs/data.csv"
```

Place files in subdirectories using explicit mount paths:

```yaml
- filename: "schema.json"
  storage_key: "attachments/.../schema.json"
  mount_path: "/workspace/schema/schema.json"
```

### Directory Attachments

When you attach a directory, the CLI zips it and sets `extract: true`:

```bash
stigmer run my-agent "Analyze this project" --attach ./my-project/
```

The agent-runner extracts the ZIP at the mount path, making all files accessible under their original relative paths.

---

## Workspace File References

When files already exist inside the session's workspace, use `workspace_file_refs` instead of `attachments`. This avoids the upload round-trip — the agent reads the files directly from the workspace filesystem.

```yaml
spec:
  agent_id: agt_abc123
  message: "Review these files"
  workspace_file_refs:
    - "src/config.yaml"
    - "docs/spec.md"
```

**Via CLI:**

```bash
# The CLI automatically detects files inside the workspace and uses workspace_file_refs
stigmer run reviewer --workspace . --attach ./src/config.yaml -m "Review this"
```

**When workspace file refs are valid:**
- The session has a `workspace_source` with a local path
- The referenced files exist inside that workspace path

**When to use regular attachments instead:**
- The file is from outside the workspace
- The session has a git workspace or no workspace configured

---

## `uploadAttachment` RPC

Pre-upload files before creating an AgentExecution. The returned `storage_key` is used in `Attachment.storage_key`.

**Request — `UploadAttachmentRequest`:**

| Field | Type | Required | Description |
|---|---|---|---|
| `filename` | `string` | Yes | Original filename. Example: `"dataset.csv"`. |
| `content` | `bytes` | Yes | Binary content of the file. Maximum size ~4MB (gRPC limit). |
| `content_type` | `string` | No | MIME type. Guessed from filename extension if omitted. |

**Response — `UploadAttachmentResponse`:**

| Field | Type | Description |
|---|---|---|
| `storage_key` | `string` | Opaque storage key. Format: `"attachments/{ulid}/{filename}"`. Use in `Attachment.storage_key`. |

**Authorization:** This endpoint requires no authentication. The storage key acts as a capability token — knowing the key grants access to the content. Do not expose storage keys publicly.

---

## Artifacts — Output Files

### How Artifacts Work

During execution, an agent can publish files or directories for users to download by calling the `publish_artifact` tool. Stigmer stores each artifact in R2 and generates a pre-signed download URL.

When the agent publishes an artifact:

1. The file (or zipped directory) is stored in R2 at `artifacts/{execution_id}/{filename}`
2. A pre-signed download URL is generated (expires in 7 days by default)
3. An `ExecutionArtifact` entry is appended to `status.artifacts`

### ExecutionArtifact Fields

Defined by `ExecutionArtifact` in `api.proto`.

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Display name for the artifact. Example: `"generated-skill"`, `"analysis-report"`. |
| `sandbox_path` | `string` | Original path in the sandbox where the artifact was created. Example: `"/workspace/my-skill"`. |
| `kind` | `ExecutionArtifactKind` | `EXECUTION_ARTIFACT_KIND_FILE` or `EXECUTION_ARTIFACT_KIND_DIRECTORY`. Directories are stored as ZIP archives. |
| `size_bytes` | `int64` | Total size in bytes. For directories, this is the ZIP size. |
| `storage_key` | `string` | Storage location in R2. Format: `"artifacts/{execution_id}/{filename}"`. |
| `download_url` | `string` | Pre-signed URL for HTTP download. No authentication header needed. |
| `created_at` | `string` | ISO 8601 timestamp when the artifact was created. |
| `expires_at` | `string` | ISO 8601 timestamp when the download URL expires. |

### Downloading Artifacts

**Via CLI:**

```bash
# Download a specific artifact
stigmer agent execution download aex_abc123 --artifact generated-skill

# List all artifacts from an execution
stigmer agent execution get aex_abc123 --output yaml | grep -A5 artifacts
```

**Direct HTTP:**

```bash
# Use the download_url from status.artifacts[] directly
curl -L "https://r2.cloudflarestorage.com/.../artifacts/..." -o output.zip
```

**Refreshing expired URLs:**

Download URLs expire after 7 days. If a URL has expired, call `getArtifactDownloadUrl` to get a fresh one:

```bash
stigmer agent execution get-artifact-url aex_abc123 \
  --storage-key "artifacts/aex_abc123/generated-skill.zip"
```

### `getArtifactDownloadUrl` RPC

| Field | Type | Description |
|---|---|---|
| `execution_id` | `string` | ID of the execution that produced the artifact (or received the attachment). |
| `storage_key` | `string` | Storage key from `ExecutionArtifact.storage_key` or `Attachment.storage_key`. |

**Response:**

| Field | Type | Description |
|---|---|---|
| `download_url` | `string` | Fresh pre-signed URL valid for HTTP GET without authentication. |
| `expires_at` | `string` | ISO 8601 timestamp when the new URL expires. |

**Security:** The `storage_key` must belong to the specified execution. Two key forms are accepted: an artifact key starting with `"artifacts/{execution_id}/"` (the embedded execution id is the ownership proof), or a key listed verbatim in the execution's `spec.attachments` (attachment keys are `"attachments/{ulid}/{filename}"` and carry no execution id, so ownership is the spec reference). Anything else is rejected — users cannot request download URLs for other executions' files. The attachment arm is what lets clients render submitted attachments in the message thread after the composer's local file handles are gone.

**Authorization:** Requires `can_view` permission on the execution.

---

## Common Patterns

### Attach a Config File and Process It

```bash
# Attach a YAML config and ask the agent to validate it
stigmer run config-validator "Validate this configuration" --attach ./app-config.yaml
```

The agent finds the file at `/inputs/app-config.yaml` in its sandbox.

### Attach Multiple Files

```bash
stigmer run my-agent "Analyze these files" \
  --attach ./data.csv \
  --attach ./schema.json \
  --attach ./rules.yaml \
  -m "Validate data.csv against schema.json using the rules in rules.yaml"
```

### Attach a Directory

```bash
# The CLI zips the directory and sets extract: true
stigmer run code-reviewer "Review this project" --attach ./src/
```

The agent finds all files under `/inputs/src/` (extracted from the ZIP).

### Download a Generated Skill

```bash
# Ask the agent to create a skill, then download it
stigmer run skill-creator "Create a skill for Kubernetes operations" -m "Generate SKILL.md"

# Find the execution ID from output, then download
stigmer agent execution download aex_abc123 --artifact kubernetes-skill
```
