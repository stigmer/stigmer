package stigmer

// Wire-shape tests for GitHubClient: a fake generated stub captures the
// outgoing request proto, and each test asserts the SDK params reached the
// right fields, the organization above all, since the server refuses a
// connect or a read that names none. The repository reads also hand back the
// server's answer as it came, and a refusal (the "connect GitHub first"
// precondition) reaches the caller as an *Error carrying its code.

import (
	"context"
	"errors"
	"slices"
	"testing"

	githubv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/platform/github/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// fakeGitHubService captures requests to the GitHub sign-in service.
type fakeGitHubService struct {
	githubv1.GitHubServiceClient

	authorizeIn *githubv1.GetOAuthAuthorizeUrlRequest
	exchangeIn  *githubv1.ExchangeOAuthCodeRequest
}

func (f *fakeGitHubService) GetOAuthAuthorizeUrl(_ context.Context, in *githubv1.GetOAuthAuthorizeUrlRequest, _ ...grpc.CallOption) (*githubv1.GetOAuthAuthorizeUrlResponse, error) {
	f.authorizeIn = in
	return &githubv1.GetOAuthAuthorizeUrlResponse{AuthorizeUrl: "https://github.com/login/oauth/authorize?state=s1", State: "s1"}, nil
}

func (f *fakeGitHubService) ExchangeOAuthCode(_ context.Context, in *githubv1.ExchangeOAuthCodeRequest, _ ...grpc.CallOption) (*githubv1.ExchangeOAuthCodeResponse, error) {
	f.exchangeIn = in
	return &githubv1.ExchangeOAuthCodeResponse{Login: "octocat", TokenType: "bearer", Scope: "repo"}, nil
}

func TestGitHubGetOAuthAuthorizeUrl_SendsOrgAndRedirect(t *testing.T) {
	fake := &fakeGitHubService{}
	client := &GitHubClient{github: fake}

	resp, err := client.GetOAuthAuthorizeUrl(context.Background(), &GetOAuthAuthorizeUrlParams{
		RedirectURI: "https://app.example/callback",
		Org:         "acme",
	})
	if err != nil {
		t.Fatalf("GetOAuthAuthorizeUrl: %v", err)
	}
	if resp.State != "s1" {
		t.Errorf("State = %q, want s1", resp.State)
	}
	in := fake.authorizeIn
	if in.GetOrg() != "acme" {
		t.Errorf("Org = %q, want acme", in.GetOrg())
	}
	if in.GetRedirectUri() != "https://app.example/callback" {
		t.Errorf("RedirectUri = %q", in.GetRedirectUri())
	}
}

func TestGitHubExchangeOAuthCode_SendsOrg(t *testing.T) {
	fake := &fakeGitHubService{}
	client := &GitHubClient{github: fake}

	account, err := client.ExchangeOAuthCode(context.Background(), &ExchangeOAuthCodeParams{
		Code:        "c1",
		State:       "s1",
		RedirectURI: "https://app.example/callback",
		Org:         "acme",
	})
	if err != nil {
		t.Fatalf("ExchangeOAuthCode: %v", err)
	}
	if account.Login != "octocat" {
		t.Errorf("Login = %q, want octocat", account.Login)
	}
	in := fake.exchangeIn
	if in.GetOrg() != "acme" || in.GetCode() != "c1" || in.GetState() != "s1" {
		t.Errorf("request = %+v, want org acme, code c1, state s1", in)
	}
}

// fakeGitHubQuery captures requests to the repository reads and answers each
// with a fixed reply, or refuses every call when refuse is set.
type fakeGitHubQuery struct {
	githubv1.GitHubQueryControllerClient

	refuse bool

	listIn     *githubv1.ListGitHubRepositoriesInput
	searchIn   *githubv1.SearchGitHubRepositoriesInput
	branchesIn *githubv1.ListGitHubBranchesInput
	treeIn     *githubv1.GetGitHubTreeInput
	fileIn     *githubv1.GetGitHubFileContentInput
}

func (f *fakeGitHubQuery) refusal() error {
	return status.Error(codes.FailedPrecondition, "connect GitHub first")
}

func (f *fakeGitHubQuery) ListRepositories(_ context.Context, in *githubv1.ListGitHubRepositoriesInput, _ ...grpc.CallOption) (*githubv1.GitHubRepositoryList, error) {
	if f.refuse {
		return nil, f.refusal()
	}
	f.listIn = in
	return &githubv1.GitHubRepositoryList{
		Repositories: []*githubv1.GitHubRepository{{
			Id:                  42,
			FullName:            "acme/app",
			Name:                "app",
			Owner:               "acme",
			OwnerIsOrganization: true,
			HtmlUrl:             "https://github.com/acme/app",
			CloneUrl:            "https://github.com/acme/app.git",
			DefaultBranch:       "main",
			IsPrivate:           true,
			UpdatedAt:           "2026-10-01T12:00:00Z",
		}},
		HasMore: true,
	}, nil
}

func (f *fakeGitHubQuery) SearchRepositories(_ context.Context, in *githubv1.SearchGitHubRepositoriesInput, _ ...grpc.CallOption) (*githubv1.GitHubRepositoryList, error) {
	if f.refuse {
		return nil, f.refusal()
	}
	f.searchIn = in
	return &githubv1.GitHubRepositoryList{
		Repositories: []*githubv1.GitHubRepository{{FullName: "acme/app-api", Name: "app-api", Owner: "acme"}},
	}, nil
}

func (f *fakeGitHubQuery) ListBranches(_ context.Context, in *githubv1.ListGitHubBranchesInput, _ ...grpc.CallOption) (*githubv1.GitHubBranchList, error) {
	if f.refuse {
		return nil, f.refusal()
	}
	f.branchesIn = in
	return &githubv1.GitHubBranchList{Names: []string{"main", "dev"}}, nil
}

func (f *fakeGitHubQuery) GetTree(_ context.Context, in *githubv1.GetGitHubTreeInput, _ ...grpc.CallOption) (*githubv1.GitHubTree, error) {
	if f.refuse {
		return nil, f.refusal()
	}
	f.treeIn = in
	return &githubv1.GitHubTree{
		Entries: []*githubv1.GitHubTreeEntry{
			{Path: "src", IsDirectory: true},
			{Path: "src/main.go", Size: 120},
		},
		Truncated: true,
	}, nil
}

func (f *fakeGitHubQuery) GetFileContent(_ context.Context, in *githubv1.GetGitHubFileContentInput, _ ...grpc.CallOption) (*githubv1.GitHubFileContent, error) {
	if f.refuse {
		return nil, f.refusal()
	}
	f.fileIn = in
	if in.GetPath() == "big.bin" {
		return &githubv1.GitHubFileContent{Size: 11 << 20, TooLarge: true}, nil
	}
	return &githubv1.GitHubFileContent{Content: []byte("hello"), Size: 5}, nil
}

// appRepo names the repository every read below targets.
var appRepo = &GitHubRepoParams{Org: "acme", Owner: "acme", Repo: "app"}

func TestGitHubListRepositories_SendsOrgAndPage(t *testing.T) {
	fake := &fakeGitHubQuery{}
	client := &GitHubClient{query: fake}

	list, err := client.ListRepositories(context.Background(), "acme", 2)
	if err != nil {
		t.Fatalf("ListRepositories: %v", err)
	}
	if in := fake.listIn; in.GetOrg() != "acme" || in.GetPage() != 2 {
		t.Errorf("request = %+v, want org acme, page 2", in)
	}
	if !list.GetHasMore() {
		t.Error("HasMore = false, want true")
	}
	if n := len(list.GetRepositories()); n != 1 {
		t.Fatalf("len(Repositories) = %d, want 1", n)
	}
	repo := list.GetRepositories()[0]
	if repo.GetId() != 42 || repo.GetFullName() != "acme/app" || repo.GetName() != "app" || repo.GetOwner() != "acme" {
		t.Errorf("repository identity = %+v", repo)
	}
	if !repo.GetOwnerIsOrganization() || !repo.GetIsPrivate() {
		t.Errorf("OwnerIsOrganization = %v, IsPrivate = %v, want both true", repo.GetOwnerIsOrganization(), repo.GetIsPrivate())
	}
	if repo.GetHtmlUrl() != "https://github.com/acme/app" || repo.GetCloneUrl() != "https://github.com/acme/app.git" {
		t.Errorf("HtmlUrl = %q, CloneUrl = %q", repo.GetHtmlUrl(), repo.GetCloneUrl())
	}
	if repo.GetDefaultBranch() != "main" || repo.GetUpdatedAt() != "2026-10-01T12:00:00Z" {
		t.Errorf("DefaultBranch = %q, UpdatedAt = %q", repo.GetDefaultBranch(), repo.GetUpdatedAt())
	}
}

func TestGitHubSearchRepositories_SendsOrgQueryAndPage(t *testing.T) {
	fake := &fakeGitHubQuery{}
	client := &GitHubClient{query: fake}

	list, err := client.SearchRepositories(context.Background(), "acme", "app", 3)
	if err != nil {
		t.Fatalf("SearchRepositories: %v", err)
	}
	if in := fake.searchIn; in.GetOrg() != "acme" || in.GetQuery() != "app" || in.GetPage() != 3 {
		t.Errorf("request = %+v, want org acme, query app, page 3", in)
	}
	if list.GetHasMore() {
		t.Error("HasMore = true, want false")
	}
	if n := len(list.GetRepositories()); n != 1 || list.GetRepositories()[0].GetFullName() != "acme/app-api" {
		t.Errorf("Repositories = %+v, want one acme/app-api", list.GetRepositories())
	}
}

func TestGitHubListBranches_SendsOrgOwnerAndRepo(t *testing.T) {
	fake := &fakeGitHubQuery{}
	client := &GitHubClient{query: fake}

	names, err := client.ListBranches(context.Background(), appRepo)
	if err != nil {
		t.Fatalf("ListBranches: %v", err)
	}
	if in := fake.branchesIn; in.GetOrg() != "acme" || in.GetOwner() != "acme" || in.GetRepo() != "app" {
		t.Errorf("request = %+v, want org acme, owner acme, repo app", in)
	}
	if !slices.Equal(names, []string{"main", "dev"}) {
		t.Errorf("names = %v, want [main dev]", names)
	}
}

func TestGitHubGetTree_SendsRepoAndRef(t *testing.T) {
	fake := &fakeGitHubQuery{}
	client := &GitHubClient{query: fake}

	tree, err := client.GetTree(context.Background(), appRepo, "dev")
	if err != nil {
		t.Fatalf("GetTree: %v", err)
	}
	in := fake.treeIn
	if in.GetOrg() != "acme" || in.GetOwner() != "acme" || in.GetRepo() != "app" || in.GetRef() != "dev" {
		t.Errorf("request = %+v, want org acme, owner acme, repo app, ref dev", in)
	}
	if !tree.GetTruncated() {
		t.Error("Truncated = false, want true")
	}
	entries := tree.GetEntries()
	if len(entries) != 2 {
		t.Fatalf("len(Entries) = %d, want 2", len(entries))
	}
	if entries[0].GetPath() != "src" || !entries[0].GetIsDirectory() {
		t.Errorf("entries[0] = %+v, want directory src", entries[0])
	}
	if entries[1].GetPath() != "src/main.go" || entries[1].GetIsDirectory() || entries[1].GetSize() != 120 {
		t.Errorf("entries[1] = %+v, want file src/main.go of 120 bytes", entries[1])
	}
}

func TestGitHubGetFileContent_SendsRepoRefAndPath(t *testing.T) {
	fake := &fakeGitHubQuery{}
	client := &GitHubClient{query: fake}

	file, err := client.GetFileContent(context.Background(), appRepo, "main", "README.md")
	if err != nil {
		t.Fatalf("GetFileContent: %v", err)
	}
	in := fake.fileIn
	if in.GetOrg() != "acme" || in.GetOwner() != "acme" || in.GetRepo() != "app" || in.GetRef() != "main" || in.GetPath() != "README.md" {
		t.Errorf("request = %+v, want org acme, owner acme, repo app, ref main, path README.md", in)
	}
	if string(file.GetContent()) != "hello" || file.GetSize() != 5 || file.GetTooLarge() {
		t.Errorf("file = %+v, want content hello, size 5, not too large", file)
	}
}

func TestGitHubGetFileContent_TooLargeHasNoContent(t *testing.T) {
	client := &GitHubClient{query: &fakeGitHubQuery{}}

	file, err := client.GetFileContent(context.Background(), appRepo, "main", "big.bin")
	if err != nil {
		t.Fatalf("GetFileContent: %v", err)
	}
	if !file.GetTooLarge() || len(file.GetContent()) != 0 || file.GetSize() != 11<<20 {
		t.Errorf("file = too large %v, %d content bytes, size %d; want too large, no content, size %d",
			file.GetTooLarge(), len(file.GetContent()), file.GetSize(), 11<<20)
	}
}

func TestGitHubReads_SurfaceRefusalAsError(t *testing.T) {
	client := &GitHubClient{query: &fakeGitHubQuery{refuse: true}}
	ctx := context.Background()

	calls := map[string]func() error{
		"ListRepositories": func() error { _, err := client.ListRepositories(ctx, "acme", 1); return err },
		"SearchRepositories": func() error {
			_, err := client.SearchRepositories(ctx, "acme", "q", 1)
			return err
		},
		"ListBranches": func() error { _, err := client.ListBranches(ctx, appRepo); return err },
		"GetTree":      func() error { _, err := client.GetTree(ctx, appRepo, "main"); return err },
		"GetFileContent": func() error {
			_, err := client.GetFileContent(ctx, appRepo, "main", "a")
			return err
		},
	}
	for name, call := range calls {
		t.Run(name, func(t *testing.T) {
			var sErr *Error
			if err := call(); !errors.As(err, &sErr) {
				t.Fatalf("err = %v (%T), want *Error", err, err)
			}
			if sErr.Code != CodeFailedPrecondition {
				t.Errorf("Code = %d, want CodeFailedPrecondition", sErr.Code)
			}
		})
	}
}
