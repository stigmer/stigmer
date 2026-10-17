// The token service's client: mint a short-lived user token for a person
// signed in to your product, from your product's backend.
//
// Minting is one call on the ordinary client built with a service account's
// API key (NewClient with WithAPIKey); there is no separate credential pair.
// The account must be an admin of the organization the token is for, or of
// its parent organization (a parent's admins are admins in each of its
// children); a person's key is refused. Pass the returned
// AccessToken to the React SDK's StigmerProvider through getAccessToken.
//
// Org and UserID are checked here before any request, so a missing value
// fails as invalid-argument without a round trip. The organization's
// embedding settings decide whether a first sign-in creates the person's
// account and with which role; the token lives until it expires, or until
// the service account that minted it is deleted.

package stigmer

import (
	"context"
	"time"

	"go.stigmer.ai/sdk/internal/gen"
	tokenv1 "go.stigmer.ai/sdk/proto/ai/stigmer/iam/token/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

// MintUserTokenInput names the person a user token is for.
type MintUserTokenInput struct {
	// Org is the organization the token is for, by id or slug: the minting
	// service account's organization, or one of its child organizations.
	// Required.
	Org string

	// UserID is your product's stable identifier for the person. With Org it
	// names one identity account, so changing it creates a new account.
	// Required.
	UserID string

	// UserEmail is the person's email address, used when their account is
	// created; later mints do not change the stored profile.
	UserEmail string

	// UserName is the person's display name, used when their account is
	// created; later mints do not change the stored profile.
	UserName string
}

// MintUserTokenResult is a minted user token and its lifetime.
type MintUserTokenResult struct {
	// AccessToken is the token a browser sends as its Bearer credential.
	AccessToken string

	// TokenType is the token type. Always "Bearer".
	TokenType string

	// ExpiresIn is the token lifetime in seconds from issuance.
	ExpiresIn int32

	// ExpiresAt is the absolute expiration time, computed from ExpiresIn at
	// call time.
	ExpiresAt time.Time
}

// TokenClient mints user tokens with the client's service-account key.
type TokenClient struct {
	tokens tokenv1.TokenServiceClient
}

func newTokenClient(conn grpc.ClientConnInterface) *TokenClient {
	return &TokenClient{tokens: tokenv1.NewTokenServiceClient(conn)}
}

// MintUserToken mints a user token for a person signed in to your product.
//
//	client, err := stigmer.NewClient(stigmer.WithAPIKey(os.Getenv("STIGMER_API_KEY")))
//	if err != nil {
//	    log.Fatal(err)
//	}
//	defer client.Close()
//
//	result, err := client.Tokens.MintUserToken(ctx, &stigmer.MintUserTokenInput{
//	    Org:       "acme",
//	    UserID:    "user-123",
//	    UserEmail: "jane@acme.com",
//	    UserName:  "Jane Doe",
//	})
//
// It returns a [CodeInvalidArgument] error when Org or UserID is empty,
// [CodePermissionDenied] when the client's key is not an admin service
// account's for the organization, and [CodeFailedPrecondition] when the
// person has no account and the organization's embedding settings do not
// create one.
func (c *TokenClient) MintUserToken(ctx context.Context, input *MintUserTokenInput) (*MintUserTokenResult, error) {
	if input == nil || input.Org == "" {
		return nil, invalidTokenInput("mintUserToken: org is required — the organization the token is for, by id or slug")
	}
	if input.UserID == "" {
		return nil, invalidTokenInput("mintUserToken: userID is required — your product's stable identifier for the person")
	}

	resp, err := c.tokens.MintUserToken(ctx, &tokenv1.MintUserTokenRequest{
		Org:       input.Org,
		UserId:    input.UserID,
		UserEmail: input.UserEmail,
		UserName:  input.UserName,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}

	return &MintUserTokenResult{
		AccessToken: resp.GetAccessToken(),
		TokenType:   resp.GetTokenType(),
		ExpiresIn:   resp.GetExpiresIn(),
		ExpiresAt:   time.Now().Add(time.Duration(resp.GetExpiresIn()) * time.Second),
	}, nil
}

func invalidTokenInput(message string) error {
	return &gen.Error{
		Code:     gen.CodeInvalidArgument,
		Message:  message,
		GRPCCode: codes.InvalidArgument,
	}
}
