package harness

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	iamv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/v1"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

// OwnerAccountID is the identity_account the tokenless synthetic caller
// authenticates as. It MUST match TEST_IDENTITY_ACCOUNT_ID in
// IntegrationTestSecurityConfig and the owner tuple seeded by SeedBaseFGATuples
// — the owner owns TestOrg and therefore can view every resource in it.
const OwnerAccountID = "test-identity-account-id"

// Actor is a single authenticated principal in the integration suite: a
// distinct identity_account whose gRPC Clients carry that identity.
//
// Visibility is fundamentally a multi-actor property — it governs who can see
// (and run) whose resources — so the suite models the canonical principals as
// Actors and asserts access verdicts through the real service + OpenFGA, exactly
// as production clients do. Identity is switched per call by the bearer token on
// the connection (see IntegrationTestSecurityConfig.resolveCallerFromBearer):
// the owner uses the shared tokenless connection, everyone else a minted one.
type Actor struct {
	// Name is a short label used in test output (e.g. "owner", "member").
	Name string
	// AccountID is the identity_account id this actor authenticates as — the
	// FGA subject used in can_* checks.
	AccountID string
	// Clients are gRPC clients bound to this actor's identity.
	Clients *Clients
}

// RequirePermission asserts that this actor's CheckMyPermission verdict for
// relation on the given resource equals want.
//
// CheckMyPermission is the production self-check RPC (the web console's
// PermissionGate / useCheckPermission). It anchors the FGA check to the
// authenticated caller server-side, so combined with per-actor bearer tokens it
// yields a faithful can_view / can_execute / can_edit / can_delete verdict
// without booting a Temporal execution to test "run what you can read".
func (a *Actor) RequirePermission(t *testing.T, ctx context.Context, kind, id, relation string, want bool) {
	t.Helper()
	res, err := a.Clients.IamPolicyQuery.CheckMyPermission(ctx, &iampolicyv1.CheckMyPermissionInput{
		Resource: &iampolicyv1.ApiResourceRef{Kind: kind, Id: id},
		Relation: relation,
	})
	require.NoError(t, err, "%s: CheckMyPermission(%s on %s:%s)", a.Name, relation, kind, id)
	require.Equal(t, want, res.GetIsAuthorized(),
		"%s: expected %s=%v on %s:%s", a.Name, relation, want, kind, id)
}

// RequireCanView asserts the actor is authorized to view the resource.
func (a *Actor) RequireCanView(t *testing.T, ctx context.Context, kind, id string) {
	t.Helper()
	a.RequirePermission(t, ctx, kind, id, "can_view", true)
}

// RequireCannotView asserts the actor is NOT authorized to view the resource.
func (a *Actor) RequireCannotView(t *testing.T, ctx context.Context, kind, id string) {
	t.Helper()
	a.RequirePermission(t, ctx, kind, id, "can_view", false)
}

// Actors builds and caches the canonical visibility principals against a running
// service. Construct once per test; the member and stranger are provisioned
// lazily on first use. All resources (platform clients, connections) are cleaned
// up via t.Cleanup registered by the underlying harness helpers.
type Actors struct {
	t         *testing.T
	ctx       context.Context
	grpcAddr  string
	ownerConn grpc.ClientConnInterface

	owner    *Actor
	member   *Actor
	stranger *Actor
}

// NewActors wires the actor factory to a running service. ownerConn is the
// shared tokenless connection (the synthetic org owner); grpcAddr is the
// service's gRPC address used to open per-actor bearer connections.
func NewActors(t *testing.T, ctx context.Context, ownerConn grpc.ClientConnInterface, grpcAddr string) *Actors {
	return &Actors{
		t:         t,
		ctx:       ctx,
		grpcAddr:  grpcAddr,
		ownerConn: ownerConn,
		owner: &Actor{
			Name:      "owner",
			AccountID: OwnerAccountID,
			Clients:   NewClients(ownerConn),
		},
	}
}

// Owner returns the tokenless synthetic caller that owns TestOrg.
func (a *Actors) Owner() *Actor { return a.owner }

// Member returns a TestOrg member: a JIT-provisioned account granted the member
// role on TestOrg, so it satisfies the organization:<org>#member userset that
// org-visibility tuples resolve against. Cached after first call.
func (a *Actors) Member() *Actor {
	if a.member == nil {
		a.member = a.mintActor("member", true, iamv1.IamRole_member)
	}
	return a.member
}

// Stranger returns an outside principal: a JIT-provisioned account with NO org
// role. It exists in the identity system but holds zero tuples on TestOrg, so it
// is the right actor to prove that private/org resources stay hidden while
// public ones remain visible. Cached after first call.
func (a *Actors) Stranger() *Actor {
	if a.stranger == nil {
		a.stranger = a.mintActor("stranger", false, iamv1.IamRole_iam_role_unspecified)
	}
	return a.stranger
}

// mintActor provisions a fresh identity through a PlatformClient in TestOrg and
// returns an Actor whose Clients authenticate as that identity.
func (a *Actors) mintActor(name string, grant bool, role iamv1.IamRole) *Actor {
	a.t.Helper()
	ownerClients := NewClients(a.ownerConn)

	opts := []PlatformClientOption{WithAutoProvision(true)}
	if grant {
		opts = append(opts, WithAutoGrantOnOrg(true), WithAutoGrantRole(role))
	}
	creds := CreatePlatformClient(a.t, a.ctx, ownerClients, opts...)

	userID := name + "-" + uuid.New().String()[:8]
	token := MintUserToken(a.t, a.ctx, ownerClients, creds, userID)

	conn := GRPCConnWithBearer(a.t, a.grpcAddr, token)
	return &Actor{
		Name:      name,
		AccountID: accountIDFromToken(a.t, token),
		Clients:   NewClients(conn),
	}
}

// accountIDFromToken extracts the subject (the identity_account id) from a
// Stigmer-minted JWT without verifying it — the test only needs the claim, and
// the service re-verifies the token on every call.
func accountIDFromToken(t *testing.T, token string) string {
	t.Helper()
	parts := strings.Split(token, ".")
	require.Len(t, parts, 3, "minted token must be a 3-segment JWT")

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	require.NoError(t, err, "decode JWT payload")

	var claims struct {
		Sub string `json:"sub"`
	}
	require.NoError(t, json.Unmarshal(payload, &claims), "unmarshal JWT claims")
	require.NotEmpty(t, claims.Sub, "minted token must carry a sub claim")
	return claims.Sub
}
