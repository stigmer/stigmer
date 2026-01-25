# Checkpoint: Artifact Download & Extraction Complete

**Date**: 2026-01-25
**Task**: T01.6 - Artifact Download & Extraction
**Status**: ✅ Complete

---

## Summary

Implemented complete artifact download and extraction pipeline following ADR 001: Skill Injection & Sandbox Mounting Strategy. Skills can now download ZIP files from R2 storage and extract them into the sandbox at `/bin/skills/{version_hash}/`, making executable implementations (scripts, binaries) available to agents.

---

## What Was Accomplished

### 1. Proto API Definition (stigmer OSS)

**New Messages in `io.proto`:**
- `GetArtifactRequest` - Contains `artifact_storage_key` field
- `GetArtifactResponse` - Contains `artifact` bytes field (ZIP file)

**New RPC in `query.proto`:**
- `getArtifact(GetArtifactRequest) returns (GetArtifactResponse)`
- Authorization skipped (storage key acts as capability token)
- Used by agent-runner to download skill artifacts

**Generated Stubs:**
- Regenerated for all languages: Java, Python, Go, TypeScript, Dart

### 2. Java Backend Handler (stigmer-cloud)

**Created `SkillGetArtifactHandler.java`:**
```java
@RequestRoute(controller = SkillQueryControllerGrpc.class,
        method = SkillQueryController.Method.getArtifact)
public class SkillGetArtifactHandler extends CustomOperationHandlerV2<...>
```

**Key Features:**
- Downloads artifacts from R2 using `SkillArtifactR2Store.get()`
- Returns ZIP bytes via gRPC response
- Proper error handling:
  - `NOT_FOUND` if artifact doesn't exist
  - `INTERNAL` if download fails
- Logging for observability

**Pipeline:**
1. ValidateFieldConstraints
2. LoadArtifact (from R2)
3. TransformResponse
4. SendResponse

### 3. Python gRPC Client (stigmer OSS)

**Added to `SkillClient`:**
```python
async def get_artifact(self, artifact_storage_key: str) -> bytes:
    """Download skill artifact from storage."""
```

**Features:**
- Async download via gRPC
- Returns artifact bytes (ZIP file)
- Error handling:
  - `ValueError` if artifact not found
  - Propagates other gRPC errors
- Detailed logging

### 4. Skill Writer Enhancement (stigmer OSS)

**Updated `skill_writer.py`:**

**Modified Method Signature:**
```python
def write_skills(self, skills: list[Skill], artifacts: dict[str, bytes] | None = None) -> dict[str, str]
```

**New Local Extraction:**
```python
def _extract_artifact_local(self, artifact_bytes: bytes, target_dir: str) -> None:
    """Extract skill artifact ZIP to local filesystem."""
```
- Extracts all files from ZIP
- Makes scripts executable (`.sh`, `.py`, `.js`, `.ts`, `.rb`, `.pl`)
- Sets permissions to `0o755` for known script types

**New Daytona Extraction:**
```python
def _extract_artifact_daytona(self, skill_dir: str) -> None:
    """Extract skill artifact ZIP in Daytona sandbox."""
```
- Uploads ZIP to sandbox
- Extracts using `unzip` command
- Makes scripts executable with `chmod +x`
- Cleans up ZIP after extraction

**Backward Compatibility:**
- If no artifact provided, writes SKILL.md only (old behavior)
- If artifact provided, extracts complete ZIP (new behavior)

### 5. Execute Graphton Integration (stigmer OSS)

**Updated `execute_graphton.py`:**

**Artifact Download Loop:**
```python
artifacts = {}
for skill in skills:
    if skill.status.artifact_storage_key:
        artifact_bytes = await skill_client.get_artifact(
            skill.status.artifact_storage_key
        )
        artifacts[skill.metadata.id] = artifact_bytes
```

**Pass to Writer:**
```python
skill_paths = skill_writer.write_skills(skills, artifacts=artifacts)
```

**Graceful Degradation:**
- If artifact download fails, logs warning
- Falls back to SKILL.md-only mode
- Doesn't fail the entire execution

---

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                  ARTIFACT DOWNLOAD & EXTRACTION                 │
├─────────────────────────────────────────────────────────────────┤
│ 1. Agent execution starts                                       │
│ 2. Fetch skills via getByReference (with version resolution)    │
│ 3. For each skill with artifact_storage_key:                    │
│    a. Call getArtifact(storage_key) via gRPC                    │
│    b. Java handler downloads from R2                            │
│    c. Returns ZIP bytes to Python                               │
│ 4. Pass artifacts dict to SkillWriter.write_skills()            │
│ 5. Extract ZIP to /bin/skills/{version_hash}/                   │
│    - Local mode: Extract to local filesystem                    │
│    - Cloud mode: Upload ZIP, extract in sandbox                 │
│ 6. Make scripts executable                                      │
│ 7. Inject SKILL.md into system prompt with LOCATION header      │
│ 8. Agent can now use both instructions and executables          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files Modified

### stigmer OSS Repo (13 files)

**Proto Definitions:**
- `apis/ai/stigmer/agentic/skill/v1/io.proto` (+13 lines)
- `apis/ai/stigmer/agentic/skill/v1/query.proto` (+11 lines)

