# SDK Examples URL Migration Analysis

**Analysis Date:** January 24, 2026  
**Repository:** https://github.com/stigmer/hello-stigmer (Reference)  
**Goal:** Replace demo/placeholder URLs with real, working GitHub API endpoints

## Executive Summary

Currently, 11 out of 19 SDK examples use placeholder URLs (`example.com`, `jsonplaceholder.typicode.com`). This analysis evaluates which examples can be migrated to real GitHub API endpoints and provides implementation recommendations.

---

## Current URL Inventory

### Placeholder URLs Found

| URL Pattern | Count | Usage Context |
|------------|-------|---------------|
| `https://jsonplaceholder.typicode.com` | 1 | Basic workflow HTTP GET |
| `https://api.example.com` | 6 | Workflow conditional/loop/error handling examples |
| `https://example.com` | 4 | Agent icon URLs, environment config |
| `https://database-api.example.com` | 1 | Secrets example (database simulation) |
| `https://mcp.example.com/api` | 1 | MCP server example |

### Real URLs Already Used

| URL Pattern | Count | Usage Context |
|------------|-------|---------------|
| `https://api.github.com` | 3 | GitHub API calls in workflow examples |
| `https://api.openai.com` | 2 | Runtime secrets example |
| `https://api.stripe.com` | 1 | Runtime secrets example |
| `https://hooks.slack.com` | 1 | Runtime secrets example |

---

## Migration Assessment by Example

### ✅ **HIGH PRIORITY - Easy Migration to GitHub**

#### 1. `07_basic_workflow.go` - **MUST MIGRATE**

**Current:**
```go
apiBase := ctx.SetString("apiBase", "https://jsonplaceholder.typicode.com")
fetchTask := wf.HttpGet("fetchData", 
    workflow.Interpolate(apiBase, "/posts/1"),
    map[string]string{"Content-Type": "application/json"})
```

**Recommended GitHub Migration:**
```go
// Use the public hello-stigmer repository
apiBase := ctx.SetString("apiBase", "https://api.github.com")
fetchTask := wf.HttpGet("fetchPullRequest", 
    workflow.Interpolate(apiBase, "/repos/stigmer/hello-stigmer/pulls/1"),
    map[string]string{
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Stigmer-SDK-Example",
    })
```

**Why GitHub Works Better:**
- ✅ Real, stable public API (GitHub is always available)
- ✅ Actual working endpoint: https://github.com/stigmer/hello-stigmer
- ✅ No authentication required for public repo reads
- ✅ Rich response schema (title, body, labels, state, etc.)
- ✅ Can be used as E2E test
- ✅ Demonstrates real-world API integration

**Alternative Endpoints:**
```go
// 1. Get repository info
"/repos/stigmer/hello-stigmer"

// 2. List pull requests
"/repos/stigmer/hello-stigmer/pulls"

// 3. Get specific PR
"/repos/stigmer/hello-stigmer/pulls/1"

// 4. List commits
"/repos/stigmer/hello-stigmer/commits"

// 5. Get README
"/repos/stigmer/hello-stigmer/readme"
```

**Migration Impact:** 🟢 **LOW RISK**
- Simple 1:1 replacement
- GitHub API is more reliable than jsonplaceholder
- Response structure is richer (more realistic)
- No breaking changes to example logic

---

#### 2. `08_workflow_with_conditionals.go` - **SHOULD MIGRATE**

**Current:**
```go
apiBase := ctx.SetString("apiBase", "https://api.example.com")
checkTask := wf.HttpGet("checkEnvironment",
    apiBase.Concat("/status").Expression(), nil)

statusCode := checkTask.Field("statusCode")
switchTask := wf.Switch("routeByStatus", &workflow.SwitchArgs{
    Cases: []*types.SwitchCase{
        {When: statusCode.Equals(200), Then: "deployProduction"},
        {When: statusCode.Equals(202), Then: "deployStaging"},
    },
})
```

