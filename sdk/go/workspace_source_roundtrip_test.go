package stigmer

// Regression coverage for issue #254: the Go SDK's generated
// WorkspaceSourceInput.toProto() dropped the git_repo/local_path oneof, so
// every session created with a workspace was rejected server-side with
// "exactly one field is required in oneof".
//
// These tests exercise the *checked-in generated code* against the real proto
// stubs — the layer where the bug actually bit. The SDK's toProto() is
// unexported, so the forward direction is driven through the public
// Session/AgentExecution Create calls against an in-memory gRPC server that
// captures the exact wire message the server would validate. The reverse
// direction uses the exported *InputFromProto constructors.
//
// This file is intentionally at the SDK root (package stigmer): the generated
// package internal/gen is wiped and regenerated wholesale (`rm -rf internal/gen`
// in sdk/go/Makefile), so hand-written tests must not live there.

import (
	"context"
	"net"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/session/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/test/bufconn"
)

const (
	wsRepoURL   = "https://github.com/acme/project.git"
	wsBranch    = "main"
	wsCommit    = "abc123def456"
	wsDepth     = int32(1)
	wsLocalPath = "/abs/path/to/project"
)

// captureState records the last Create request seen by the fake command
// controllers. A single instance is shared across both controller shims.
type captureState struct {
	lastSession        *sessionv1.Session
	lastAgentExecution *agentexecutionv1.AgentExecution
}

// The session and agent-execution command controllers each require a method
// named Create with a different signature, so they cannot be satisfied by one
// Go type. Two thin shims share the same captureState.

type sessionCaptureServer struct {
	sessionv1.UnimplementedSessionCommandControllerServer
	state *captureState
}

func (s *sessionCaptureServer) Create(_ context.Context, req *sessionv1.Session) (*sessionv1.Session, error) {
	s.state.lastSession = req
	return req, nil
}

type agentExecutionCaptureServer struct {
	agentexecutionv1.UnimplementedAgentExecutionCommandControllerServer
	state *captureState
}

func (s *agentExecutionCaptureServer) Create(_ context.Context, req *agentexecutionv1.AgentExecution) (*agentexecutionv1.AgentExecution, error) {
	s.state.lastAgentExecution = req
	return req, nil
}

// newCaptureClient stands up an in-memory gRPC server wired to the capture
// shims and returns a Client that talks to it over a bufconn dialer. The
// passthrough target skips DNS resolution so the context dialer is used
// verbatim.
func newCaptureClient(t *testing.T) (*Client, *captureState) {
	t.Helper()

	state := &captureState{}
	lis := bufconn.Listen(1024 * 1024)
	srv := grpc.NewServer()
	sessionv1.RegisterSessionCommandControllerServer(srv, &sessionCaptureServer{state: state})
	agentexecutionv1.RegisterAgentExecutionCommandControllerServer(srv, &agentExecutionCaptureServer{state: state})

	go func() { _ = srv.Serve(lis) }()

	client, err := NewClient(
		WithBaseURL("passthrough:///bufnet"),
		WithInsecure(),
		WithDialOptions(grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return lis.DialContext(ctx)
		})),
	)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	t.Cleanup(func() {
		_ = client.Close()
		srv.Stop()
		_ = lis.Close()
	})

	return client, state
}

func gitRepoEntry() *WorkspaceEntryInput {
	return &WorkspaceEntryInput{
		Name: "repo",
		Source: &WorkspaceSourceInput{
			GitRepo: &GitRepoSourceInput{
				Url:    wsRepoURL,
				Branch: wsBranch,
				Commit: wsCommit,
				Depth:  wsDepth,
			},
		},
	}
}

func localPathEntry() *WorkspaceEntryInput {
	return &WorkspaceEntryInput{
		Name:   "project",
		Source: &WorkspaceSourceInput{LocalPath: &LocalPathSourceInput{Path: wsLocalPath}},
	}
}

