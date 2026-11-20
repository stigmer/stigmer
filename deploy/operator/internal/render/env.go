// The server's and the shared runner's settings, one pure function per
// container, rendered from the Stigmer alone.
//
// Every name has a docker-compose.yml counterpart in Compose's order, and
// parity_test.go holds the two equal name for name. A name the operator adds
// beyond Compose is declared there, by reason. Secrets are always referenced,
// never copied in: the keys from the operator's keys Secret, a password from
// the Secret the declaration names. OwnedEnvNames reads the names back so
// extraEnv can be refused for any of them; a later entry of the same name
// would replace the earlier one when the kubelet builds the environment, and
// silently undo what the resource declares.

package render

import (
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"

	corev1 "k8s.io/api/core/v1"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

// Without a front door the server is reached by port-forward, so the URLs
// minted for browsers and the CLI name the forwarded ports (PublicURL).
const (
	localPublicURL   = "http://localhost:7234"
	localArtifactURL = "http://localhost:7235"
)

// RunnerModelKeys are the names the shared runner reads its model provider's
// credentials from (backend/services/runner/src/shared/runner-credential-keys.ts),
// plus ANTHROPIC_BASE_URL, which sends Anthropic calls to a gateway instead.
var RunnerModelKeys = []string{
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_BASE_URL",
	"OPENAI_API_KEY",
	"ANTHROPIC_FOUNDRY_API_KEY",
	"AWS_BEARER_TOKEN_BEDROCK",
}

// Keys in the object store's credentials Secret.
const (
	ObjectStoreAccessKeyID     = "ACCESS_KEY_ID"
	ObjectStoreSecretAccessKey = "SECRET_ACCESS_KEY"
)

// defaultObjectStoreRegion is the region a bucket declared without one is
// signed for, the server's own default.
const defaultObjectStoreRegion = "us-east-1"

// ObjectStore is the declared bucket, or nil when files live on a volume.
func ObjectStore(st *stigmerv1.Stigmer) *stigmerv1.S3Spec {
	if st.Spec.ObjectStore == nil {
		return nil
	}
	return &st.Spec.ObjectStore.S3
}

// ObjectStoreRegion is the bucket's region, the default when unset.
func ObjectStoreRegion(s3 *stigmerv1.S3Spec) string {
	if s3.Region == "" {
		return defaultObjectStoreRegion
	}
	return s3.Region
}

// Keys in the keys Secret; each is the server setting of the same name.
const (
	EncryptionKey    = "STIGMER_ENCRYPTION_KEY"
	RunnerTokenKey   = "STIGMER_RUNNER_TOKEN_KEY"
	PlatformTokenKey = "STIGMER_PLATFORM_TOKEN_KEY"
)

// DatabaseConnection is where the server's records live.
type DatabaseConnection struct {
	Host     string
	Port     int32
	User     string
	Database string
	Password stigmerv1.SecretKeySelector
	SSLMode  string
	Bundled  bool
}

// Database resolves the declared database to one connection.
func Database(st *stigmerv1.Stigmer) DatabaseConnection {
	if ext := externalDatabase(st); ext != nil {
		port := ext.Port
		if port == 0 {
			port = 5432
		}
		db := ext.Database
		if db == "" {
			db = PostgresAppDatabase
		}
		return DatabaseConnection{
			Host: ext.Host, Port: port, User: ext.User, Database: db,
			Password: ext.PasswordSecret, SSLMode: ext.SSLMode,
		}
	}
	return DatabaseConnection{
		Host:     PostgresReadWriteService(st),
		Port:     5432,
		User:     PostgresAppUser,
		Database: PostgresAppDatabase,
		Password: stigmerv1.SecretKeySelector{Name: PostgresAppSecret(st), Key: "password"},
		Bundled:  true,
	}
}

func externalDatabase(st *stigmerv1.Stigmer) *stigmerv1.ExternalPostgreSQLSpec {
	if st.Spec.Database == nil || st.Spec.Database.PostgreSQL == nil {
		return nil
	}
	return st.Spec.Database.PostgreSQL.External
}

// BundledDatabase is the bundled Postgres's declaration, defaults when absent.
func BundledDatabase(st *stigmerv1.Stigmer) stigmerv1.BundledPostgreSQLSpec {
	if st.Spec.Database != nil && st.Spec.Database.PostgreSQL != nil && st.Spec.Database.PostgreSQL.Bundled != nil {
		return *st.Spec.Database.PostgreSQL.Bundled
	}
	return stigmerv1.BundledPostgreSQLSpec{}
}

// TemporalConnection is the Temporal frontend the server and runner dial.
type TemporalConnection struct {
	HostPort  string
	Namespace string
	TLS       *stigmerv1.TemporalTLSSpec
	APIKey    *stigmerv1.SecretKeySelector
	Bundled   bool
}

// Temporal resolves the declared Temporal to one connection.
func Temporal(st *stigmerv1.Stigmer) TemporalConnection {
	if ext := ExternalTemporal(st); ext != nil {
		ns := ext.Namespace
		if ns == "" {
			ns = TemporalNamespace
		}
		return TemporalConnection{HostPort: ext.HostPort, Namespace: ns, TLS: ext.TLS, APIKey: ext.APIKey}
	}
	return TemporalConnection{
		HostPort:  fmt.Sprintf("%s:%d", TemporalFrontendService(st), TemporalPort),
		Namespace: TemporalNamespace,
		Bundled:   true,
	}
}

// ExternalTemporal is the declared external Temporal, or nil.
func ExternalTemporal(st *stigmerv1.Stigmer) *stigmerv1.ExternalTemporalSpec {
	if st.Spec.Temporal == nil {
		return nil
	}
	return st.Spec.Temporal.External
}

func value(name, v string) corev1.EnvVar { return corev1.EnvVar{Name: name, Value: v} }

func fromSecret(name, secret, key string, optional bool) corev1.EnvVar {
	ref := &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: secret}, Key: key}
	if optional {
		ref.Optional = &optional
	}
	return corev1.EnvVar{Name: name, ValueFrom: &corev1.EnvVarSource{SecretKeyRef: ref}}
}

