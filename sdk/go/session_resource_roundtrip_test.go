package stigmer

// Wire coverage for a conversation's resources: each SessionResource carries
// exactly one of a File, a git repository or a local folder in a oneof, and a
// generated toProto that dropped the arm would have every session refused
// server-side with "exactly one field is required in oneof" (the shape of
// issue #254, which bit the workspace source this list replaced).
//
// These tests exercise the checked-in generated code against the real proto
// stubs, the layer where that bug bit. The SDK's toProto() is unexported, so
// the forward direction is driven through the public Session and Run Create
// calls against an in-memory gRPC server that captures the exact wire
// message the server would validate. The reverse direction uses the exported
// *InputFromProto constructors.
//
// This file is intentionally at the SDK root (package stigmer): the generated
// package internal/gen is wiped and regenerated wholesale (`rm -rf
// internal/gen` in sdk/go/Makefile), so hand-written tests must not live there.

import (
	"context"
	"net"
	"testing"

	runv1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/run/v1"
	sessionv1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/session/v1"
	"go.stigmer.ai/sdk/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
	"google.golang.org/grpc/test/bufconn"
)

const (
	resRepoURL   = "https://github.com/acme/project.git"
	resBranch    = "main"
	resCommit    = "abc123def456"
	resLocalPath = "/abs/path/to/project"
	resFileID    = "file_01"
	resMountPath = "q3/ledger.xlsx"
)

// captureState records the last Create request seen by the fake command
// controllers. A single instance is shared across both controller shims.
type captureState struct {
	lastSession *sessionv1.Session
	lastRun     *runv1.Run
}

// The session and run command controllers each require a method named Create
// with a different signature, so they cannot be satisfied by one Go type. Two
// thin shims share the same captureState.

type sessionCaptureServer struct {
	sessionv1.UnimplementedSessionCommandControllerServer
	state *captureState
}

func (s *sessionCaptureServer) Create(_ context.Context, req *sessionv1.Session) (*sessionv1.Session, error) {
	s.state.lastSession = req
	return req, nil
}

type runSourceCaptureServer struct {
	runv1.UnimplementedRunCommandControllerServer
	state *captureState
}

func (s *runSourceCaptureServer) Create(_ context.Context, req *runv1.Run) (*runv1.Run, error) {
	s.state.lastRun = req
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
	runv1.RegisterRunCommandControllerServer(srv, &runSourceCaptureServer{state: state})

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

func gitRepositoryResource() *SessionResourceInput {
	return &SessionResourceInput{
		Name: "repo",
		GitRepository: &GitRepositoryResourceInput{
			Url:    resRepoURL,
			Branch: resBranch,
			Commit: resCommit,
		},
	}
}

func localPathResource() *SessionResourceInput {
	return &SessionResourceInput{
		Name:      "project",
		LocalPath: &LocalPathResourceInput{Path: resLocalPath},
	}
}

func fileResource() *SessionResourceInput {
	return &SessionResourceInput{
		File: &FileResourceInput{FileId: resFileID, MountPath: resMountPath},
	}
}

// onlyResource fails unless the wire list holds exactly one resource, and
// returns it.
func onlyResource(t *testing.T, resources []*sessionv1.SessionResource) *sessionv1.SessionResource {
	t.Helper()
	if len(resources) != 1 {
		t.Fatalf("resources = %d, want 1", len(resources))
	}
	return resources[0]
}

// assertGitRepositoryWire fails unless the wire resource carries the
// git_repository arm of the oneof with its fields intact.
func assertGitRepositoryWire(t *testing.T, r *sessionv1.SessionResource) {
	t.Helper()
	gr := r.GetGitRepository()
	if gr == nil {
		t.Fatal("git_repository oneof arm dropped on the wire")
	}
	if r.GetName() != "repo" {
		t.Errorf("name = %q, want %q", r.GetName(), "repo")
	}
	if gr.GetUrl() != resRepoURL || gr.GetBranch() != resBranch || gr.GetCommit() != resCommit {
		t.Errorf("git_repository fields mismatch: %v", gr)
	}
}

// assertLocalPathWire fails unless the wire resource carries the local_path
// arm of the oneof with its path intact.
func assertLocalPathWire(t *testing.T, r *sessionv1.SessionResource) {
	t.Helper()
	lp := r.GetLocalPath()
	if lp == nil {
		t.Fatal("local_path oneof arm dropped on the wire")
	}
	if lp.GetPath() != resLocalPath {
		t.Errorf("path = %q, want %q", lp.GetPath(), resLocalPath)
	}
}

// assertFileWire fails unless the wire resource carries the file arm of the
// oneof with no name, since a File is placed by its mount path.
func assertFileWire(t *testing.T, r *sessionv1.SessionResource) {
	t.Helper()
	f := r.GetFile()
	if f == nil {
		t.Fatal("file oneof arm dropped on the wire")
	}
	if r.GetName() != "" {
		t.Errorf("name = %q, want empty for a file", r.GetName())
	}
	if f.GetFileId() != resFileID || f.GetMountPath() != resMountPath {
		t.Errorf("file fields mismatch: %v", f)
	}
}

func TestSessionResourceOneof_SessionCreate(t *testing.T) {
	cases := []struct {
		name     string
		resource *SessionResourceInput
		assert   func(*testing.T, *sessionv1.SessionResource)
	}{
		{"git_repository", gitRepositoryResource(), assertGitRepositoryWire},
		{"local_path", localPathResource(), assertLocalPathWire},
		{"file", fileResource(), assertFileWire},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client, state := newCaptureClient(t)
			if _, err := client.Session.Create(context.Background(), &SessionInput{
				Org:       "acme",
				AgentRef:  ResourceRef{Org: "acme", Slug: "reviewer"},
				Resources: []*SessionResourceInput{tc.resource},
			}); err != nil {
				t.Fatalf("Session.Create: %v", err)
			}
			tc.assert(t, onlyResource(t, state.lastSession.GetSpec().GetResources()))
		})
	}
}

