package auth

import (
	"context"
	"strings"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/emptypb"

	identityaccountv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/identityaccount/v1"
)

// tokenAuth implements grpc.PerRPCCredentials for bearer token authentication.
type tokenAuth struct {
	token string
}

func (t tokenAuth) GetRequestMetadata(_ context.Context, _ ...string) (map[string]string, error) {
	return map[string]string{
		"authorization": "Bearer " + t.token,
	}, nil
}

func (tokenAuth) RequireTransportSecurity() bool {
	return false
}

// FetchIdentity calls the WhoAmI RPC on the given cloud endpoint using a
// bearer token for authentication. It creates a short-lived gRPC connection
// independent of the main backend.Client — this keeps the whoami command
// functional before the backend auth interceptor is fully wired (Task 3).
func FetchIdentity(endpoint, token string) (*identityaccountv1.IdentityAccount, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var transportCreds grpc.DialOption
	if strings.HasSuffix(endpoint, ":443") {
		transportCreds = grpc.WithTransportCredentials(credentials.NewClientTLSFromCert(nil, ""))
	} else {
		transportCreds = grpc.WithTransportCredentials(insecure.NewCredentials())
	}

	conn, err := grpc.NewClient(
		endpoint,
		transportCreds,
		grpc.WithPerRPCCredentials(tokenAuth{token: token}),
	)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to connect to %s", endpoint)
	}
	defer conn.Close()

	client := identityaccountv1.NewIdentityAccountQueryControllerClient(conn)

	account, err := client.WhoAmI(ctx, &emptypb.Empty{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to fetch identity from cloud backend")
	}

	return account, nil
}
