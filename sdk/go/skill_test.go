package stigmer

// Wire-shape tests for SkillClient's push routing (#675): a fake transport
// captures the outgoing protos while an httptest server plays the staging
// endpoint, pinning WHERE the artifact bytes travel for each size class.

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	skillv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/skill/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type fakeSkillPushTransport struct {
	pushIn    *skillv1.PushSkillRequest
	pushOut   *skillv1.Skill
	pushErr   error
	mintIn    *skillv1.CreateSkillArtifactUploadUrlRequest
	mintOut   *skillv1.SkillArtifactUploadUrl
	mintErr   error
	mintCalls int
}

func (f *fakeSkillPushTransport) Push(_ context.Context, in *skillv1.PushSkillRequest) (*skillv1.Skill, error) {
	f.pushIn = in
	return f.pushOut, f.pushErr
}

func (f *fakeSkillPushTransport) CreateArtifactUploadUrl(_ context.Context, in *skillv1.CreateSkillArtifactUploadUrlRequest) (*skillv1.SkillArtifactUploadUrl, error) {
	f.mintIn = in
	f.mintCalls++
	return f.mintOut, f.mintErr
}

// TestSkillPush_SmallArtifactStaysInline pins the unchanged path: an
// artifact under the cap travels inline and no upload URL is minted.
func TestSkillPush_SmallArtifactStaysInline(t *testing.T) {
	fake := &fakeSkillPushTransport{pushOut: &skillv1.Skill{}}
	client := &SkillClient{transport: fake, httpClient: http.DefaultClient}

	artifact := bytes.Repeat([]byte("z"), 1024)
	_, err := client.Push(context.Background(), &skillv1.PushSkillRequest{Org: "org", Artifact: artifact})
	if err != nil {
		t.Fatalf("Push: %v", err)
	}

	if fake.mintCalls != 0 {
		t.Error("small push minted an upload URL")
	}
	if !bytes.Equal(fake.pushIn.GetArtifact(), artifact) {
		t.Error("small push did not carry inline bytes")
	}
	if fake.pushIn.GetArtifactUploadRef() != "" {
		t.Error("small push carried an upload ref")
	}
}

// TestSkillPush_LargeArtifactRoutesViaUploadURL pins the transfer-lane
// path end to end: bytes PUT to the staging URL, the follow-up push
// carries ONLY the reference, and the rest of the request survives the
// rewrite intact.
func TestSkillPush_LargeArtifactRoutesViaUploadURL(t *testing.T) {
	artifact := bytes.Repeat([]byte("z"), maxInlineArtifactBytes+1)

	var putBody []byte
	var putPath string
	staging := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("staging endpoint got %s, want PUT", r.Method)
		}
		putPath = r.URL.Path
		putBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer staging.Close()

	fake := &fakeSkillPushTransport{
		pushOut: &skillv1.Skill{},
		mintOut: &skillv1.SkillArtifactUploadUrl{
			Url:               staging.URL + "/v1/skill-artifacts/uploads/sau_test",
			ArtifactUploadRef: "sau_test",
			TtlSeconds:        900,
		},
	}
	client := &SkillClient{transport: fake, httpClient: staging.Client()}

	_, err := client.Push(context.Background(), &skillv1.PushSkillRequest{
		Org:      "org",
		Artifact: artifact,
		Tag:      "stable",
		Message:  "big drop",
	})
	if err != nil {
		t.Fatalf("Push: %v", err)
	}

	if fake.mintIn.GetSizeBytes() != int64(len(artifact)) {
		t.Errorf("minted size = %d, want %d", fake.mintIn.GetSizeBytes(), len(artifact))
	}
	if fake.mintIn.GetOrg() != "org" {
		t.Errorf("mint org = %q", fake.mintIn.GetOrg())
	}
	if !bytes.Equal(putBody, artifact) {
		t.Error("staged bytes differ from the artifact")
	}
	if putPath != "/v1/skill-artifacts/uploads/sau_test" {
		t.Errorf("PUT path = %q", putPath)
	}

	if len(fake.pushIn.GetArtifact()) != 0 {
		t.Error("by-ref push still carried inline bytes")
	}
	if fake.pushIn.GetArtifactUploadRef() != "sau_test" {
		t.Errorf("push ref = %q, want sau_test", fake.pushIn.GetArtifactUploadRef())
	}
	// The rewrite must not lose the rest of the request.
	if fake.pushIn.GetTag() != "stable" || fake.pushIn.GetMessage() != "big drop" || fake.pushIn.GetOrg() != "org" {
		t.Error("by-ref push dropped request fields in the rewrite")
	}
}

// TestSkillPush_ExplicitRefPassesThrough pins that a caller-staged request
// is never re-routed.
func TestSkillPush_ExplicitRefPassesThrough(t *testing.T) {
	fake := &fakeSkillPushTransport{pushOut: &skillv1.Skill{}}
	client := &SkillClient{transport: fake, httpClient: http.DefaultClient}

	_, err := client.Push(context.Background(), &skillv1.PushSkillRequest{
		Org:               "org",
		ArtifactUploadRef: "sau_mine",
	})
	if err != nil {
		t.Fatalf("Push: %v", err)
	}
	if fake.mintCalls != 0 {
		t.Error("explicit-ref push minted a new URL")
	}
	if fake.pushIn.GetArtifactUploadRef() != "sau_mine" {
		t.Error("explicit ref not passed through")
	}
}

// TestSkillPush_OldServerFailsLoud pins the downgrade story: against a
// server without the transfer lane, a large push fails with an actionable
// message instead of the raw "received message larger than max" transport
// error #675 reported.
func TestSkillPush_OldServerFailsLoud(t *testing.T) {
	fake := &fakeSkillPushTransport{
		mintErr: status.Error(codes.Unimplemented, "unknown method"),
	}
	client := &SkillClient{transport: fake, httpClient: http.DefaultClient}

	_, err := client.Push(context.Background(), &skillv1.PushSkillRequest{
		Org:      "org",
		Artifact: bytes.Repeat([]byte("z"), maxInlineArtifactBytes+1),
	})
	if err == nil {
		t.Fatal("Push succeeded against a lane-less server")
	}
	if !strings.Contains(err.Error(), "upgrade stigmer-server") {
		t.Errorf("error not actionable: %v", err)
	}
}

// TestSkillPush_UploadRejectionSurfacesBody pins that a staging failure
// carries the server's explanation through to the caller.
func TestSkillPush_UploadRejectionSurfacesBody(t *testing.T) {
	staging := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upload reference unknown or expired", http.StatusNotFound)
	}))
	defer staging.Close()

	fake := &fakeSkillPushTransport{
		mintOut: &skillv1.SkillArtifactUploadUrl{Url: staging.URL + "/u/sau_x", ArtifactUploadRef: "sau_x"},
	}
	client := &SkillClient{transport: fake, httpClient: staging.Client()}

	_, err := client.Push(context.Background(), &skillv1.PushSkillRequest{
		Org:      "org",
		Artifact: bytes.Repeat([]byte("z"), maxInlineArtifactBytes+1),
	})
	if err == nil || !strings.Contains(err.Error(), "unknown or expired") {
		t.Errorf("staging rejection not surfaced: %v", err)
	}
	if fake.pushIn != nil {
		t.Error("push proceeded after a failed staging upload")
	}
}