func TestSessionResourceOneof_RunSessionSpec(t *testing.T) {
	t.Run("git_repository", func(t *testing.T) {
		client, state := newCaptureClient(t)
		if _, err := client.Run.Create(context.Background(), &RunInput{
			Org:     "acme",
			Message: "hello",
			SessionSpec: &SessionSpecInput{
				AgentRef:  ResourceRef{Org: "acme", Slug: "reviewer"},
				Resources: []*SessionResourceInput{gitRepositoryResource()},
			},
		}); err != nil {
			t.Fatalf("Run.Create: %v", err)
		}
		sessionSpec := state.lastRun.GetSpec().GetSessionSpec()
		// The new conversation names its agent by reference, stamped with
		// the agent kind, alongside its resources.
		ref := sessionSpec.GetAgentRef()
		if ref.GetKind() != apiresourcekind.ApiResourceKind_agent || ref.GetOrg() != "acme" || ref.GetSlug() != "reviewer" {
			t.Errorf("agent_ref = %v, want agent acme/reviewer", ref)
		}
		assertGitRepositoryWire(t, onlyResource(t, sessionSpec.GetResources()))
	})

	t.Run("file_with_message_files", func(t *testing.T) {
		client, state := newCaptureClient(t)
		if _, err := client.Run.Create(context.Background(), &RunInput{
			Org:         "acme",
			Message:     "hello",
			FileIds:     []string{"file_02"},
			SessionSpec: &SessionSpecInput{Resources: []*SessionResourceInput{fileResource()}},
		}); err != nil {
			t.Fatalf("Run.Create: %v", err)
		}
		spec := state.lastRun.GetSpec()
		assertFileWire(t, onlyResource(t, spec.GetSessionSpec().GetResources()))
		if got := spec.GetFileIds(); len(got) != 1 || got[0] != "file_02" {
			t.Errorf("file_ids = %v, want [file_02]", got)
		}
	})
}

// TestSessionResourceOneof_FromProto guards the reverse direction: a wire
// proto carrying each oneof arm must round-trip back into the SDK input type.
func TestSessionResourceOneof_FromProto(t *testing.T) {
	proto := &sessionv1.Session{
		Spec: &sessionv1.SessionSpec{
			Resources: []*sessionv1.SessionResource{
				{Name: "repo", Resource: &sessionv1.SessionResource_GitRepository{GitRepository: &sessionv1.GitRepositoryResource{
					Url: resRepoURL, Branch: resBranch, Commit: resCommit,
				}}},
				{Name: "project", Resource: &sessionv1.SessionResource_LocalPath{LocalPath: &sessionv1.LocalPathResource{Path: resLocalPath}}},
				{Resource: &sessionv1.SessionResource_File{File: &sessionv1.FileResource{FileId: resFileID, MountPath: resMountPath}}},
			},
		},
	}
	input := SessionInputFromProto(proto)
	if len(input.Resources) != 3 {
		t.Fatalf("resources = %d, want 3", len(input.Resources))
	}

	repo := input.Resources[0]
	if repo.GitRepository == nil || repo.LocalPath != nil || repo.File != nil {
		t.Fatalf("resource 0 arms = %+v, want git_repository only", repo)
	}
	if repo.Name != "repo" || repo.GitRepository.Url != resRepoURL || repo.GitRepository.Branch != resBranch || repo.GitRepository.Commit != resCommit {
		t.Errorf("git_repository mismatch: %+v", repo.GitRepository)
	}

	folder := input.Resources[1]
	if folder.LocalPath == nil || folder.GitRepository != nil || folder.File != nil {
		t.Fatalf("resource 1 arms = %+v, want local_path only", folder)
	}
	if folder.LocalPath.Path != resLocalPath {
		t.Errorf("path = %q, want %q", folder.LocalPath.Path, resLocalPath)
	}

	file := input.Resources[2]
	if file.File == nil || file.GitRepository != nil || file.LocalPath != nil {
		t.Fatalf("resource 2 arms = %+v, want file only", file)
	}
	if file.File.FileId != resFileID || file.File.MountPath != resMountPath {
		t.Errorf("file mismatch: %+v", file.File)
	}
}