// temporalConnectionEnv is how both containers authenticate to an external
// Temporal (@stigmer/temporal-codecs' STIGMER_TEMPORAL_* settings), every
// secret through a reference, the PEM items in their _DATA form so nothing
// is mounted. A plaintext Temporal, bundled or external, renders nothing.
func temporalConnectionEnv(t TemporalConnection) []corev1.EnvVar {
	var env []corev1.EnvVar
	if t.TLS != nil {
		env = append(env, value("STIGMER_TEMPORAL_TLS", "true"))
		if t.TLS.ServerName != "" {
			env = append(env, value("STIGMER_TEMPORAL_TLS_SERVER_NAME", t.TLS.ServerName))
		}
		for _, item := range []struct{ name, key string }{
			{"STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_DATA", t.TLS.CAKey},
			{"STIGMER_TEMPORAL_TLS_CLIENT_CERT_DATA", t.TLS.CertKey},
			{"STIGMER_TEMPORAL_TLS_CLIENT_KEY_DATA", t.TLS.KeyKey},
		} {
			if item.key != "" {
				env = append(env, fromSecret(item.name, t.TLS.SecretName, item.key, false))
			}
		}
	}
	if t.APIKey != nil {
		env = append(env, fromSecret("STIGMER_TEMPORAL_API_KEY", t.APIKey.Name, t.APIKey.Key, false))
	}
	return env
}

// OIDC is the issuer the server trusts: the declared one, or the bundled
// sign-in's, whose discovery document the server fetches at its in-cluster
// Service while the issuer stays the public name browsers sign in at.
func OIDC(st *stigmerv1.Stigmer) stigmerv1.OIDCSpec {
	if st.Spec.Identity != nil && st.Spec.Identity.OIDC != nil {
		return *st.Spec.Identity.OIDC
	}
	return stigmerv1.OIDCSpec{
		Issuer:          BundledIssuer(st),
		Audience:        PublicURL(st),
		ConsoleClientID: ConsoleClientID,
		NativeClientID:  NativeClientID,
		DiscoveryURL:    KeycloakInternalURL(st) + RealmPath,
	}
}