**Recommended GitHub Migration:**
```go
apiBase := ctx.SetString("apiBase", "https://api.github.com")

// Check GitHub API status (meta endpoint)
checkTask := wf.HttpGet("checkGitHubStatus",
    apiBase.Concat("/meta").Expression(),
    map[string]string{
        "Accept": "application/vnd.github.v3+json",
    })

// Switch based on actual response presence
statusCode := checkTask.Field("statusCode")
switchTask := wf.Switch("routeByStatus", &workflow.SwitchArgs{
    Cases: []*types.SwitchCase{
        {
            Name: "production",
            When: statusCode.Equals(200), // GitHub API healthy
            Then: "deployProduction",
        },
        {
            Name: "staging",
            When: statusCode.GreaterThanOrEqual(400), // GitHub API error
            Then: "handleError",
        },
    },
})
```

**Real-World Scenario:**
```go
// Alternative: Check PR status to route deployment
prStatus := wf.HttpGet("checkPRStatus",
    "https://api.github.com/repos/stigmer/hello-stigmer/pulls/1",
    map[string]string{"Accept": "application/vnd.github.v3+json"})

state := prStatus.Field("state")
mergeable := prStatus.Field("mergeable")

wf.Switch("deploymentDecision", &workflow.SwitchArgs{
    Cases: []*types.SwitchCase{
        {
            Name: "deploy",
            When: state.Equals("closed").And(mergeable.Equals(true)),
            Then: "deployProduction",
        },
        {
            Name: "skip",
            When: state.Equals("open"),
            Then: "skipDeployment",
        },
    },
})
```

**Migration Impact:** 🟢 **LOW RISK**
- Demonstrates real CI/CD pattern
- HTTP status codes work the same way
- Shows realistic conditional deployment logic

---

#### 3. `09_workflow_with_loops.go` - **SHOULD MIGRATE**

**Current:**
```go
apiBase := ctx.SetString("apiBase", "https://api.example.com")
fetchTask := wf.HttpGet("fetchItems",
    apiBase.Concat("/items"), nil)

loopTask := wf.ForEach("processEachItem", &workflow.ForArgs{
    In: fetchTask.Field("items"),
    Do: workflow.LoopBody(func(item workflow.LoopVar) []*workflow.Task {
        return []*workflow.Task{
            wf.HttpPost("processItem",
                apiBase.Concat("/process"), nil,
                map[string]interface{}{
                    "itemId": item.Field("id"),
                    "data":   item.Field("data"),
                }),
        }
    }),
})
```

**Recommended GitHub Migration:**
```go
apiBase := ctx.SetString("apiBase", "https://api.github.com")

// Fetch all pull requests
fetchPRs := wf.HttpGet("fetchPullRequests",
    apiBase.Concat("/repos/stigmer/hello-stigmer/pulls"),
    map[string]string{"Accept": "application/vnd.github.v3+json"})

// Loop over each PR to process
loopTask := wf.ForEach("processEachPR", &workflow.ForArgs{
    In: fetchPRs, // GitHub returns array directly
    Do: workflow.LoopBody(func(pr workflow.LoopVar) []*workflow.Task {
        return []*workflow.Task{
            wf.HttpGet("fetchPRDetails",
                workflow.Interpolate(
                    apiBase,
                    "/repos/stigmer/hello-stigmer/pulls/",
                    pr.Field("number"),
                ),
                map[string]string{"Accept": "application/vnd.github.v3+json"},
            ),
        }
    }),
})
```

**Real-World Scenario:**
```go
// Loop over commits in a PR
fetchCommits := wf.HttpGet("fetchCommits",
    "https://api.github.com/repos/stigmer/hello-stigmer/pulls/1/commits",
    map[string]string{"Accept": "application/vnd.github.v3+json"})

loopTask := wf.ForEach("analyzeEachCommit", &workflow.ForArgs{
    In: fetchCommits,
    Do: workflow.LoopBody(func(commit workflow.LoopVar) []*workflow.Task {
        return []*workflow.Task{
            wf.Set("analyzeCommit", &workflow.SetArgs{
                Variables: map[string]string{
                    "sha":     commit.Field("sha").Expression(),
                    "message": commit.Field("commit.message").Expression(),
                    "author":  commit.Field("commit.author.name").Expression(),
                },
            }),
        }
    }),
})
```

