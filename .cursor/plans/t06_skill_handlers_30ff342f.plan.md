---
name: T06 Skill Handlers
overview: Implement missing Skill CLI handlers (get, list, delete) following established patterns. Skills are artifact-based resources (not manifest-based), so they support get/list/delete/push but NOT apply/validate.
todos:
  - id: skill-package
    content: Create client-apps/cli/internal/cli/skill/ package with get.go, delete.go, display.go, BUILD.bazel
    status: completed
  - id: list-routing
    content: Update list.go to route skills to search.List() - simplest change
    status: completed
  - id: get-routing
    content: Update get.go to wire up skill.GetFromBackend
    status: completed
  - id: delete-routing
    content: Update delete.go to wire up skill.Delete with confirmation flow
    status: completed
  - id: build-verify
    content: Update BUILD.bazel dependencies and verify with go build
    status: completed
isProject: false
---

# T06: Skill CLI Handlers Implementation

## Scope Clarification

Based on research, the actual work needed is smaller than originally described in `next-task.md`:


| Resource   | Gap Status                           | Notes                                        |
| ---------- | ------------------------------------ | -------------------------------------------- |
| **Skill**  | Need: get, delete handlers + display | list already works via search infrastructure |
| MCP Server | Complete                             | All handlers implemented                     |
| Project    | Complete                             | All handlers implemented                     |


**Key Finding**: The `search.List()` function already supports `apiresourcekind.ApiResourceKind_skill`. We only need to update the routing in `list.go` to call it - no new handler code required for list.

---

## Architecture: Skill vs Other Resources

Skills are fundamentally different from Agents/Workflows:


| Aspect        | Agent/Workflow              | Skill                                  |
| ------------- | --------------------------- | -------------------------------------- |
| Source        | YAML manifest files         | Directory with SKILL.md                |
| Create/Update | `apply -f manifest.yaml`    | `push [path]` (uploads artifact)       |
| Versioning    | Backend manages state       | Content-addressed (SHA256 hash) + tags |
| Validation    | `validate -f manifest.yaml` | N/A (SKILL.md validation during push)  |


This is why the verb support matrix correctly shows:

- Skills: get, list, delete, push
- NO apply, NO validate for skills

---

## Files to Create

### 1. `client-apps/cli/internal/cli/skill/get.go` (~60 lines)

**Purpose**: Fetch skill from backend by ID or org/slug reference

**Pattern**: Follow `agent/get.go` exactly

```go
// Key function signatures:
func GetFromBackend(conn grpc.ClientConnInterface, orgID, ref string) (*skillv1.Skill, error)
```

**Dependencies**:

- `skillv1.NewSkillQueryControllerClient(conn)`
- `client.Get(ctx, &skillv1.SkillId{Value: id})` for ID lookup
- `client.GetByReference(ctx, &apiresource.ApiResourceReference{...})` for org/slug

**Reference**: Existing pattern in `[skill_verify.go](client-apps/cli/internal/cli/apply/skill_verify.go)` lines 58-79 already uses `GetByReference`

---

### 2. `client-apps/cli/internal/cli/skill/delete.go` (~50 lines)

**Purpose**: Delete skill by ID

**Pattern**: Follow `agent/delete.go`

```go
// Key types and functions:
type DeleteOptions struct {
    SkillID string
    Conn    grpc.ClientConnInterface
}

type DeleteResult struct {
    Skill *skillv1.Skill
}

func Delete(opts *DeleteOptions) (*DeleteResult, error)
```

**Dependencies**:

- `skillv1.NewSkillCommandControllerClient(conn)`
- `client.Delete(ctx, &skillv1.SkillId{Value: id})`

---

### 3. `client-apps/cli/internal/cli/skill/display.go` (~100 lines)

**Purpose**: Format and display skill information

**Functions needed**:

```go
func DisplayGetResult(skill *skillv1.Skill, format string)
func DisplayDeleteConfirmation(skill *skillv1.Skill)
func DisplayDeleteResult(result *DeleteResult)
```

**Display fields for Skill** (from proto):

- `metadata.id`, `metadata.org`, `metadata.name`, `metadata.created_at`
- `spec.name`, `spec.tag`, `spec.description`
- `status.version_hash`, `status.state`, `status.git_provenance`

**Formats**: table (default), yaml, json (using existing protojson pattern)

