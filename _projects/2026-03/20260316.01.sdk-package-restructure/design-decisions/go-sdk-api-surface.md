# Go SDK API Surface Design

This document defines the target public API for the restructured Go SDK.
Every operation across all 5 resources is shown as example Go code.

## Package and Import

```go
import stigmer "github.com/stigmer/stigmer/sdk/go"
```

All public types live in a single package: `stigmer`.
Proto response types are accessed via their generated packages (e.g., `agentv1`, `sessionv1`).

## Client Construction

```go
// Minimal — API key + default endpoint
client, err := stigmer.NewClient("sk_live_abc123")

// Full configuration
client, err := stigmer.NewClient("sk_live_abc123",
    stigmer.WithBaseURL("https://api.stigmer.ai:443"),
    stigmer.WithInsecure(),                          // disable TLS (local dev)
    stigmer.WithDialOptions(grpc.WithBlock()),       // pass-through gRPC dial options
)
defer client.Close()
```

---

## 1. Agents

### Get

```go
agent, err := client.Agents.Get(ctx, "agent-id")
// agent is *agentv1.Agent
fmt.Println(agent.GetMetadata().GetName())
fmt.Println(agent.GetSpec().GetInstructions())
```

### Get by Reference

```go
agent, err := client.Agents.GetByReference(ctx, &stigmer.ResourceRef{
    Org:  "acme",
    Slug: "code-reviewer",
})
```

### Create

```go
agent, err := client.Agents.Create(ctx, &stigmer.CreateAgentInput{
    Name:         "code-reviewer",
    Org:          "acme",
    Description:  "Reviews pull requests for code quality",
    Instructions: "You are a senior code reviewer. Analyze code for bugs, style issues, and performance.",
    IconURL:      "https://example.com/icons/reviewer.png",
    McpServerUsages: []stigmer.McpServerUsageInput{
        {
            McpServerRef: stigmer.ResourceRef{Org: "acme", Slug: "github"},
            EnabledTools: []string{"create_pull_request_review", "get_file_contents"},
        },
    },
    SkillRefs: []stigmer.ResourceRef{
        {Org: "acme", Slug: "code-analysis"},
        {Org: "acme", Slug: "security-scan", Version: "v2.0"},
    },
    SubAgents: []stigmer.SubAgentInput{
        {
            Name:         "security-checker",
            Instructions: "Focus on identifying security vulnerabilities in the code.",
            McpAccess: []stigmer.McpAccessInput{
                {McpServer: "github", EnabledTools: []string{"get_file_contents"}},
            },
        },
    },
    EnvSpec: &stigmer.EnvSpecInput{
        Variables: map[string]stigmer.EnvVarInput{
            "GITHUB_TOKEN":  {Description: "GitHub API token", IsSecret: true},
            "REVIEW_DEPTH":  {Value: "thorough", Description: "Review depth level"},
        },
    },
})
```

### Update

```go
agent, err := client.Agents.Update(ctx, &stigmer.UpdateAgentInput{
    ID:           "agent-id",
    Name:         "code-reviewer",
    Org:          "acme",
    Instructions: "Updated instructions with more detail...",
})
```

### Apply (create-or-update)

```go
agent, err := client.Agents.Apply(ctx, &stigmer.CreateAgentInput{
    Name:         "code-reviewer",
    Org:          "acme",
    Instructions: "You are a senior code reviewer...",
})
```

### Delete

```go
agent, err := client.Agents.Delete(ctx, "agent-id")
```

### List (via SearchService)

```go
result, err := client.Agents.List(ctx, &stigmer.ListAgentsParams{
    Org:   "acme",
    Query: "reviewer",            // optional full-text search
    Page:  &stigmer.Page{Num: 1, Size: 20},
})
// result is *stigmer.ListResult[searchv1.SearchResult]
for _, entry := range result.Entries {
    fmt.Printf("%s (%s)\n", entry.GetName(), entry.GetQualifiedSlug())
}
fmt.Printf("Total: %d, Pages: %d\n", result.TotalCount, result.TotalPages)
```

---

## 2. Skills

### Get