**Migration Impact:** 🟢 **LOW RISK**
- Demonstrates real batch processing
- GitHub PRs/commits are perfect loop candidates
- Shows realistic data pipeline pattern

---

#### 4. `11_workflow_with_parallel_execution.go` - **SHOULD MIGRATE**

**Current:**
```go
_ = wf.Fork("fetchAllData", &workflow.ForkArgs{
    Branches: []map[string]interface{}{
        {
            "name": "fetchUsers",
            "tasks": []interface{}{
                map[string]interface{}{
                    "httpCall": map[string]interface{}{
                        "method": "GET",
                        "uri":    apiBase.Concat("/users").Expression(),
                    },
                },
            },
        },
        // More branches...
    },
})
```

**Recommended GitHub Migration:**
```go
apiBase := ctx.SetString("apiBase", "https://api.github.com/repos/stigmer/hello-stigmer")

_ = wf.Fork("fetchAllGitHubData", &workflow.ForkArgs{
    Branches: []map[string]interface{}{
        {
            "name": "fetchPullRequests",
            "tasks": []interface{}{
                map[string]interface{}{
                    "httpCall": map[string]interface{}{
                        "method": "GET",
                        "uri":    apiBase.Concat("/pulls").Expression(),
                        "headers": map[string]string{
                            "Accept": "application/vnd.github.v3+json",
                        },
                    },
                },
            },
        },
        {
            "name": "fetchIssues",
            "tasks": []interface{}{
                map[string]interface{}{
                    "httpCall": map[string]interface{}{
                        "method": "GET",
                        "uri":    apiBase.Concat("/issues").Expression(),
                        "headers": map[string]string{
                            "Accept": "application/vnd.github.v3+json",
                        },
                    },
                },
            },
        },
        {
            "name": "fetchCommits",
            "tasks": []interface{}{
                map[string]interface{}{
                    "httpCall": map[string]interface{}{
                        "method": "GET",
                        "uri":    apiBase.Concat("/commits").Expression(),
                        "headers": map[string]string{
                            "Accept": "application/vnd.github.v3+json",
                        },
                    },
                },
            },
        },
    },
})

// Merge results
wf.Set("mergeResults", &workflow.SetArgs{
    Variables: map[string]string{
        "pulls":   "${ $context[\"fetchAllGitHubData\"].branches.fetchPullRequests.data }",
        "issues":  "${ $context[\"fetchAllGitHubData\"].branches.fetchIssues.data }",
        "commits": "${ $context[\"fetchAllGitHubData\"].branches.fetchCommits.data }",
        "status":  "merged",
    },
})
```

**Migration Impact:** 🟢 **LOW RISK**
- Perfect demonstration of parallel API calls
- Real-world pattern for fetching related data
- GitHub provides multiple related endpoints

---

#### 5. `10_workflow_with_error_handling.go` - **SHOULD MIGRATE**

**Current:**
```go
tryTask := wf.Try("attemptAPICall", &workflow.TryArgs{
    Tasks: []map[string]interface{}{
        {
            "httpCall": map[string]interface{}{
                "method": "GET",
                "uri":    apiBase.Concat("/data").Expression(),
            },
        },
    },
    Catch: []map[string]interface{}{
        {
            "errors": []string{"NetworkError", "TimeoutError"},
            "as":     "error",
            "tasks": []interface{}{...},
        },
    },
})
```

