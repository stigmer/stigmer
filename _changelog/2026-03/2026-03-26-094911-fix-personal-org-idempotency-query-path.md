# Fix Personal Org Idempotency Query Path

**Date**: March 26, 2026

## Summary

Fixed a critical idempotency bug where every login created a new personal organization. The `findExistingPersonalOrg()` MongoDB query used a wrong document path (`status.audit.createdBy.id`) that skipped the `specAudit` nesting level, causing it to always return null and defeating the duplicate check.

## Problem Statement

After completing the auto-personal-org feature (project 20260325.01), every successful login through Auth0 triggered the creation of a new personal organization instead of recognizing the existing one.

### Pain Points

- Each login created a duplicate personal org with a random-suffixed slug (e.g., `suresh-x7k`, `suresh-abc`)
- The OrgSwitcher showed an ever-growing list of personal orgs
- FGA tuples and IAM policies accumulated for each duplicate
- The bug was invisible to tests because the test fixtures mirrored the same wrong document structure

## Solution

Corrected the MongoDB query path in `PersonalOrganizationActivitiesImpl.findExistingPersonalOrg()` and aligned the test fixtures with the real MongoDB document schema produced by protobuf `JsonFormat` serialization.

## Implementation Details

### Root Cause

The `ApiResourceAudit` proto has an intermediate nesting level (`spec_audit` / `status_audit`) between `audit` and `created_by`:

```
ApiResourceAuditStatus.audit  (ApiResourceAudit)
  ├── spec_audit  (ApiResourceAuditInfo)    <-- MISSING FROM QUERY
  │     └── created_by  (ApiResourceAuditActor)
  │           └── id: string
  └── status_audit  (ApiResourceAuditInfo)
```

`JsonFormat` serializes proto fields as camelCase, so the correct MongoDB path is `status.audit.specAudit.createdBy.id`. The query was using `status.audit.createdBy.id`, missing the `specAudit` level entirely.

### Duplicate Creation Mechanism

1. Auth0 webhook receiver forwards both signup (`ss`) and login (`s`) events to the same Temporal workflow
2. For existing users (login), the workflow calls `createPersonalOrganization()` as a backfill
3. `findExistingPersonalOrg()` with wrong path always returned `Optional.empty()`
4. Activity tried to create with base slug (e.g., `suresh`) -> `ALREADY_EXISTS`
5. Slug retry appended random suffix -> created a new personal org
6. Repeat on every login

### Why Tests Didn't Catch It

The test's `buildOrgDocument()` helper fabricated a BSON document with the wrong structure (matching the buggy query), and the query criteria assertion validated the wrong path. Both mocked `MongoTemplate` with `any(Query.class)`, so no query-vs-document structure mismatch was detected.

### Changes

**stigmer-cloud:**
- `PersonalOrganizationActivitiesImpl.java` — fixed query path from `status.audit.createdBy.id` to `status.audit.specAudit.createdBy.id`
- `PersonalOrganizationActivitiesImplTest.java` — fixed `buildOrgDocument()` to use correct `specAudit`/`statusAudit` nesting, fixed query assertion to validate correct path

## Benefits

- Login no longer creates duplicate personal organizations
- The idempotency check correctly finds existing personal orgs in MongoDB
- Test fixtures now match the real database schema, preventing similar bugs

## Impact

- **Users**: No more duplicate personal orgs appearing in OrgSwitcher on every login
- **Database**: Stops accumulation of orphaned org documents, IAM policies, and FGA tuples
- **Existing duplicates**: Require manual cleanup via direct MongoDB and OpenFGA Postgres scripts (documented in plan)

## Related Work

- Project: `_projects/2026-03/20260325.01.auto-personal-org`
- Sub-project: `_projects/2026-03/20260325.02.sp.on-behalf-of-grpc-channel`
- Companion fix: `fb6768bc` (remove isMachineAccount gate from on-behalf-of impersonation)

---

**Status**: ✅ Production Ready
**Timeline**: Investigation + fix in single session