**Generated Stubs:**
- `apis/stubs/go/ai/stigmer/agentic/skill/v1/io.pb.go`
- `apis/stubs/go/ai/stigmer/agentic/skill/v1/query.pb.go`
- `apis/stubs/go/ai/stigmer/agentic/skill/v1/query_grpc.pb.go`
- `apis/stubs/python/stigmer/ai/stigmer/agentic/skill/v1/io_pb2.py`
- `apis/stubs/python/stigmer/ai/stigmer/agentic/skill/v1/io_pb2.pyi`
- `apis/stubs/python/stigmer/ai/stigmer/agentic/skill/v1/query_pb2.py`
- `apis/stubs/python/stigmer/ai/stigmer/agentic/skill/v1/query_pb2_grpc.py`

**Implementation:**
- `backend/services/agent-runner/grpc_client/skill_client.py` (+44 lines)
- `backend/services/agent-runner/worker/activities/execute_graphton.py` (+28 lines)
- `backend/services/agent-runner/worker/activities/graphton/skill_writer.py` (+140 lines)

**Project Docs:**
- `_projects/2026-01/20260125.01.skill-api-enhancement/next-task.md` (updated)

### stigmer-cloud Repo (new file + stubs)

**New Handler:**
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/skill/request/handler/SkillGetArtifactHandler.java` (+113 lines)

**Generated Stubs:**
- `apis/stubs/java/src/main/java/protos/ai/stigmer/agentic/skill/v1/GetArtifactRequest.java`
- `apis/stubs/java/src/main/java/protos/ai/stigmer/agentic/skill/v1/GetArtifactRequestOrBuilder.java`
- `apis/stubs/java/src/main/java/protos/ai/stigmer/agentic/skill/v1/GetArtifactResponse.java`
- `apis/stubs/java/src/main/java/protos/ai/stigmer/agentic/skill/v1/GetArtifactResponseOrBuilder.java`
- `apis/stubs/java/src/main/java/protos/ai/stigmer/agentic/skill/v1/IoProto.java` (updated)
- `apis/stubs/java/src/main/java/protos/ai/stigmer/agentic/skill/v1/QueryProto.java` (updated)
- `apis/stubs/java/src/main/java/protos/ai/stigmer/agentic/skill/v1/SkillQueryControllerGrpc.java` (updated)
- Plus TypeScript, Dart, and other language stubs

---

## Design Decisions

### 1. gRPC vs Direct R2 Access

**Chosen:** gRPC endpoint

**Rationale:**
- Reuses existing Java R2 infrastructure
- No credential management in Python
- Centralized access control
- Skill ZIPs are small (<10MB) - acceptable for gRPC
- Simpler architecture

### 2. Artifact Storage Key as Capability Token

**Decision:** No authorization check on `getArtifact` RPC

**Rationale:**
- Storage key itself acts as a capability token
- Only obtained by authorized agents through `getByReference`
- Simplifies handler implementation
- Follows security-by-obscurity for private storage keys

### 3. Graceful Degradation

**Decision:** Don't fail execution if artifact download fails

**Rationale:**
- SKILL.md in prompt is often sufficient
- Network errors shouldn't block agent execution
- Agents can still use skills in read-only mode
- Better user experience

### 4. Executable Permissions

**Decision:** Auto-detect and chmod known script extensions

**Rationale:**
- Users shouldn't need to set permissions in ZIP
- Covers common cases (`.sh`, `.py`, `.js`, etc.)
- Safe operation (only affects skill directory)
- Works in both local and Daytona modes

---

## Testing Notes

**Not Yet Tested:**
- Actual artifact download from R2 (requires R2 bucket setup)
- ZIP extraction in production environment
- Script execution permissions
- Large artifact handling

**Prerequisites for Testing:**
1. Create R2 bucket: `stigmer-prod-skills-r2-bucket`
2. Create R2 API token
3. Update secrets: `stigmer-service-r2-credentials.yaml`
4. Push a skill with executable files
5. Execute an agent that uses the skill

---

## Related Documentation

- **ADR 001**: `stigmer/_cursor/adr-doc.md` - Skill Injection & Sandbox Mounting Strategy
- **Previous Checkpoint**: `2026-01-25-agent-runner-skill-injection.md` - T01.5
- **Design Decisions**: `design-decisions/01-skill-proto-structure.md`
- **Skill Proto**: `apis/ai/stigmer/agentic/skill/v1/`

---

## Next Steps

1. **Unit Tests**:
   - `test_skill_client_get_artifact()`
   - `test_skill_writer_extract_local()`
   - `test_skill_writer_extract_daytona()`
   - `test_skill_get_artifact_handler()`

2. **Integration Test**:
   - End-to-end: push → download → extract → inject → execute

3. **R2 Setup** (user action required):
   - Create bucket
   - Generate API token
   - Update credentials

4. **CLI Enhancement**:
   - Add `stigmer skill push` command
   - Validate ZIP structure before upload

5. **Documentation**:
   - Update agent-runner architecture docs
   - Add skill development guide

---

**Status**: Artifact download and extraction complete ✅  
**Duration**: ~2 hours  
**Next**: Unit tests and integration testing