// ServerEnv is the server container's environment, before extraEnv.
func ServerEnv(st *stigmerv1.Stigmer) []corev1.EnvVar {
	db := Database(st)
	t := Temporal(st)
	keys := KeysSecret(st)

	env := []corev1.EnvVar{
		value("GRPC_PORT", strconv.Itoa(GRPCPort)),
		// A non-empty DATABASE_URL selects Postgres. It names the user and
		// the address only: node-postgres reads PGDATABASE and PGPASSWORD
		// when the URL carries neither, so no character in either can break
		// it, and the password stays in its Secret.
		value("DATABASE_URL", fmt.Sprintf("postgres://%s@%s:%d", userEscape(db.User), db.Host, db.Port)),
		value("PGDATABASE", db.Database),
		fromSecret("PGPASSWORD", db.Password.Name, db.Password.Key, false),
	}
	if db.SSLMode != "" {
		env = append(env, value("PGSSLMODE", db.SSLMode))
	}
	env = append(env,
		value("TEMPORAL_HOST_PORT", t.HostPort),
		value("TEMPORAL_NAMESPACE", t.Namespace),
	)
	env = append(env, temporalConnectionEnv(t)...)
	env = append(env,
		value("TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE", RunnerTaskQueue),
	)
	if s3 := ObjectStore(st); s3 != nil {
		env = append(env, objectStoreEnv(s3)...)
	} else {
		env = append(env,
			value("ARTIFACT_STORAGE_TYPE", "local"),
			value("ARTIFACT_LOCAL_BASE_PATH", ArtifactsMount),
			value("ARTIFACT_LOCAL_SERVE_URL", ArtifactServeURL(st)),
		)
	}
	env = append(env,
		value("SKILL_TRANSFER_BASE_URL", PublicURL(st)),
		fromSecret(EncryptionKey, keys, EncryptionKey, false),
		fromSecret(RunnerTokenKey, keys, RunnerTokenKey, false),
		fromSecret(PlatformTokenKey, keys, PlatformTokenKey, false),
	)
	var email, name string
	if st.Spec.Owner != nil {
		email, name = st.Spec.Owner.Email, st.Spec.Owner.Name
	}
	env = append(env, value("STIGMER_OPERATOR_EMAIL", email), value("STIGMER_OPERATOR_NAME", name))
	if SignInOn(st) {
		oidc := OIDC(st)
		env = append(env,
			value("STIGMER_OIDC_ISSUER", oidc.Issuer),
			value("STIGMER_OIDC_AUDIENCE", oidc.Audience),
			value("STIGMER_OIDC_CONSOLE_CLIENT_ID", oidc.ConsoleClientID),
			value("STIGMER_OIDC_NATIVE_CLIENT_ID", oidc.NativeClientID),
		)
		if oidc.DiscoveryURL != "" {
			env = append(env, value("STIGMER_OIDC_DISCOVERY_URL", oidc.DiscoveryURL))
		}
		// The shared runner's key, stored by the server at boot as its runner
		// service account's; the runner reads the same value as STIGMER_TOKEN.
		if RunnerEnabled(st) {
			env = append(env, fromSecret("STIGMER_RUNNER_API_KEY", RunnerKeySecret(st), RunnerKeyKey, false))
		}
	}
	if help := st.Spec.Server.Help; help != nil && help.URL != "" {
		env = append(env, value("STIGMER_HELP_URL", help.URL))
		if help.Label != "" {
			env = append(env, value("STIGMER_HELP_LABEL", help.Label))
		}
	}
	if len(st.Spec.Server.InternalAccounts) > 0 {
		env = append(env, value("STIGMER_INTERNAL_ACCOUNTS", strings.Join(st.Spec.Server.InternalAccounts, ",")))
	}
	if Licensed(st) {
		env = append(env, enterpriseEnv(st)...)
	}
	return env
}

