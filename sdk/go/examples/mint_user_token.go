// Example: Minting Stigmer user tokens with PlatformClient credentials.
//
// This example demonstrates how a platform builder's Go backend mints
// Stigmer-signed JWTs for their users. The tokens are returned to the
// frontend and passed to the React SDK's StigmerProvider via getAccessToken.
//
// This is NOT a runnable program — it shows the API patterns.
package examples

import (
	"context"
	"fmt"
	"log"
	"os"

	stigmer "github.com/stigmer/stigmer/sdk/go"
)

func MintUserToken() {
	ctx := context.Background()

	auth, err := stigmer.NewPlatformClientAuth(
		stigmer.WithPlatformClientCredentials(
			os.Getenv("STIGMER_CLIENT_ID"),
			os.Getenv("STIGMER_CLIENT_SECRET"),
		),
	)
	if err != nil {
		log.Fatal(err)
	}
	defer auth.Close()

	result, err := auth.MintUserToken(ctx, &stigmer.MintUserTokenInput{
		UserID:    "user-123",
		UserEmail: "jane@acme.com",
		UserName:  "Jane Doe",
	})
	if err != nil {
		if stigmer.IsUnauthenticated(err) {
			log.Fatal("Invalid PlatformClient credentials — verify STIGMER_CLIENT_ID and STIGMER_CLIENT_SECRET")
		}
		if stigmer.IsNotFound(err) {
			log.Fatal("User does not have a Stigmer identity account and auto-provisioning is disabled")
		}
		log.Fatal(err)
	}

	fmt.Printf("Token: %s\n", result.AccessToken)
	fmt.Printf("Expires at: %s\n", result.ExpiresAt)
}