// assertGitRepoWire fails unless the wire WorkspaceSource carries the git_repo
// arm of the oneof with its fields intact. A nil GetGitRepo() is the exact
// #254 regression.
func assertGitRepoWire(t *testing.T, ws *sessionv1.WorkspaceSource) {
	t.Helper()
	if ws == nil {
		t.Fatal("workspace source is nil on the wire")
	}
	gr := ws.GetGitRepo()
	if gr == nil {
		t.Fatal("git_repo oneof arm dropped on the wire (regression #254)")
	}
	if ws.GetLocalPath() != nil {
		t.Error("local_path arm set alongside git_repo — oneof violated")
	}
	if gr.GetUrl() != wsRepoURL {
		t.Errorf("url = %q, want %q", gr.GetUrl(), wsRepoURL)
	}
	if gr.GetBranch() != wsBranch {
		t.Errorf("branch = %q, want %q", gr.GetBranch(), wsBranch)
	}
	if gr.GetCommit() != wsCommit {
		t.Errorf("commit = %q, want %q", gr.GetCommit(), wsCommit)
	}
	if gr.Depth == nil {
		t.Error("depth presence lost on the wire (proto3 optional)")
	} else if gr.GetDepth() != wsDepth {
		t.Errorf("depth = %d, want %d", gr.GetDepth(), wsDepth)
	}
}

// assertLocalPathWire fails unless the wire WorkspaceSource carries the
// local_path arm of the oneof with its path intact.
func assertLocalPathWire(t *testing.T, ws *sessionv1.WorkspaceSource) {
	t.Helper()
	if ws == nil {
		t.Fatal("workspace source is nil on the wire")
	}
	lp := ws.GetLocalPath()
	if lp == nil {
		t.Fatal("local_path oneof arm dropped on the wire (regression #254)")
	}
	if ws.GetGitRepo() != nil {
		t.Error("git_repo arm set alongside local_path — oneof violated")
	}
	if lp.GetPath() != wsLocalPath {
		t.Errorf("path = %q, want %q", lp.GetPath(), wsLocalPath)
	}
}

func TestWorkspaceSourceOneof_SessionCreate(t *testing.T) {
	t.Run("git_repo", func(t *testing.T) {
		client, state := newCaptureClient(t)
		if _, err := client.Session.Create(context.Background(), &SessionInput{
			Org:              "acme",
			AgentInstanceId:  "agent-instance-1",
			WorkspaceEntries: []*WorkspaceEntryInput{gitRepoEntry()},
		}); err != nil {
			t.Fatalf("Session.Create: %v", err)
		}
		entries := state.lastSession.GetSpec().GetWorkspaceEntries()
		if len(entries) != 1 {
			t.Fatalf("workspace entries = %d, want 1", len(entries))
		}
		if entries[0].GetName() != "repo" {
			t.Errorf("entry name = %q, want %q", entries[0].GetName(), "repo")
		}
		assertGitRepoWire(t, entries[0].GetSource())
	})

	t.Run("local_path", func(t *testing.T) {
		client, state := newCaptureClient(t)
		if _, err := client.Session.Create(context.Background(), &SessionInput{
			Org:              "acme",
			AgentInstanceId:  "agent-instance-1",
			WorkspaceEntries: []*WorkspaceEntryInput{localPathEntry()},
		}); err != nil {
			t.Fatalf("Session.Create: %v", err)
		}
		entries := state.lastSession.GetSpec().GetWorkspaceEntries()
		if len(entries) != 1 {
			t.Fatalf("workspace entries = %d, want 1", len(entries))
		}
		assertLocalPathWire(t, entries[0].GetSource())
	})

	t.Run("git_repo_zero_depth_stays_unset", func(t *testing.T) {
		client, state := newCaptureClient(t)
		entry := gitRepoEntry()
		entry.Source.GitRepo.Depth = 0
		if _, err := client.Session.Create(context.Background(), &SessionInput{
			Org:              "acme",
			AgentInstanceId:  "agent-instance-1",
			WorkspaceEntries: []*WorkspaceEntryInput{entry},
		}); err != nil {
			t.Fatalf("Session.Create: %v", err)
		}
		gr := state.lastSession.GetSpec().GetWorkspaceEntries()[0].GetSource().GetGitRepo()
		if gr == nil {
			t.Fatal("git_repo oneof arm dropped on the wire (regression #254)")
		}
		if gr.Depth != nil {
			t.Errorf("depth = %d, want unset (nil) for zero value", gr.GetDepth())
		}
	})
}