// objectStoreEnv puts the server's files in the bucket: what a run stores
// beside its record, Files and Skills (the server's S3_* settings), with the
// access key referenced from its Secret. The server then serves the runner
// artifact lane, through which a runner reads and writes without the keys.
func objectStoreEnv(s3 *stigmerv1.S3Spec) []corev1.EnvVar {
	env := []corev1.EnvVar{
		value("ARTIFACT_STORAGE_TYPE", "s3"),
		value("SKILL_ARTIFACT_STORAGE_TYPE", "s3"),
		value("S3_BUCKET", s3.Bucket),
		value("S3_REGION", ObjectStoreRegion(s3)),
	}
	if s3.Endpoint != "" {
		env = append(env, value("S3_ENDPOINT", s3.Endpoint))
	}
	if s3.RunnerEndpoint != "" {
		env = append(env, value("S3_RUNNER_ENDPOINT", s3.RunnerEndpoint))
	}
	return append(env,
		fromSecret("S3_ACCESS_KEY_ID", s3.CredentialsSecret.Name, ObjectStoreAccessKeyID, false),
		fromSecret("S3_SECRET_ACCESS_KEY", s3.CredentialsSecret.Name, ObjectStoreSecretAccessKey, false),
	)
}

// enterpriseEnv is Stigmer Enterprise's own settings (ee/server/README.md).
// Every name renders under a license, empty when unset: the server reads an
// empty value as unset, so a licensed pod's names never depend on the
// declaration. The shared-runner acknowledgement is never rendered: a
// server licensed for several organizations runs per-session sandboxes.
func enterpriseEnv(st *stigmerv1.Stigmer) []corev1.EnvVar {
	ent := st.Spec.Enterprise
	egress := ent.OutboundEgress
	if egress == "" {
		egress = "strict"
	}
	retention := ""
	if ent.AccessHistoryRetentionDays != nil {
		retention = strconv.Itoa(int(*ent.AccessHistoryRetentionDays))
	}
	return []corev1.EnvVar{
		fromSecret("STIGMER_LICENSE_KEY", ent.License.Name, ent.License.Key, false),
		value("STIGMER_OUTBOUND_EGRESS", egress),
		value("STIGMER_ORGANIZATION_CREATORS", strings.Join(ent.OrganizationCreators, ",")),
		value("STIGMER_ACCESS_HISTORY_RETENTION_DAYS", retention),
	}
}

// RunnerEnabled reports whether the shared runner container renders. A
// licensed server may hold several organizations, and one shared runner
// would carry one organization's key into every organization's runs (the
// server refuses STIGMER_RUNNER_API_KEY there), so a licensed install runs
// agents in per-session sandboxes and renders no shared runner.
func RunnerEnabled(st *stigmerv1.Stigmer) bool { return !Licensed(st) }

// RunnerEnv is the shared runner container's environment, before extraEnv.
func RunnerEnv(st *stigmerv1.Stigmer) []corev1.EnvVar {
	t := Temporal(st)
	env := []corev1.EnvVar{
		// local mode: stdio MCP servers are allowed (they spawn inside this
		// container) and the checkpointer is the durable sqlite saver.
		value("MODE", "local"),
		value("STIGMER_BACKEND_ENDPOINT", fmt.Sprintf("http://localhost:%d", GRPCPort)),
		// What a remote MCP server dials back on: the public URL, never the
		// pod-local address above.
		value("STIGMER_MCP_PUBLIC_ENDPOINT", PublicURL(st)),
		value("TEMPORAL_SERVICE_ADDRESS", t.HostPort),
		value("TEMPORAL_NAMESPACE", t.Namespace),
	}
	env = append(env, temporalConnectionEnv(t)...)
	env = append(env,
		value("STIGMER_TASK_QUEUE", RunnerTaskQueue),
		value("WORKSPACE_ROOT_DIR", "/data/.stigmer/data/workspace"),
		value("STIGMER_AGENT_HOME", "/data/agent"),
	)
	if ObjectStore(st) != nil {
		// The server's artifact lane, on the server's own port in this pod:
		// never STIGMER_PROXY_ENDPOINT, which would also send the runner's
		// model calls through the server.
		env = append(env,
			value("ARTIFACT_STORAGE_TYPE", "proxy"),
			value("STIGMER_ARTIFACT_PROXY_ENDPOINT", fmt.Sprintf("http://localhost:%d", GRPCPort)),
		)
	} else {
		env = append(env,
			value("ARTIFACT_STORAGE_TYPE", "local"),
			value("LOCAL_ARTIFACT_PATH", ArtifactsMount),
		)
	}
	if SignInOn(st) {
		env = append(env, fromSecret("STIGMER_TOKEN", RunnerKeySecret(st), RunnerKeyKey, false))
	}
	if llm := st.Spec.Runner.LLM; llm != nil {
		for _, key := range RunnerModelKeys {
			env = append(env, fromSecret(key, llm.SecretName, key, true))
		}
	}
	return env
}

