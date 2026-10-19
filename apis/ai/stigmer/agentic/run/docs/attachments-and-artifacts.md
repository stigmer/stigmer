# Files and Artifacts

How to give an agent files (a message's files and a conversation's Files) and download files created by agents (artifacts).

---

## Overview

Run supports a complete file lifecycle:

- **Files** — a file is uploaded once as a **File** (`ai.stigmer.agentic.file.v1`) and named by its id, `file_01j…`, wherever it should go: in a message, or in a conversation's resources.
- **Artifacts** — output files the agent *creates during* a run and publishes for download.

```
You ──► FileCommandController.upload ──► file_01j… ──► Run.spec.file_ids
                                                         │
                                      the conversation's resources gain it
                                                         │
                                       sandbox: .stigmer/uploads/...
                                                         │
                                                   Agent reads files
                                                         │
                                              Agent calls publish_artifact
                                                         │
                                         Run.status.artifacts ──► download URL
```

---

## Files — Input

### A message's files

Upload the file, then name its id in the message:

```yaml
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
  message: "Process this configuration file"
  file_ids:
    - file_01j9zq6v8w3x4y5z6a7b8c9d0e
```

A message names at most 20 Files. Each must be a File of the run's organization that the person sending the message may view. The server makes each one the conversation's own copy (a new id over the same bytes) unless it already is, adds it to the conversation's resources, and records the message's file blocks on `status.message_files` (an `image` block for JPEG, PNG, GIF and WebP, a `document` block otherwise). The turn's `user.message` carries those blocks after its text.

A message may be only files: `message` is required unless `file_ids` is set.

**Via CLI:**

```bash
stigmer run my-agent "Process this config" --attach ./config.yaml
```

The CLI uploads the file and names it in `file_ids`. A file inside the session's local workspace becomes a `workspace_file_refs` entry instead: no upload, no copy.

### A conversation's Files

A conversation's `spec.resources` lists the Files it holds beside its repositories and folders. The agent finds every one under `.stigmer/uploads/` on every turn, at its `mount_path` (by default its filename, made unique as `name-2.ext`). A routine's invocation lists Files the same way, so every run it starts finds them.

```yaml
spec:
  resources:
    - file:
        file_id: file_01j9zq6v8w3x4y5z6a7b8c9d0e
        mount_path: q3/ledger.xlsx
```

Attaching a folder (`--attach ./my-project/`) uploads each file under it (hidden entries and links skipped, at most 500) and lists each in the conversation's resources at its relative path.

### Uploading a File

`FileCommandController.upload` takes the bytes inline (under the transport's 10 MiB), or an `upload_ref` from `createUploadUrl` after the bytes were PUT to the URL it returned. Each SDK's file client chooses for you by size. A File is at most the server's `FILE_MAX_BYTES` (500 MB by default). Into a conversation (`session_id` set) it is the conversation's File; without one it is the uploader's own, private until its access widens.

---

## Workspace File References

When files already exist inside the session's workspace, use `workspace_file_refs` instead of uploading them. The agent reads the files directly from the workspace filesystem.

```yaml
spec:
  session_spec:
    agent_ref:
      kind: agent
      org: acme
      slug: my-agent
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
- The session has a local folder among its resources
- The referenced files exist inside that folder

**When to upload a File instead:**
- The file is from outside the workspace
- The session has a git repository or no folder

---

## Artifacts — Output Files

### How Artifacts Work

During run, an agent can publish files or directories for users to download by calling the `publish_artifact` tool. Stigmer stores each artifact in R2 and generates a pre-signed download URL.

When the agent publishes an artifact:

1. The file (or zipped directory) is stored in R2 at `artifacts/{run_id}/{filename}`
2. A pre-signed download URL is generated (expires in 7 days by default)
3. An `RunArtifact` entry is appended to `status.artifacts`

### RunArtifact Fields

Defined by `RunArtifact` in `api.proto`.

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Display name for the artifact. Example: `"generated-skill"`, `"analysis-report"`. |
| `sandbox_path` | `string` | Original path in the sandbox where the artifact was created. Example: `"/workspace/my-skill"`. |
| `kind` | `RunArtifactKind` | `RUN_ARTIFACT_KIND_FILE` or `RUN_ARTIFACT_KIND_DIRECTORY`. Directories are stored as ZIP archives. |
| `size_bytes` | `int64` | Total size in bytes. For directories, this is the ZIP size. |
| `storage_key` | `string` | Storage location in R2. Format: `"artifacts/{run_id}/{filename}"`. |
| `download_url` | `string` | Pre-signed URL for HTTP download. No authentication header needed. |
| `created_at` | `string` | ISO 8601 timestamp when the artifact was created. |
| `expires_at` | `string` | ISO 8601 timestamp when the download URL expires. |

### Downloading Artifacts

**Via CLI:**

```bash
# Download a specific artifact
stigmer download run run_abc123 --artifact generated-skill

# Show a run's artifacts (status.artifacts in the run's YAML)
stigmer get run run_abc123 -o yaml
```

**Direct HTTP:**

```bash
# Use the download_url from status.artifacts[] directly
curl -L "https://r2.cloudflarestorage.com/.../artifacts/..." -o output.zip
```

**Refreshing expired URLs:**

Download URLs expire after 7 days. `stigmer download run` asks for a fresh URL on every download, so it never meets an expired one. Any other client calls `getArtifactDownloadUrl` with the run's id and the artifact's `storage_key` to get a fresh one (below).

### `getArtifactDownloadUrl` RPC

| Field | Type | Description |
|---|---|---|
| `run_id` | `string` | ID of the run that produced the artifact. |
| `storage_key` | `string` | Storage key from `RunArtifact.storage_key`. |

**Response:**

| Field | Type | Description |
|---|---|---|
| `download_url` | `string` | Fresh pre-signed URL valid for HTTP GET without authentication. |
| `expires_at` | `string` | ISO 8601 timestamp when the new URL expires. |

**Security:** The `storage_key` must belong to the specified run: an artifact key starting with `"artifacts/{run_id}/"`, the embedded run id being the ownership proof. Anything else is rejected — users cannot request download URLs for other runs' files. A message's files are Files: their links come from `FileQueryController.getDownloadUrl`.

**Authorization:** Requires `can_view` permission on the run.

---

## Common Patterns

### Attach a Config File and Process It

```bash
# Attach a YAML config and ask the agent to validate it
stigmer run config-validator "Validate this configuration" --attach ./app-config.yaml
```

The agent finds the file at `.stigmer/uploads/app-config.yaml`.

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
# The CLI uploads each file under the folder into the conversation
stigmer run code-reviewer "Review this project" --attach ./src/
```

The agent finds the files under `.stigmer/uploads/`, at their paths relative to the folder.

### Download a Generated Skill

```bash
# Ask the agent to create a skill, then download it
stigmer run skill-creator "Create a skill for Kubernetes operations" -m "Generate SKILL.md"

# Find the run ID from output, then download
stigmer download run run_abc123 --artifact kubernetes-skill
```