```go
skill, err := client.Skills.Get(ctx, "skill-id")
// skill is *skillv1.Skill
```

### Get by Reference

```go
skill, err := client.Skills.GetByReference(ctx, &stigmer.ResourceRef{
    Org:     "acme",
    Slug:    "code-analysis",
    Version: "v1.0",
})
```

### Push (create or update a skill version)

```go
artifactBytes, _ := os.ReadFile("skill-bundle.tar.gz")

skill, err := client.Skills.Push(ctx, &stigmer.PushSkillInput{
    Org:      "acme",
    Artifact: artifactBytes,
    Tag:      "v1.2.0",
    GitProvenance: &stigmer.GitProvenanceInput{
        RemoteURL: "https://github.com/acme/skills",
        Ref:       "refs/tags/v1.2.0",
        Commit:    "abc123def456",
        Subdir:    "skills/code-analysis",
    },
})
```

### Get Artifact

```go
resp, err := client.Skills.GetArtifact(ctx, "artifact-storage-key")
// resp.Artifact is []byte
```

### Delete

```go
skill, err := client.Skills.Delete(ctx, "skill-id")
```

### List (via SearchService)

```go
result, err := client.Skills.List(ctx, &stigmer.ListSkillsParams{
    Org:  "acme",
    Page: &stigmer.Page{Num: 1, Size: 50},
})
```

---

## 3. MCP Servers

### Get

```go
server, err := client.McpServers.Get(ctx, "mcpserver-id")
// server is *mcpserverv1.McpServer
```

### Get by Reference

```go
server, err := client.McpServers.GetByReference(ctx, &stigmer.ResourceRef{
    Org:  "acme",
    Slug: "github",
})
```

### Create (Stdio)

```go
server, err := client.McpServers.Create(ctx, &stigmer.CreateMcpServerInput{
    Name:        "github",
    Org:         "acme",
    Description: "GitHub MCP server for repository operations",
    Tags:        []string{"vcs", "github"},
    Stdio: &stigmer.StdioServerInput{
        Command:    "npx",
        Args:       []string{"-y", "@modelcontextprotocol/server-github"},
        WorkingDir: "/workspace",
    },
    DefaultEnabledTools: []string{"create_pull_request", "get_file_contents"},
    EnvSpec: &stigmer.EnvSpecInput{
        Variables: map[string]stigmer.EnvVarInput{
            "GITHUB_TOKEN": {Description: "GitHub personal access token", IsSecret: true},
        },
    },
    DefaultToolApprovals: []stigmer.ToolApprovalInput{
        {ToolName: "create_pull_request", Message: "About to create a PR"},
    },
})
```

### Create (HTTP/SSE)

```go
server, err := client.McpServers.Create(ctx, &stigmer.CreateMcpServerInput{
    Name:        "custom-api",
    Org:         "acme",
    Description: "Custom API server via HTTP",
    HTTP: &stigmer.HTTPServerInput{
        URL:            "https://mcp.example.com/sse",
        Headers:        map[string]string{"X-Api-Key": "${API_KEY}"},
        TimeoutSeconds: 30,
    },
})
```

### Update

```go
server, err := client.McpServers.Update(ctx, &stigmer.UpdateMcpServerInput{
    ID:          "mcpserver-id",
    Name:        "github",
    Org:         "acme",
    Description: "Updated description",
})
```

### Apply

```go
server, err := client.McpServers.Apply(ctx, &stigmer.CreateMcpServerInput{
    Name: "github",
    Org:  "acme",
    // ...
})
```

### Delete

```go
server, err := client.McpServers.Delete(ctx, &stigmer.DeleteResourceInput{
    ResourceID:     "mcpserver-id",
    VersionMessage: "No longer needed",
    Force:          false,
})
```

### List (via SearchService)

```go
result, err := client.McpServers.List(ctx, &stigmer.ListMcpServersParams{
    Org: "acme",
})
```

---

## 4. Sessions

### Get

```go
session, err := client.Sessions.Get(ctx, "session-id")
// session is *sessionv1.Session
```

### Create

