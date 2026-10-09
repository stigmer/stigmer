// GitHub repository reads. GitHub is connected by the vault's sign-in at the
// address github.com (VaultClient.StartSignIn and CompleteSignIn), which saves
// the login in the caller's My vault; repository listing, search, branches,
// trees and file reads go through the server, which uses that saved login, so
// no caller holds the token.

package stigmer

import (
	"context"

	"github.com/stigmer/stigmer/sdk/go/v3/internal/gen"
	githubv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/platform/github/v1"
	"google.golang.org/grpc"
)

// GitHubRepoParams names a repository read through the caller's saved login.
type GitHubRepoParams struct {
	// Org is the organization whose My vault holds the github.com login.
	Org   string
	Owner string
	Repo  string
}

// GitHubClient provides server-side repository reads with the caller's github.com login.
type GitHubClient struct {
	query githubv1.GitHubQueryControllerClient
}

func newGitHubClient(conn grpc.ClientConnInterface) *GitHubClient {
	return &GitHubClient{
		query: githubv1.NewGitHubQueryControllerClient(conn),
	}
}

// ListRepositories returns one page (from 1) of the connected account's
// repositories, most recently updated first.
func (g *GitHubClient) ListRepositories(ctx context.Context, org string, page int32) (*githubv1.GitHubRepositoryList, error) {
	resp, err := g.query.ListRepositories(ctx, &githubv1.ListGitHubRepositoriesInput{Org: org, Page: page})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// SearchRepositories returns one page (from 1) of the connected account's
// repositories matching a search.
func (g *GitHubClient) SearchRepositories(ctx context.Context, org, query string, page int32) (*githubv1.GitHubRepositoryList, error) {
	resp, err := g.query.SearchRepositories(ctx, &githubv1.SearchGitHubRepositoriesInput{Org: org, Query: query, Page: page})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// ListBranches returns a repository's branch names.
func (g *GitHubClient) ListBranches(ctx context.Context, params *GitHubRepoParams) ([]string, error) {
	resp, err := g.query.ListBranches(ctx, &githubv1.ListGitHubBranchesInput{
		Org: params.Org, Owner: params.Owner, Repo: params.Repo,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp.GetNames(), nil
}

// GetTree returns every file and directory of a repository at a branch or commit.
func (g *GitHubClient) GetTree(ctx context.Context, params *GitHubRepoParams, ref string) (*githubv1.GitHubTree, error) {
	resp, err := g.query.GetTree(ctx, &githubv1.GetGitHubTreeInput{
		Org: params.Org, Owner: params.Owner, Repo: params.Repo, Ref: ref,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}

// GetFileContent reads one file of a repository at a branch or commit; a file
// above 10 MiB comes back TooLarge with no content.
func (g *GitHubClient) GetFileContent(ctx context.Context, params *GitHubRepoParams, ref, path string) (*githubv1.GitHubFileContent, error) {
	resp, err := g.query.GetFileContent(ctx, &githubv1.GetGitHubFileContentInput{
		Org: params.Org, Owner: params.Owner, Repo: params.Repo, Ref: ref, Path: path,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return resp, nil
}
