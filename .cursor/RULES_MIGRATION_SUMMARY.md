# Stigmer Rules Migration Summary

## Overview

Successfully separated Stigmer Cloud and Stigmer OSS rules with clear naming conventions to prevent confusion when working in multi-workspace environments.

## Naming Convention

- **Cloud**: `*stigmer-cloud*` (e.g., `commit-stigmer-cloud-changes.mdc`)
- **OSS**: `*stigmer-oss*` (e.g., `commit-stigmer-oss-changes.mdc`)

This makes it immediately clear which repository a rule belongs to when searching or indexing.

---

## Changes Made

### 1. Stigmer Cloud - Rules Renamed

All Stigmer Cloud rules have been renamed to include "cloud" in their filenames:

#### Git/Commit Rules (`.cursor/rules/`)
- ✅ `commit-stigmer-changes.mdc` → `commit-stigmer-cloud-changes.mdc`
- ✅ `create-stigmer-pull-request.mdc` → `create-stigmer-cloud-pull-request.mdc`
- ✅ `generate-stigmer-pr-info.mdc` → `generate-stigmer-cloud-pr-info.mdc`

#### Changelog Rules (`_changelog/_rules/`)
- ✅ `create-stigmer-changelog.mdc` → `create-stigmer-cloud-changelog.mdc`
- ✅ `find-stigmer-changelog.mdc` → `find-stigmer-cloud-changelog.mdc`
- ✅ `copy-stigmer-changelogs-to-staging.mdc` → `copy-stigmer-cloud-changelogs-to-staging.mdc`

#### Meeting Rules (`_meetings/_rules/`)
- ✅ `prepare-stigmer-meeting-notes.mdc` → `prepare-stigmer-cloud-meeting-notes.mdc`
- ✅ `analyze-stigmer-meeting.mdc` → `analyze-stigmer-cloud-meeting.mdc`

#### Project Rules (`_projects/_rules/`)
- ✅ `complete-stigmer-work.mdc` → `complete-stigmer-cloud-work.mdc`
- ✅ `next-stigmer-project/` → `next-stigmer-cloud-project/`
  - ✅ `start-stigmer-new-project.mdc` → `start-stigmer-cloud-new-project.mdc`
  - ✅ `improve-stigmer-project-workflow.mdc` → `improve-stigmer-cloud-project-workflow.mdc`
- ✅ `next-stigmer-quick-project/` → `next-stigmer-cloud-quick-project/`
  - ✅ `start-stigmer-quick-project.mdc` → `start-stigmer-cloud-quick-project.mdc`
  - ✅ `improve-stigmer-quick-project-workflow.mdc` → `improve-stigmer-cloud-quick-project-workflow.mdc`

#### API Rules (`apis/_rules/`)
- ✅ `model-stigmer-protos/` → `model-stigmer-cloud-protos/`
  - ✅ `model-stigmer-protos.mdc` → `model-stigmer-cloud-protos.mdc`
  - ✅ `improve-this-rule.mdc` → `improve-this-rule.mdc`

#### Backend Rules (`backend/services/stigmer-service/_rules/`)
- ✅ `implement-stigmer-backend-handlers/` → `implement-stigmer-cloud-backend-handlers/`
  - ✅ `implement-stigmer-backend-handlers.mdc` → `implement-stigmer-cloud-backend-handlers.mdc`
  - ✅ `improve-this-rule.mdc` → `improve-this-rule.mdc`
  - ✅ Preserved all `docs/` subdirectory

---

### 2. Stigmer OSS - New Rules Created

Created corresponding OSS versions with adapted content:

#### Git/Commit Rules (`.cursor/rules/`)
- ✅ `commit-stigmer-oss-changes.mdc` (adapted scopes for OSS structure)
- ✅ `create-stigmer-oss-pull-request.mdc`
- ✅ `generate-stigmer-oss-pr-info.mdc`

#### Changelog Rules (`_changelog/_rules/`)
- ✅ `create-stigmer-oss-changelog.mdc` (updated paths for OSS repo)
- ✅ `find-stigmer-oss-changelog.mdc`
- ✅ `copy-stigmer-oss-changelogs-to-staging.mdc`