```go
session, err := client.Sessions.Create(ctx, &stigmer.CreateSessionInput{
    AgentInstanceID: "agent-instance-id",
    Subject:         "PR Review: feat/new-auth",
    Metadata: map[string]string{
        "pr_number": "142",
        "repo":      "acme/backend",
    },
    WorkspaceEntries: []stigmer.WorkspaceEntryInput{
        {
            Name: "repo",
            GitRepo: &stigmer.GitRepoInput{
                URL:    "https://github.com/acme/backend",
                Branch: "feat/new-auth",
            },
        },
    },
})
```

### Update

```go
session, err := client.Sessions.Update(ctx, &stigmer.UpdateSessionInput{
    ID:      "session-id",
    Subject: "Updated subject line",
})
```

### Apply

```go
session, err := client.Sessions.Apply(ctx, &stigmer.CreateSessionInput{
    AgentInstanceID: "agent-instance-id",
    Subject:         "PR Review: feat/new-auth",
})
```

### Delete

```go
session, err := client.Sessions.Delete(ctx, "session-id")
```

### List (native RPC)

```go
result, err := client.Sessions.List(ctx, &stigmer.ListSessionsParams{
    PageSize:  20,
    PageToken: "",       // empty for first page
    Tags:      []string{"pr-review"},
})
// result is *stigmer.PageResult[*sessionv1.Session]
for _, s := range result.Entries {
    fmt.Println(s.GetSpec().GetSubject())
}
```

### List by Agent

```go
result, err := client.Sessions.ListByAgent(ctx, &stigmer.ListSessionsByAgentParams{
    AgentID:  "agent-id",
    PageSize: 20,
})
```

---

## 5. Executions (AgentExecution)

### Get

```go
exec, err := client.Executions.Get(ctx, "execution-id")
// exec is *agentexecutionv1.AgentExecution
fmt.Println(exec.GetStatus().GetPhase())
```

### Create

```go
exec, err := client.Executions.Create(ctx, &stigmer.CreateExecutionInput{
    SessionID: "session-id",
    AgentID:   "agent-id",
    Message:   "Review the latest changes in the auth module",
    Config: &stigmer.ExecutionConfigInput{
        ModelName:          "claude-sonnet-4-20250514",
        MaxToolRounds:      25,
        MaxToolResultChars: 16000,
        MaxCostUSD:         1.50,
    },
    AutoApproveAll: false,
    Attachments: []stigmer.AttachmentInput{
        {
            Filename:    "context.md",
            StorageKey:  "uploads/abc123",
            ContentType: "text/markdown",
        },
    },
})
```

### Subscribe (streaming)

```go
stream, err := client.Executions.Subscribe(ctx, "execution-id")
if err != nil {
    log.Fatal(err)
}

for {
    exec, err := stream.Recv()
    if err == io.EOF {
        break
    }
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Phase: %s, Messages: %d\n",
        exec.GetStatus().GetPhase(),
        len(exec.GetStatus().GetMessages()),
    )
}
```

### Submit Approval

```go
exec, err := client.Executions.SubmitApproval(ctx, &stigmer.SubmitApprovalInput{
    ExecutionID: "execution-id",
    ToolCallID:  "tool-call-id",
    Action:      stigmer.ApprovalActionApprove,
    Comment:     "Looks good, proceed",
})
```

### Cancel

```go
exec, err := client.Executions.Cancel(ctx, &stigmer.CancelExecutionInput{
    ID:     "execution-id",
    Reason: "No longer needed",
})
```

### Terminate

```go
exec, err := client.Executions.Terminate(ctx, &stigmer.TerminateExecutionInput{
    ID:     "execution-id",
    Reason: "Runaway execution",
})
```

### Pause

```go
exec, err := client.Executions.Pause(ctx, &stigmer.PauseExecutionInput{
    ID:     "execution-id",
    Reason: "Waiting for manual input",
})
```

### Resume

```go
exec, err := client.Executions.Resume(ctx, "execution-id")
```

### Recover

```go
exec, err := client.Executions.Recover(ctx, "execution-id")
```

### Delete

```go
exec, err := client.Executions.Delete(ctx, "execution-id")
```

### List (native RPC)

