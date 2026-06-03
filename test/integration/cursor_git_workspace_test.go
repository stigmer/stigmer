//go:build integration

package integration

import (
	"context"
	"os/exec"
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A small, stable, public HTTPS repository used to exercise git-repo
// provisioning end-to-end. GitRepoSource.url is constrained to HTTPS by proto
// validation, so a hermetic file:// repo cannot be used here — the hermetic
// clone is covered by the workspace-provision.test.ts unit test instead.
const (
	cursorGitWorkspaceRepoURL = "https://github.com/octocat/Hello-World"
	cursorGitWorkspaceBranch  = "master"
)

// TestCursorHarness_GitRepoWorkspaceClonedLocally verifies that a HARNESS_CURSOR
// session with a git-repo workspace entry actually clones the repository into
// the LOCAL agent's working directory.
//
// Cursor agents run LOCAL (cloud is disabled), so the runner must provision the
// workspace itself. We prove the agent runs inside the real clone by asking it
// to run `git rev-parse HEAD` and asserting the result matches the repository's
// live HEAD (fetched independently via `git ls-remote`). The model cannot
// fabricate the live commit SHA — it can only obtain it by running git inside
// the cloned workspace.
//
// Requires CURSOR_API_KEY and outbound network access to GitHub.
func TestCursorHarness_GitRepoWorkspaceClonedLocally(t *testing.T) {
	requireCursorCallProviderPrereqs(t)

	ctx, cancel := harness.TestContext(t, 5*time.Minute)
	defer cancel()

	// Independently resolve the repository's current HEAD so we can assert the
	// agent reported a value it could only have obtained from the real clone.
	expectedSHA := resolveRemoteHeadSHA(t, ctx, cursorGitWorkspaceRepoURL, cursorGitWorkspaceBranch)
	t.Logf("expected HEAD sha for %s@%s: %s", cursorGitWorkspaceRepoURL, cursorGitWorkspaceBranch, expectedSHA)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients,
		"test-cursor-git-workspace-agent",
		"You are a precise coding assistant operating inside a cloned git repository. "+
			"When asked to run a command, run it in your workspace and report the exact output.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_CURSOR,
		harness.WithWorkspaceEntries([]*sessionv1.WorkspaceEntry{
			{
				Name: "repo",
				Source: &sessionv1.WorkspaceSource{
					Source: &sessionv1.WorkspaceSource_GitRepo{
						GitRepo: &sessionv1.GitRepoSource{
							Url:    cursorGitWorkspaceRepoURL,
							Branch: cursorGitWorkspaceBranch,
						},
					},
				},
			},
		}),
	)

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		session.GetMetadata().GetId(),
		"Run the command `git rev-parse HEAD` in your current working directory. "+
			"Reply with ONLY the resulting 40-character commit SHA and nothing else.",
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
		result, _ = clients.AgentExecutionQuery.Get(ctx,
			&agentexecv1.AgentExecutionId{Value: exec.GetMetadata().GetId()})
	}
	require.NoError(t, err, "execution should reach COMPLETED phase (proves the cursor "+
		"agent ran against the provisioned workspace)")
	require.NotNil(t, result)

	transcript := collectExecutionText(result)
	assert.Contains(t, strings.ToLower(transcript), strings.ToLower(expectedSHA),
		"agent output should contain the cloned repo's live HEAD sha (%s). "+
			"If absent, the git repo was NOT cloned into the local Cursor agent's "+
			"workspace. Transcript:\n%s", expectedSHA, transcript)

	t.Logf("git-repo workspace clone verified: agent reported HEAD %s", expectedSHA)
}

// resolveRemoteHeadSHA returns the current commit SHA for a branch of a remote
// repository using `git ls-remote`. Skips the test if git or the network is
// unavailable.
func resolveRemoteHeadSHA(t *testing.T, ctx context.Context, repoURL, branch string) string {
	t.Helper()

	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not found on PATH — cannot resolve remote HEAD")
	}

	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	out, err := exec.CommandContext(cctx, "git", "ls-remote", repoURL, branch).Output()
	if err != nil {
		t.Skipf("failed to ls-remote %s (network unavailable?): %v", repoURL, err)
	}

	fields := strings.Fields(string(out))
	require.GreaterOrEqual(t, len(fields), 1,
		"git ls-remote returned no ref for %s@%s", repoURL, branch)
	sha := fields[0]
	require.Len(t, sha, 40, "expected a 40-char SHA from ls-remote, got %q", sha)
	return sha
}

// collectExecutionText concatenates assistant message content and tool-call
// results from a completed execution so assertions can scan the full output
// (the SHA may surface in the assistant's reply or in a terminal tool result).
func collectExecutionText(result *agentexecv1.AgentExecution) string {
	var b strings.Builder
	for _, msg := range result.GetStatus().GetMessages() {
		if c := msg.GetContent(); c != "" {
			b.WriteString(c)
			b.WriteString("\n")
		}
		for _, tc := range msg.GetToolCalls() {
			if r := tc.GetResult(); r != "" {
				b.WriteString(r)
				b.WriteString("\n")
			}
		}
	}
	return b.String()
}