**Recommended GitHub Migration:**
```go
apiBase := ctx.SetString("apiBase", "https://api.github.com")

tryTask := wf.Try("attemptGitHubCall", &workflow.TryArgs{
    Tasks: []map[string]interface{}{
        {
            "httpCall": map[string]interface{}{
                "method": "GET",
                "uri":    apiBase.Concat("/repos/stigmer/hello-stigmer/pulls/1").Expression(),
                "headers": map[string]string{
                    "Accept": "application/vnd.github.v3+json",
                },
            },
        },
    },
    Catch: []map[string]interface{}{
        {
            "errors": []string{"NetworkError", "TimeoutError", "404NotFound"},
            "as":     "error",
            "tasks": []interface{}{
                map[string]interface{}{
                    "set": map[string]interface{}{
                        "error":     "${.error.message}",
                        "timestamp": "${.error.timestamp}",
                        "retryable": "true",
                    },
                },
            },
        },
    },
})
```

**Migration Impact:** 🟢 **LOW RISK**
- Demonstrates realistic error handling
- GitHub API can return real 404/403/500 errors
- Shows production-ready retry pattern

---

### 🟡 **MEDIUM PRIORITY - Partial Migration Possible**

#### 6. `13_workflow_and_agent_shared_context.go` - **PARTIAL MIGRATION**

**Current:**
```go
apiURL := ctx.SetString("apiURL", "https://api.example.com")
endpoint := apiURL.Concat("/data")
_ = wf.HttpGet("fetchData", endpoint.Expression(), ...)
```

**Recommended:**
```go
// Can migrate HTTP call to GitHub
apiURL := ctx.SetString("apiURL", "https://api.github.com")
endpoint := apiURL.Concat("/repos/stigmer/hello-stigmer")
_ = wf.HttpGet("fetchRepoData", endpoint.Expression(), map[string]string{
    "Accept": "application/vnd.github.v3+json",
})
```

**Migration Impact:** 🟡 **MEDIUM**
- Example focuses on shared context, not the API
- GitHub migration doesn't affect core concept
- Optional but recommended for realism

---

#### 7. `12_agent_with_typed_context.go` - **KEEP AS IS (Icon URL)**

**Current:**
```go
baseIconURL := ctx.SetString("baseIconURL", "https://example.com")
iconURL := baseIconURL.Concat("/icons/code-reviewer.png")
```

**Recommendation:** ❌ **DO NOT MIGRATE**

**Reason:**
- This is a configuration example, not an API call
- Icon URLs are metadata, not functional endpoints
- `example.com` is appropriate for placeholder configuration
- Migration adds no value

---

### ❌ **LOW PRIORITY - Keep as Placeholders**

#### 8. `01_basic_agent.go` - **KEEP AS IS**

**Current:**
```go
IconUrl: "https://example.com/icons/code-reviewer.png"
```

**Recommendation:** ❌ **DO NOT MIGRATE**  
Reason: Agent metadata, not a functional API call

---

#### 9. `03_agent_with_mcp_servers.go` - **KEEP AS IS**

**Current:**
```go
mcpserver.WithURL("https://mcp.example.com/api")
```

**Recommendation:** ❌ **DO NOT MIGRATE**  
Reason: MCP server configuration example, not an actual MCP server

---

#### 10. `05_agent_with_environment_variables.go` - **KEEP AS IS**

**Current:**
```go
environment.WithDefaultValue("https://api.example.com")
IconUrl: "https://example.com/deployer-icon.png"
```

**Recommendation:** ❌ **DO NOT MIGRATE**  
Reason: Configuration/metadata examples

---

### ✅ **ALREADY USING REAL APIs**

#### 11-19. Examples Already Using GitHub/OpenAI/Stripe

The following examples **already use real APIs** and need no changes:

- `14_workflow_with_runtime_secrets.go` - ✅ Uses GitHub, OpenAI, Stripe APIs
- `15_workflow_calling_simple_agent.go` - ✅ No HTTP calls (agent demo)
- `16_workflow_calling_agent_by_slug.go` - ✅ No HTTP calls (agent reference demo)
- `17_workflow_agent_with_runtime_secrets.go` - ✅ No HTTP calls (secrets demo)
- `18_workflow_multi_agent_orchestration.go` - ✅ Uses GitHub API already
- `19_workflow_agent_execution_config.go` - ✅ No HTTP calls (config demo)

