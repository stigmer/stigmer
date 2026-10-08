// GitHub sign-in and repository reads. The OAuth exchange saves the token as
// the github.com login in the caller's My vault and answers only the account
// it belongs to; repository listing, search, branches, trees and file reads go
// through the server, which uses that saved login, so no caller holds the token.

package stigmer

import (
	"context"

	"github.com/stigmer/stigmer/sdk/go/v3/internal/gen"
	githubv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/platform/github/v1"
	"google.golang.org/grpc"
)

// GetOAuthAuthorizeUrlParams configures a request to get the GitHub OAuth authorize URL.
type GetOAuthAuthorizeUrlParams struct {
	RedirectURI string
	// Org is the organization whose My vault will keep the login, by slug or
	// id; the caller must be a member of it, and the exchange names the same one.
	Org string
}

// OAuthAuthorizeUrlResponse holds the authorize URL and CSRF state returned by the platform.
type OAuthAuthorizeUrlResponse struct {
	AuthorizeURL string
	State        string
}

// ExchangeOAuthCodeParams configures a request to exchange a GitHub OAuth authorization code.
type ExchangeOAuthCodeParams struct {
	Code        string
	State       string
	RedirectURI string
	// Org is the organization whose My vault keeps the login, by slug or id.
	Org string
}

// GitHubConnectedAccount is the GitHub account a saved login belongs to.
type GitHubConnectedAccount struct {
	Login     string
	TokenType string
	Scope     string
}

// GitHubRepoParams names a repository read through the caller's saved login.
type GitHubRepoParams struct {
	// Org is the organization whose My vault holds the github.com login.
	Org   string
	Owner string
	Repo  string
}

// GitHubClient provides GitHub sign-in and server-side repository reads.
type GitHubClient struct {
	github githubv1.GitHubServiceClient
	query  githubv1.GitHubQueryControllerClient
}

func newGitHubClient(conn grpc.ClientConnInterface) *GitHubClient {
	return &GitHubClient{
		github: githubv1.NewGitHubServiceClient(conn),
		query:  githubv1.NewGitHubQueryControllerClient(conn),
	}
}

// GetOAuthAuthorizeUrl returns the GitHub OAuth authorize URL to redirect the user to.
func (g *GitHubClient) GetOAuthAuthorizeUrl(ctx context.Context, params *GetOAuthAuthorizeUrlParams) (*OAuthAuthorizeUrlResponse, error) {
	resp, err := g.github.GetOAuthAuthorizeUrl(ctx, &githubv1.GetOAuthAuthorizeUrlRequest{
		RedirectUri: params.RedirectURI,
		Org:         params.Org,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return &OAuthAuthorizeUrlResponse{
		AuthorizeURL: resp.GetAuthorizeUrl(),
		State:        resp.GetState(),
	}, nil
}

// ExchangeOAuthCode exchanges an OAuth authorization code; the server saves the
// login in the caller's My vault and returns the account it belongs to.
func (g *GitHubClient) ExchangeOAuthCode(ctx context.Context, params *ExchangeOAuthCodeParams) (*GitHubConnectedAccount, error) {
	resp, err := g.github.ExchangeOAuthCode(ctx, &githubv1.ExchangeOAuthCodeRequest{
		Code:        params.Code,
		State:       params.State,
		RedirectUri: params.RedirectURI,
		Org:         params.Org,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return &GitHubConnectedAccount{
		Login:     resp.GetLogin(),
		TokenType: resp.GetTokenType(),
		Scope:     resp.GetScope(),
	}, nil
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
