// Example: minting Stigmer user tokens with a service account's API key.
//
// This example shows how a product's Go backend mints short-lived user
// tokens for the people signed in to it. The backend holds the API key of a
// service account that is an admin of the organization; the tokens are
// returned to the frontend and passed to the React SDK's StigmerProvider via
// getAccessToken.
//
// This is NOT a runnable program — it shows the API patterns.
package examples

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"

	stigmer "github.com/stigmer/stigmer/sdk/go/v3"
)

func MintUserToken() {
	ctx := context.Background()

	client, err := stigmer.NewClient(stigmer.WithAPIKey(os.Getenv("STIGMER_API_KEY")))
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	result, err := client.Tokens.MintUserToken(ctx, &stigmer.MintUserTokenInput{
		Org:       "acme",
		UserID:    "user-123",
		UserEmail: "jane@acme.com",
		UserName:  "Jane Doe",
	})
	if err != nil {
		if stigmer.IsPermissionDenied(err) {
			log.Fatal("STIGMER_API_KEY is not an admin service account's key for this organization")
		}
		var sdkErr *stigmer.Error
		if errors.As(err, &sdkErr) && sdkErr.Code == stigmer.CodeFailedPrecondition {
			log.Fatal("The person has no Stigmer account and the organization's embedding settings do not create one")
		}
		log.Fatal(err)
	}

	fmt.Printf("Token: %s\n", result.AccessToken)
	fmt.Printf("Expires at: %s\n", result.ExpiresAt)
}
