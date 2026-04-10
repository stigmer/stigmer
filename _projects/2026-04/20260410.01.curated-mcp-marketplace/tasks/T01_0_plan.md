# Curated MCP Marketplace -- Task Plan

**Created**: 2026-04-10
**Status**: PENDING REVIEW

## Context

The automated MCP Registry sync (temporal workflow) pulls ~5,000 servers from `registry.modelcontextprotocol.io`, quality-filters by GitHub stars, and bulk-upserts into the database. This approach has problems: too many low-value servers land on the platform, no editorial control, raw registry metadata, and the workflow itself hit Temporal's 50MB history limit.

We are replacing this with a hand-curated set of ~33 high-quality MCP servers maintained as YAML files in the seedpack, organized by use-case category.

**Reference plan**: `_cursor/plans/curated_mcp_server_marketplace_a71e3685.plan.md`

---

## Task 1: Cleanup -- Delete Synced Data + Remove Temporal Sync Workflow

**Repos**: stigmer-cloud (code changes) + stigmer CLI (runtime deletion)
**Scope**: Operational cleanup + stigmer-cloud backend code removal

### 1.1 Delete all auto-synced MCP servers from the database

- List all MCP servers in the `stigmer` org: `stigmer list mcpserver --org stigmer`
- Delete each synced server individually: `stigmer delete mcpserver <slug> --org stigmer --force`
- The synced servers (~288 upserted based on the screenshot stats) need to be deleted one-by-one since no bulk delete is available
- The system `mcp-server-stigmer` (labeled `stigmer.ai/system: "true"`) must NOT be deleted

### 1.2 Remove temporal registry sync workflow from stigmer-cloud

Delete these sync-specific files from `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/mcpserver/temporal/`:

**Workflows to delete:**
- `workflow/McpRegistrySyncWorkflow.java`
- `workflow/McpRegistrySyncWorkflowImpl.java`
- `workflow/McpRegistrySyncInput.java`
- `workflow/McpRegistrySyncResult.java`
- `workflow/McpRegistrySyncStats.java`

**Activities to delete:**
- `activity/FetchRegistryPageActivity.java` + `Impl`
- `activity/FetchGitHubMetricsBatchActivity.java` + `Impl`
- `activity/UpsertMcpServerBatchActivity.java` + `Impl`
- `activity/MarkDeprecatedServersActivity.java` + `Impl`
- `activity/SyncStateActivity.java` + `Impl`

**Models to delete:**
- `model/GitHubRepoGrade.java`
- `model/GitHubRepoMetrics.java`
- `model/RegistryPage.java`
- `model/RegistryPageResult.java`
- `model/RegistryServerEntry.java`

**Transform to delete:**
- `transform/McpRegistryTransformer.java`

**Config/registrar to delete:**
- `McpRegistrySyncScheduleRegistrar.java`
- `McpServerSyncTemporalConfig.java`
- `McpServerSyncTemporalWorkerConfig.java`
- `McpServerSyncTemporalWorkflowTypes.java`

**MUST KEEP (BuildMcpSnapshot is independent):**
- `workflow/BuildMcpSnapshotWorkflow.java` + `Impl`
- `activity/BuildMcpSnapshotActivity.java`
- `activity/ResolveSnapshotPackagesActivity.java` + `Impl`
- `model/BuildMcpSnapshotInput.java`
- `model/BuildMcpSnapshotOutput.java`
- `model/SnapshotPackages.java`
- `McpSnapshotScheduleRegistrar.java`
- `McpSnapshotTemporalConfig.java`
- `McpSnapshotTemporalWorkflowTypes.java`

### 1.3 Clean up Spring/config references

- Remove any Spring bean wiring for the deleted workflow/activities
- Remove configuration properties for `temporal.mcp-server-sync.*`
- Cancel the `mcp-registry-sync-daily` Temporal schedule in the running environment

### 1.4 Commit and PR to stigmer-cloud

---

## Task 2: Proto Cleanup + Seedpack Preparation

**Repo**: stigmer (code changes)
**Scope**: Proto field removal + CONTRIBUTING.md update

### 2.1 Slim down McpServerSource proto

File: `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto`

Remove these sync-only fields (mark as `reserved` for wire compatibility):
- `registry` (field 1)
- `registry_name` (field 2)
- `version` (field 3)
- `last_synced_at` (field 5)
- `quality_score` (field 7)
- `quality_tier` (field 8)

Keep:
- `repository_url` (field 4) -- GitHub/GitLab link for users
- `github_stars` (field 6) -- popularity signal

Update `McpServerSource` top-level comment to describe it as provenance for curated entries (not just automated sync). Update the `source` field comment on `McpServerSpec` to remove "Empty for hand-authored definitions."