---

## Migration Summary

| Priority | Count | Examples | Action |
|----------|-------|----------|--------|
| 🟢 **High (Must Do)** | 5 | 07, 08, 09, 10, 11 | Migrate to GitHub API |
| 🟡 **Medium (Should Do)** | 1 | 13 | Optional GitHub migration |
| ❌ **Low (Keep)** | 4 | 01, 03, 05, 12 | Keep example.com (config/metadata) |
| ✅ **Done** | 9 | 02, 04, 06, 14-19 | Already using real APIs or no APIs |

---

## Implementation Plan

### Phase 1: Core Workflow Examples (Week 1)

1. **07_basic_workflow.go** - Replace jsonplaceholder with GitHub
   - Use `/repos/stigmer/hello-stigmer/pulls/1`
   - Add proper Accept headers
   - Update comments to reflect real API

2. **08_workflow_with_conditionals.go** - GitHub status-based routing
   - Use `/repos/stigmer/hello-stigmer/pulls/{number}`
   - Switch on PR state/mergeable status
   - Demonstrate real deployment decision logic

3. **09_workflow_with_loops.go** - Loop over GitHub data
   - Fetch all PRs: `/repos/stigmer/hello-stigmer/pulls`
   - Loop over commits: `/repos/stigmer/hello-stigmer/pulls/1/commits`
   - Process each commit SHA

### Phase 2: Advanced Patterns (Week 2)

4. **10_workflow_with_error_handling.go** - GitHub error handling
   - Try/catch with real GitHub API
   - Handle 404/403/500 errors
   - Demonstrate retry logic

5. **11_workflow_with_parallel_execution.go** - Parallel GitHub fetches
   - Fork to fetch PRs, issues, commits in parallel
   - Merge results
   - Real-world data aggregation pattern

### Phase 3: Optional Enhancements

6. **13_workflow_and_agent_shared_context.go** - GitHub for consistency
   - Optional: migrate HTTP call to GitHub
   - Maintains focus on shared context concept

---

## GitHub API Endpoints Reference

### Public Repository: `stigmer/hello-stigmer`

All these endpoints **work without authentication** for public repos:

```bash
# Repository info
GET https://api.github.com/repos/stigmer/hello-stigmer

# Pull requests (list)
GET https://api.github.com/repos/stigmer/hello-stigmer/pulls

# Specific PR
GET https://api.github.com/repos/stigmer/hello-stigmer/pulls/1

# PR commits
GET https://api.github.com/repos/stigmer/hello-stigmer/pulls/1/commits

# PR files
GET https://api.github.com/repos/stigmer/hello-stigmer/pulls/1/files

# Issues (list)
GET https://api.github.com/repos/stigmer/hello-stigmer/issues

# Commits (list)
GET https://api.github.com/repos/stigmer/hello-stigmer/commits

# README
GET https://api.github.com/repos/stigmer/hello-stigmer/readme

# API status (meta)
GET https://api.github.com/meta
```

### Headers Required

```go
map[string]string{
    "Accept":     "application/vnd.github.v3+json",
    "User-Agent": "Stigmer-SDK-Example", // GitHub requires User-Agent
}
```

---

## Testing Strategy

### E2E Test Compatibility

All migrated examples can be run as E2E tests:

```bash
# Test example 07
go run sdk/go/examples/07_basic_workflow.go
# Should successfully fetch PR #1 from hello-stigmer

# Test example 09
go run sdk/go/examples/09_workflow_with_loops.go
# Should successfully loop over PRs

# Run as actual E2E test
stigmer run basic-data-fetch --wait
# Should complete successfully with real GitHub data
```

### Validation Criteria