func TestWorkspaceSourceOneof_AgentExecutionSessionSpec(t *testing.T) {
	t.Run("git_repo", func(t *testing.T) {
		client, state := newCaptureClient(t)
		if _, err := client.AgentExecution.Create(context.Background(), &AgentExecutionInput{
			Org:     "acme",
			Message: "hello",
			SessionSpec: &SessionSpecInput{
				AgentInstanceId:  "agent-instance-1",
				WorkspaceEntries: []*WorkspaceEntryInput{gitRepoEntry()},
			},
		}); err != nil {
			t.Fatalf("AgentExecution.Create: %v", err)
		}
		entries := state.lastAgentExecution.GetSpec().GetSessionSpec().GetWorkspaceEntries()
		if len(entries) != 1 {
			t.Fatalf("workspace entries = %d, want 1", len(entries))
		}
		assertGitRepoWire(t, entries[0].GetSource())
	})

	t.Run("local_path", func(t *testing.T) {
		client, state := newCaptureClient(t)
		if _, err := client.AgentExecution.Create(context.Background(), &AgentExecutionInput{
			Org:     "acme",
			Message: "hello",
			SessionSpec: &SessionSpecInput{
				AgentInstanceId:  "agent-instance-1",
				WorkspaceEntries: []*WorkspaceEntryInput{localPathEntry()},
			},
		}); err != nil {
			t.Fatalf("AgentExecution.Create: %v", err)
		}
		entries := state.lastAgentExecution.GetSpec().GetSessionSpec().GetWorkspaceEntries()
		if len(entries) != 1 {
			t.Fatalf("workspace entries = %d, want 1", len(entries))
		}
		assertLocalPathWire(t, entries[0].GetSource())
	})
}

// TestWorkspaceSourceOneof_FromProto guards the reverse direction: a wire
// proto carrying each oneof arm must round-trip back into the SDK input type.
func TestWorkspaceSourceOneof_FromProto(t *testing.T) {
	t.Run("git_repo", func(t *testing.T) {
		depth := wsDepth
		proto := &sessionv1.Session{
			Spec: &sessionv1.SessionSpec{
				WorkspaceEntries: []*sessionv1.WorkspaceEntry{{
					Name: "repo",
					Source: &sessionv1.WorkspaceSource{
						Source: &sessionv1.WorkspaceSource_GitRepo{GitRepo: &sessionv1.GitRepoSource{
							Url:    wsRepoURL,
							Branch: wsBranch,
							Commit: wsCommit,
							Depth:  &depth,
						}},
					},
				}},
			},
		}
		input := SessionInputFromProto(proto)
		if len(input.WorkspaceEntries) != 1 {
			t.Fatalf("workspace entries = %d, want 1", len(input.WorkspaceEntries))
		}
		src := input.WorkspaceEntries[0].Source
		if src == nil || src.GitRepo == nil {
			t.Fatal("git_repo not reconstructed from proto")
		}
		if src.LocalPath != nil {
			t.Error("local_path unexpectedly set")
		}
		if src.GitRepo.Url != wsRepoURL || src.GitRepo.Branch != wsBranch || src.GitRepo.Commit != wsCommit {
			t.Errorf("git_repo fields mismatch: %+v", src.GitRepo)
		}
		if src.GitRepo.Depth != wsDepth {
			t.Errorf("depth = %d, want %d", src.GitRepo.Depth, wsDepth)
		}
	})

	t.Run("local_path", func(t *testing.T) {
		proto := &sessionv1.Session{
			Spec: &sessionv1.SessionSpec{
				WorkspaceEntries: []*sessionv1.WorkspaceEntry{{
					Name: "project",
					Source: &sessionv1.WorkspaceSource{
						Source: &sessionv1.WorkspaceSource_LocalPath{LocalPath: &sessionv1.LocalPathSource{Path: wsLocalPath}},
					},
				}},
			},
		}
		input := SessionInputFromProto(proto)
		if len(input.WorkspaceEntries) != 1 {
			t.Fatalf("workspace entries = %d, want 1", len(input.WorkspaceEntries))
		}
		src := input.WorkspaceEntries[0].Source
		if src == nil || src.LocalPath == nil {
			t.Fatal("local_path not reconstructed from proto")
		}
		if src.GitRepo != nil {
			t.Error("git_repo unexpectedly set")
		}
		if src.LocalPath.Path != wsLocalPath {
			t.Errorf("path = %q, want %q", src.LocalPath.Path, wsLocalPath)
		}
	})
}