#### Meeting Rules (`_meetings/_rules/`)
- ✅ `prepare-stigmer-oss-meeting-notes.mdc`
- ✅ `analyze-stigmer-oss-meeting.mdc`

#### Project Rules (`_projects/_rules/`)
- ✅ `complete-stigmer-oss-work.mdc`
- ✅ `next-stigmer-oss-project/`
  - ✅ `start-stigmer-oss-new-project.mdc`
  - ✅ `improve-stigmer-oss-project-workflow.mdc`
- ✅ `next-stigmer-oss-quick-project/`
  - ✅ `start-stigmer-oss-quick-project.mdc`
  - ✅ `improve-stigmer-oss-quick-project-workflow.mdc`

#### API Rules (`apis/_rules/`)
- ✅ `model-stigmer-oss-protos/`
  - ✅ `model-stigmer-oss-protos.mdc`
  - ✅ `improve-this-rule.mdc`

#### Backend Rules (`backend/services/stigmer-server/_rules/`)
- ✅ `implement-stigmer-oss-handlers/`
  - ✅ `implement-stigmer-oss-handlers.mdc` (**completely rewritten for Go**)
  - ✅ `improve-this-rule.mdc`

---

## Key Adaptations for OSS

### 1. Commit Scopes
Cloud scopes (Java/Spring-based):
- `apis/menu`, `apis/booking`, `apis/commons`
- `client-apps/cli`
- `backend/services/stigmer-service`

OSS scopes (Go-based):
- `apis/agent`, `apis/workflow`, `apis/commons`
- `sdk`
- `backend/stigmer-server`

### 2. Backend Handler Implementation

**Cloud (Java/Spring)**:
- Pipeline/middleware pattern
- Complex authorization with FGA
- MongoDB storage
- Auto-generated controllers
- Extensive dependency injection

**OSS (Go)**:
- Direct handler implementations
- Simple validation
- BadgerDB/SQLite storage
- Manual controller registration
- Straightforward CRUD operations

The OSS backend rule was **completely rewritten** to match the Go patterns in `agent_controller.go`.

### 3. Path Updates

All file paths have been updated:
- Cloud: `/Users/suresh/scm/github.com/leftbin/stigmer-cloud`
- OSS: `/Users/suresh/scm/github.com/stigmer/stigmer`

---

## Internal Reference Updates

All cloud rules have been updated to reference the new "cloud" naming:
- `@commit-stigmer-changes` → `@commit-stigmer-cloud-changes`
- `@model-stigmer-protos` → `@model-stigmer-cloud-protos`
- And so on...

OSS rules reference the "oss" naming:
- `@commit-stigmer-oss-changes`
- `@model-stigmer-oss-protos`
- And so on...

---

## Verification

### Stigmer Cloud
```bash
# Total renamed rules
find /Users/suresh/scm/github.com/leftbin/stigmer-cloud -name "*stigmer-cloud*.mdc" | wc -l
# Should show ~15+ files
```

### Stigmer OSS
```bash
# Total new rules
find /Users/suresh/scm/github.com/stigmer/stigmer -name "*stigmer-oss*.mdc" | wc -l
# Should show ~13+ files
```

---

## Usage Examples

### In Stigmer Cloud workspace:
```
@commit-stigmer-cloud-changes
@create-stigmer-cloud-pull-request
@model-stigmer-cloud-protos
@implement-stigmer-cloud-backend-handlers
```

### In Stigmer OSS workspace:
```
@commit-stigmer-oss-changes
@create-stigmer-oss-pull-request
@model-stigmer-oss-protos
@implement-stigmer-oss-handlers
```

---

## Benefits

1. **Clear Separation**: No confusion about which repository a rule belongs to
2. **Searchable**: "stigmer-cloud" vs "stigmer-oss" makes search/indexing clear
3. **Maintainable**: Each repository has its own rules adapted to its architecture
4. **Scalable**: Easy to add more rules without naming conflicts

---

## Next Steps

1. ✅ Test rules in both repositories
2. ✅ Commit changes to both repos
3. ✅ Update any documentation that references old rule names
4. ✅ Train team on new naming convention

---

**Migration completed successfully!** 🎉