---

### 4. `client-apps/cli/internal/cli/skill/BUILD.bazel`

Standard Bazel build file for the new package.

---

## Files to Modify

### 5. `client-apps/cli/cmd/stigmer/root/get.go`

Replace TODO stub with actual handler call:

```go
// Before (line 188-192):
func getSkill(ref, orgID, format string, conn *grpc.ClientConn) error {
    return fmt.Errorf("skill get not yet implemented")
}

// After:
func getSkill(ref, orgID, format string, conn *grpc.ClientConn) error {
    result, err := skill.GetFromBackend(conn, orgID, ref)
    if err != nil {
        return err
    }
    skill.DisplayGetResult(result, format)
    return nil
}
```

---

### 6. `client-apps/cli/cmd/stigmer/root/list.go`

Replace TODO stub with search.List call (no new handler needed):

```go
// Before (line 226-233):
func listSkills(orgID, format string, limit int32, conn *grpc.ClientConn) error {
    fmt.Println()
    cliprint.PrintWarning("Skill list not yet implemented")
    fmt.Println()
    return nil
}

// After (follows exact pattern of listAgents):
func listSkills(orgID, format string, limit int32, conn *grpc.ClientConn) error {
    result, err := search.List(&search.ListOptions{
        Kind:     apiresourcekind.ApiResourceKind_skill,
        Org:      orgID,
        Conn:     conn,
        PageSize: limit,
    })
    if err != nil {
        return errors.Wrap(err, "failed to list skills")
    }
    
    search.DisplayResults(result, &search.DisplayOptions{
        Format:       format,
        ResourceName: "Skill",
    })
    return nil
}
```

---

### 7. `client-apps/cli/cmd/stigmer/root/delete.go`

Replace TODO stub with actual handler call:

```go
// Before (line 252-256):
func deleteSkill(ref, orgID string, force bool, conn *grpc.ClientConn) error {
    return fmt.Errorf("skill delete not yet implemented")
}

// After (follows deleteAgent pattern):
func deleteSkill(ref, orgID string, force bool, conn *grpc.ClientConn) error {
    // Get skill first to show confirmation and resolve ID
    skillRes, err := skill.GetFromBackend(conn, orgID, ref)
    if err != nil {
        return err
    }
    
    if !force {
        skill.DisplayDeleteConfirmation(skillRes)
        cliprint.PrintInfo("Use --force to skip this confirmation")
        fmt.Println()
    }
    
    result, err := skill.Delete(&skill.DeleteOptions{
        SkillID: skillRes.Metadata.Id,
        Conn:    conn,
    })
    if err != nil {
        return err
    }
    
    skill.DisplayDeleteResult(result)
    return nil
}
```

---

### 8. `client-apps/cli/cmd/stigmer/root/BUILD.bazel`

Add dependency on new `//client-apps/cli/internal/cli/skill` package.

---

## Implementation Order

1. **Create skill package** (get.go, delete.go, display.go, BUILD.bazel)
2. **Update list.go** - Simplest change, uses existing search infrastructure
3. **Update get.go** - Wire up new skill.GetFromBackend
4. **Update delete.go** - Wire up skill.Delete with confirmation flow
5. **Update BUILD.bazel** - Add skill package dependency
6. **Verify** - `go build ./cmd/stigmer/...`

---

## Quality Checklist (per coding guidelines)

- Every file under 250 lines (target: 50-100 lines each)
- Every function under 50 lines
- Every error wrapped with specific context
- Proper package organization (business logic in `internal/cli/skill/`)
- Command handlers remain thin orchestration (no business logic)
- Import organization with blank line separators

---

## Risks and Considerations

1. **Reference parsing**: Skills use org/slug references like `myorg/calculator`. Need to verify the `reference.Parse()` utility works for skills (should work - it's generic).
2. **Delete returns deleted resource**: The `SkillCommandController.Delete()` should return the deleted Skill proto. Need to verify this matches the proto definition (it does - returns `Skill`).
3. **Version handling**: Skills have versions (tags and hashes). For `get`, should we support version specifiers like `myorg/calculator:v1.0` or `myorg/calculator@abc123`? The proto's `GetByReference` supports this via the `ApiResourceReference.version` field. **Question for you**: Should we support version specifiers in get, or keep it simple (always get latest)?