### 2.2 Update CONTRIBUTING.md

Replace the current "do not manually add" guidance in `seedpack/mcp-servers/CONTRIBUTING.md` with instructions for contributing curated servers: naming conventions, required fields, quality bar, categories.

### 2.3 Verify builds

- Run proto generation to ensure the field removal compiles
- Check for any Go code referencing the removed field names

### 2.4 Commit and PR to stigmer

---

## Task 3: Create Curated MCP Server YAML Files

**Repo**: stigmer (code changes in seedpack/)
**Scope**: Create ~33 YAML files, verify GitHub repos, test seedpack apply

### 3.1 Verify GitHub repo URLs

For each server below, confirm the GitHub repo exists and is active. Use web search for any that are uncertain (marked "or community" in the brainstorm).

### 3.2 Create YAML files

Create one YAML file per curated MCP server in `seedpack/mcp-servers/`, following the template format with `source.repository_url` for the GitHub link, `spec.tags` for categorization, and `metadata.labels.category`.

**Total: ~40 servers across 14 categories.**

**Developer Tools and Version Control (4)**
1. GitHub -- `modelcontextprotocol/servers`
2. GitLab -- `modelcontextprotocol/servers`
3. Git -- `modelcontextprotocol/servers`
4. Filesystem -- `modelcontextprotocol/servers`

**Databases (7)**
5. PostgreSQL -- `modelcontextprotocol/servers`
6. SQLite -- `modelcontextprotocol/servers`
7. MongoDB -- `mongodb-js/mongodb-mcp-server`
8. Redis -- verify exact repo
9. MySQL -- verify exact repo
10. Neon -- `neondatabase/mcp-server-neon`
11. Supabase -- `supabase-community/supabase-mcp`

**Search and Research (4)**
12. Brave Search -- `modelcontextprotocol/servers`
13. Exa -- `exa-labs/exa-mcp-server`
14. Tavily -- `tavily-ai/tavily-mcp`
15. Fetch -- `modelcontextprotocol/servers`

**Cloud and Infrastructure (5)**
16. AWS -- `aws/aws-mcp`
17. Cloudflare -- `cloudflare/mcp-server-cloudflare`
18. Docker -- verify exact repo
19. Kubernetes -- `strowk/mcp-k8s-go` or verify
20. Terraform -- `hashicorp/terraform-mcp-server`

**Communication and Collaboration (3)**
21. Slack -- `modelcontextprotocol/servers`
22. Linear -- verify exact repo
23. Notion -- verify exact repo

**Productivity (2)**
24. Google Drive -- `modelcontextprotocol/servers`
25. Google Maps -- `modelcontextprotocol/servers`

**Web and Browser Automation (2)**
26. Puppeteer -- `modelcontextprotocol/servers`
27. Playwright -- `microsoft/playwright-mcp`

**Monitoring and DevOps (1)**
28. Sentry -- `modelcontextprotocol/servers`

**Payments and E-Commerce (2)**
29. Stripe -- `stripe/agent-toolkit`
30. Shopify -- verify exact repo

**Design (1)**
31. Figma -- verify exact repo

**AI and Reasoning (2)**
32. Sequential Thinking -- `modelcontextprotocol/servers`
33. Memory -- `modelcontextprotocol/servers`

**Notifications (2)**
34. Twilio -- `twilio-labs/mcp` (official, SMS/voice/WhatsApp)
35. Resend -- `resend/resend-mcp` (official, transactional email)

**Scheduling (1)**
36. Google Calendar -- `nspady/google-calendar-mcp` (1,076 stars, community)

**CRM and Customer Support (3)**
37. Salesforce -- `salesforcecli/mcp` (official, beta)
38. Atlassian (Jira + Confluence) -- `atlassian/atlassian-mcp-server` (official)
39. Zendesk -- `reminia/zendesk-mcp-server` (79 stars, community)

**Marketing (1)**
40. LinkedIn -- `eliasbiondo/linkedin-mcp-server` or `stickerdaniel/linkedin-mcp-server`

### 3.3 Test seedpack apply

- Run `stigmer seedpack apply` to verify all curated servers bootstrap correctly
- Verify the servers appear with correct metadata

### 3.4 Commit and PR to stigmer

---

## Execution Order

Tasks 1 and 2 can be done in parallel (different repos, independent changes). Task 3 depends on Task 2 (proto cleanup must land first so the YAML files use the slimmed-down source fields).

Recommended order:
1. Task 1 (stigmer-cloud cleanup) -- do first to stop the sync from running
2. Task 2 (proto + CONTRIBUTING.md) -- can overlap with Task 1
3. Task 3 (create all curated YAMLs + test) -- after Task 2 merges