✅ **Success Criteria:**
1. Example code runs without errors
2. GitHub API returns 200 OK
3. Response data is processed correctly
4. Field references work (title, body, state, etc.)
5. Can be used as automated E2E test

---

## Benefits of Migration

### 1. **Realistic Learning Experience**
- Developers see real API responses
- Understand actual data structures
- Learn production API patterns

### 2. **Working E2E Tests**
- Examples double as test cases
- Continuous validation of SDK
- Catch breaking changes early

### 3. **Professional Code Quality**
- No "dummy" URLs like `example.com`
- Production-ready code examples
- Copy-paste ready for real projects

### 4. **GitHub Integration Story**
- Demonstrates Stigmer's value for code review
- Shows integration with developer workflows
- Aligns with the `stigmer new` quickstart (uses hello-stigmer)

---

## Risks & Mitigation

### Risk 1: GitHub API Rate Limiting
**Impact:** Examples may fail if run repeatedly without auth

**Mitigation:**
- GitHub allows 60 unauthenticated requests/hour per IP
- Examples use GET only (read operations)
- Add rate limit handling in docs:
  ```go
  // Note: GitHub allows 60 requests/hour without auth
  // For higher limits, add GITHUB_TOKEN:
  // headers["Authorization"] = "token YOUR_TOKEN"
  ```

### Risk 2: Repository Changes
**Impact:** PR #1 might be closed/deleted

**Mitigation:**
- Use repository-level endpoints (always available)
- Fallback to commits/README if PR not found
- Document which PR number to use

### Risk 3: Network Dependency
**Impact:** Examples require internet to run

**Mitigation:**
- This is already true for Stigmer workflows
- E2E tests inherently require network
- Add offline note in docs

---

## Recommendation

### ✅ **Proceed with Migration**

**Scope:** Migrate 5 high-priority examples (07, 08, 09, 10, 11)

**Timeline:** 2-3 days

**Effort:** Low (simple URL replacements + header updates)

**Value:** High (realistic examples, E2E tests, professional quality)

### Next Steps

1. Create PR with updated examples
2. Test each example manually
3. Update documentation
4. Add E2E test suite
5. Announce updated examples to users

---

## Appendix: Example Migration Diff

### Before (07_basic_workflow.go)

```go
apiBase := ctx.SetString("apiBase", "https://jsonplaceholder.typicode.com")

fetchTask := wf.HttpGet("fetchData", 
    workflow.Interpolate(apiBase, "/posts/1"),
    map[string]string{
        "Content-Type": "application/json",
    })

processTask := wf.Set("processResponse", &workflow.SetArgs{
    Variables: map[string]string{
        "postTitle": fetchTask.Field("title").Expression(),
        "postBody":  fetchTask.Field("body").Expression(),
        "status":    "success",
    },
})
```

### After (Migrated to GitHub)

```go
apiBase := ctx.SetString("apiBase", "https://api.github.com")

// Fetch PR from public hello-stigmer repository
fetchTask := wf.HttpGet("fetchPullRequest", 
    workflow.Interpolate(apiBase, "/repos/stigmer/hello-stigmer/pulls/1"),
    map[string]string{
        "Accept":     "application/vnd.github.v3+json",
        "User-Agent": "Stigmer-SDK-Example",
    })

processTask := wf.Set("processResponse", &workflow.SetArgs{
    Variables: map[string]string{
        "prTitle":  fetchTask.Field("title").Expression(),      // PR title
        "prBody":   fetchTask.Field("body").Expression(),       // PR description
        "prState":  fetchTask.Field("state").Expression(),      // open/closed
        "prAuthor": fetchTask.Field("user.login").Expression(), // GitHub username
        "status":   "success",
    },
})
```

**Changes:**
1. ✅ Real GitHub API endpoint
2. ✅ Proper GitHub headers (Accept, User-Agent)
3. ✅ Richer response schema (state, author, etc.)
4. ✅ Works as E2E test
5. ✅ Professional, copy-paste ready code

---

**End of Analysis**