```go
result, err := client.Executions.List(ctx, &stigmer.ListExecutionsParams{
    PageSize: 20,
    Phase:    stigmer.ExecutionPhaseCompleted,
    Tags:     []string{"pr-review"},
})
```

### List by Session

```go
result, err := client.Executions.ListBySession(ctx, &stigmer.ListExecutionsBySessionParams{
    SessionID: "session-id",
    PageSize:  20,
})
```

### Upload Attachment

```go
resp, err := client.Executions.UploadAttachment(ctx, &stigmer.UploadAttachmentInput{
    Filename:    "document.pdf",
    Content:     fileBytes,
    ContentType: "application/pdf",
})
// resp.StorageKey can be used in CreateExecutionInput.Attachments
```

### Get Artifact Download URL

```go
resp, err := client.Executions.GetArtifactDownloadURL(ctx, &stigmer.GetArtifactURLInput{
    ExecutionID: "execution-id",
    StorageKey:  "artifacts/output.zip",
})
fmt.Println(resp.DownloadURL, resp.ExpiresAt)
```

### Usage Reports

```go
// Session usage
report, err := client.Executions.GetSessionUsageReport(ctx, "session-id")

// Agent usage (paginated)
report, err := client.Executions.GetAgentUsageReport(ctx, &stigmer.AgentUsageReportInput{
    AgentID:  "agent-id",
    FromDate: "2026-01-01",
    ToDate:   "2026-03-16",
})

// Org usage
report, err := client.Executions.GetOrgUsageReport(ctx, &stigmer.OrgUsageReportInput{
    OrgID:    "org-id",
    FromDate: "2026-01-01",
    ToDate:   "2026-03-16",
})
```

---

## 6. Search (Cross-Resource Discovery)

```go
result, err := client.Search.Query(ctx, &stigmer.SearchParams{
    Kinds:         []stigmer.ResourceKind{stigmer.KindAgent, stigmer.KindSkill},
    Query:         "code review",
    Org:           "acme",
    ExcludePublic: false,
    Page:          &stigmer.Page{Num: 1, Size: 20},
})
// result is *stigmer.SearchResult
for _, entry := range result.Entries {
    fmt.Printf("[%s] %s — %s (score: %.2f)\n",
        entry.GetKind(), entry.GetName(), entry.GetDescription(), entry.GetScore(),
    )
}
fmt.Printf("Counts: %v\n", result.CountsByKind)
```

---

## Error Handling

```go
agent, err := client.Agents.Get(ctx, "nonexistent-id")
if err != nil {
    var sErr *stigmer.Error
    if errors.As(err, &sErr) {
        switch sErr.Code {
        case stigmer.CodeNotFound:
            fmt.Println("Agent not found")
        case stigmer.CodePermissionDenied:
            fmt.Println("Access denied")
        case stigmer.CodeUnauthenticated:
            fmt.Println("Invalid API key")
        case stigmer.CodeInvalidArgument:
            fmt.Println("Bad request:", sErr.Message)
        default:
            fmt.Println("Error:", sErr.Message)
        }
    }
}
```

---

## Shared Input Types

```go
// ResourceRef identifies a resource by org, slug, and optional version.
type ResourceRef struct {
    Org     string
    Slug    string
    Version string // optional
}

// Page specifies offset-based pagination (for SearchService).
type Page struct {
    Num  int32 // 1-based page number
    Size int32 // items per page
}

// ListResult is returned by SearchService-backed List methods.
type ListResult struct {
    Entries    []*searchv1.SearchResult
    TotalCount int32
    TotalPages int32
}

// PageResult is returned by native List RPCs (cursor-based).
type PageResult[T any] struct {
    Entries    []T
    TotalPages int32
}

// Error wraps gRPC status codes into SDK-level errors.
type Error struct {
    Code    ErrorCode
    Message string
    Details []any
}

// ErrorCode constants map to gRPC status codes.
type ErrorCode int
const (
    CodeNotFound         ErrorCode = iota
    CodePermissionDenied
    CodeUnauthenticated
    CodeInvalidArgument
    CodeAlreadyExists
    CodeResourceExhausted
    CodeInternal
    CodeUnavailable
)
```