// OwnedEnvNames lists every name the operator may set on the container, in
// any declaration: extraEnv may set none of them.
func OwnedEnvNames(container string) []string {
	full := &stigmerv1.Stigmer{Spec: stigmerv1.StigmerSpec{
		Owner:    &stigmerv1.OwnerSpec{Email: "x@x"},
		Identity: &stigmerv1.IdentitySpec{OIDC: &stigmerv1.OIDCSpec{Issuer: "https://x", Audience: "x", DiscoveryURL: "http://x"}},
		Database: &stigmerv1.DatabaseSpec{PostgreSQL: &stigmerv1.PostgreSQLSpec{External: &stigmerv1.ExternalPostgreSQLSpec{
			Host: "x", User: "x", SSLMode: "require", PasswordSecret: stigmerv1.SecretKeySelector{Name: "x", Key: "x"},
		}}},
		Temporal: &stigmerv1.TemporalSpec{External: &stigmerv1.ExternalTemporalSpec{
			HostPort: "x:1",
			TLS:      &stigmerv1.TemporalTLSSpec{SecretName: "x", ServerName: "x", CAKey: "x", CertKey: "x", KeyKey: "x"},
			APIKey:   &stigmerv1.SecretKeySelector{Name: "x", Key: "x"},
		}},
		Server: stigmerv1.ServerSpec{
			Help:             &stigmerv1.HelpSpec{URL: "x", Label: "x"},
			InternalAccounts: []string{"x"},
		},
		Runner:     stigmerv1.RunnerSpec{LLM: &stigmerv1.LLMSpec{SecretName: "x"}},
		Enterprise: &stigmerv1.EnterpriseSpec{License: &stigmerv1.SecretKeySelector{Name: "x", Key: "x"}},
	}}
	// The volume arm and the bucket arm set different names; both are owned.
	// A licensed install renders no shared runner; the open-source arm sets
	// the runner's key.
	open := full.DeepCopy()
	open.Spec.Enterprise = nil
	bucket := full.DeepCopy()
	bucket.Spec.ObjectStore = &stigmerv1.ObjectStoreSpec{S3: stigmerv1.S3Spec{
		Bucket: "x", Endpoint: "http://x", RunnerEndpoint: "http://x",
		CredentialsSecret: corev1.LocalObjectReference{Name: "x"},
	}}
	var env []corev1.EnvVar
	if container == "runner" {
		env = append(RunnerEnv(full), RunnerEnv(bucket)...)
	} else {
		env = append(append(ServerEnv(full), ServerEnv(bucket)...), ServerEnv(open)...)
	}
	names := make([]string, 0, len(env))
	for _, e := range env {
		names = append(names, e.Name)
	}
	slices.Sort(names)
	return slices.Compact(names)
}

// ExtraEnvConflicts names the first extraEnv entry that repeats a name the
// operator sets, as a sentence, or returns "" when there is none.
func ExtraEnvConflicts(st *stigmerv1.Stigmer) string {
	for _, c := range []struct {
		container, path string
		extra           []corev1.EnvVar
	}{
		{"server", "spec.server.extraEnv", st.Spec.Server.ExtraEnv},
		{"runner", "spec.runner.extraEnv", st.Spec.Runner.ExtraEnv},
	} {
		owned := OwnedEnvNames(c.container)
		for _, e := range c.extra {
			if slices.Contains(owned, e.Name) {
				return fmt.Sprintf("%s sets %s, which the operator sets from the declaration; a second value would silently replace it. "+
					"Declare it through its own field, or remove the entry", c.path, e.Name)
			}
		}
	}
	return ""
}

// userEscape percent-encodes a URL's user part, a space as %20.
func userEscape(user string) string {
	return strings.ReplaceAll(url.QueryEscape(user), "+", "%20")
}
