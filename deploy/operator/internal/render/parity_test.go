// Pins the operator's server and runner settings to docker-compose.yml, the
// canonical topology, name for name.
//
// Compose's value forms decide what the operator must render: `${X:?...}`
// (required) must be a Secret reference, and one the operator mints is read
// from its keys Secret under Compose's own name X; `${X:-}` (optional, empty
// default) may be absent, a reference or a value; `${X:-default}` and plain
// values must equal the operator's after the address table, which maps each
// Compose address to where the same thing lives in a cluster. A name the
// operator renders that Compose does not carry fails unless it is declared
// below, with the reason and the profiles that render it: each of those
// must, and no other may. The images are held to Compose's too: the server's
// and runner's repositories, every Temporal image the embedded chart renders
// (containers and init containers) at Compose's one Temporal release,
// Postgres's release, each an exact release; and the default namespace's
// retention. A pull request that adds a Compose setting the operator does
// not render fails here.

package render

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/yaml"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/helmrender"
	"github.com/stigmer/stigmer/deploy/operator/internal/manifests"
)

type composeService struct {
	Image       string            `json:"image"`
	Environment map[string]string `json:"environment"`
	Command     []string          `json:"command"`
}

type composeFile struct {
	Services map[string]composeService `json:"services"`
}

func readCompose(t *testing.T) composeFile {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "docker-compose.yml"))
	if err != nil {
		t.Fatalf("reading docker-compose.yml: %v", err)
	}
	var c composeFile
	if err := yaml.Unmarshal(data, &c); err != nil {
		t.Fatalf("parsing docker-compose.yml: %v", err)
	}
	return c
}

// The profiles the parity holds for, each a Stigmer an adopter could write.
func profiles() map[string]*stigmerv1.Stigmer {
	base := func() *stigmerv1.Stigmer {
		return &stigmerv1.Stigmer{
			ObjectMeta: metav1.ObjectMeta{Name: "stigmer", Namespace: "stigmer"},
			Spec: stigmerv1.StigmerSpec{
				Owner:  &stigmerv1.OwnerSpec{Email: "owner@example.com", Name: "Owner"},
				Runner: stigmerv1.RunnerSpec{LLM: &stigmerv1.LLMSpec{SecretName: "anthropic"}},
			},
		}
	}
	bundled := base()
	byo := base()
	byo.Spec.Database = &stigmerv1.DatabaseSpec{PostgreSQL: &stigmerv1.PostgreSQLSpec{External: &stigmerv1.ExternalPostgreSQLSpec{
		Host: "db.internal", Port: 5432, User: "stigmer app", Database: "stigmer", SSLMode: "require",
		PasswordSecret: stigmerv1.SecretKeySelector{Name: "db", Key: "password"},
	}}}
	byo.Spec.Temporal = &stigmerv1.TemporalSpec{External: &stigmerv1.ExternalTemporalSpec{
		HostPort: "temporal.internal:7233", Namespace: "stigmer",
		TLS:    &stigmerv1.TemporalTLSSpec{SecretName: "temporal-tls", ServerName: "temporal", CAKey: "ca.crt", CertKey: "tls.crt", KeyKey: "tls.key"},
		APIKey: &stigmerv1.SecretKeySelector{Name: "temporal-key", Key: "key"},
	}}
	oidc := base()
	oidc.Spec.Identity = &stigmerv1.IdentitySpec{OIDC: &stigmerv1.OIDCSpec{
		Issuer: "https://issuer.example.com", Audience: "https://stigmer.example.com",
		ConsoleClientID: "console", NativeClientID: "native",
	}}
	oidc.Spec.Server.Help = &stigmerv1.HelpSpec{URL: "https://help.example.com", Label: "Ask"}
	oidc.Spec.Server.InternalAccounts = []string{"*@example.com"}
	enterprise := oidc.DeepCopy()
	days := int32(365)
	enterprise.Spec.Enterprise = &stigmerv1.EnterpriseSpec{
		License:                    &stigmerv1.SecretKeySelector{Name: "license", Key: "STIGMER_LICENSE_KEY"},
		OrganizationCreators:       []string{"ida_01jq3v8k6m2n4p5r7s9t0v1w2x"},
		AccessHistoryRetentionDays: &days,
	}
	bucket := base()
	bucket.Spec.ObjectStore = &stigmerv1.ObjectStoreSpec{S3: stigmerv1.S3Spec{
		Bucket: "acme-stigmer", Region: "eu-west-1", Endpoint: "http://minio.storage:9000",
		RunnerEndpoint: "http://minio.example:9000", CredentialsSecret: corev1.LocalObjectReference{Name: "bucket"},
	}}
	exposed := base()
	exposed.Spec.Ingress = &stigmerv1.IngressSpec{
		Hostname: "stigmer.example.com",
		TLS:      &stigmerv1.IngressTLSSpec{Issuer: &stigmerv1.IssuerReference{Name: "letsencrypt", Kind: "ClusterIssuer"}},
	}
	exposed.Spec.Identity = &stigmerv1.IdentitySpec{Bundled: &stigmerv1.BundledIdentitySpec{}}
	fenced := base()
	fenced.Spec.Server.Egress = &stigmerv1.ServerEgressSpec{Fenced: true}
	return map[string]*stigmerv1.Stigmer{
		"bundled": bundled, "byo": byo, "oidc": oidc, "enterprise": enterprise, "bucket": bucket, "exposed": exposed, "fenced": fenced,
	}
}

// operatorOnly are names the operator renders that Compose does not carry,
// each with its reason and the profiles that render it, in either container.
type operatorOnlyName struct {
	reason   string
	profiles []string
}

// runnerProfiles are the profiles that run the shared runner with a model
// Secret: every one but the licensed.
var runnerProfiles = []string{"bundled", "byo", "oidc", "bucket", "exposed", "fenced"}

var operatorOnly = map[string]operatorOnlyName{
	"PGSSLMODE":                                {"the external database's declared sslmode; Compose's Postgres is on its own network", []string{"byo"}},
	"STIGMER_TEMPORAL_TLS":                     {"TLS to an external Temporal; Compose's Temporal is on its own network", []string{"byo"}},
	"STIGMER_TEMPORAL_TLS_SERVER_NAME":         {"as above", []string{"byo"}},
	"STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_DATA": {"as above", []string{"byo"}},
	"STIGMER_TEMPORAL_TLS_CLIENT_CERT_DATA":    {"as above", []string{"byo"}},
	"STIGMER_TEMPORAL_TLS_CLIENT_KEY_DATA":     {"as above", []string{"byo"}},
	"STIGMER_TEMPORAL_API_KEY":                 {"an external Temporal's API key", []string{"byo"}},
	"STIGMER_LICENSE_KEY":                      {"Stigmer Enterprise; Compose runs the open-source server", []string{"enterprise"}},
	"STIGMER_OUTBOUND_EGRESS":                  {"Stigmer Enterprise", []string{"enterprise"}},
	"STIGMER_ORGANIZATION_CREATORS":            {"Stigmer Enterprise", []string{"enterprise"}},
	"STIGMER_ACCESS_HISTORY_RETENTION_DAYS":    {"Stigmer Enterprise", []string{"enterprise"}},
	"SKILL_ARTIFACT_STORAGE_TYPE":              {"a declared bucket; Compose keeps artifacts and Skills on its volumes", []string{"bucket"}},
	"S3_BUCKET":                                {"as above", []string{"bucket"}},
	"S3_REGION":                                {"as above", []string{"bucket"}},
	"S3_ENDPOINT":                              {"as above", []string{"bucket"}},
	"S3_RUNNER_ENDPOINT":                       {"as above", []string{"bucket"}},
	"S3_ACCESS_KEY_ID":                         {"as above", []string{"bucket"}},
	"S3_SECRET_ACCESS_KEY":                     {"as above", []string{"bucket"}},
	"STIGMER_ARTIFACT_PROXY_ENDPOINT":          {"as above: the runner reaches the bucket through the server's artifact lane", []string{"bucket"}},
	"STIGMER_WEB_FETCH_ALLOW_PRIVATE":          {"the server's egress fence; Compose's runner is not fenced", []string{"fenced"}},
	"OPENAI_API_KEY":                           {"the runner's other model providers, read from the same Secret", runnerProfiles},
	"ANTHROPIC_FOUNDRY_API_KEY":                {"as above", runnerProfiles},
	"AWS_BEARER_TOKEN_BEDROCK":                 {"as above", runnerProfiles},
}

// onVolumeOnly are Compose's names for files on a shared volume, which an
// install with a bucket does not render: the server ignores them when its
// store is the bucket, and the runner's files go through the server.
var onVolumeOnly = map[string]bool{
	"ARTIFACT_LOCAL_BASE_PATH": true,
	"ARTIFACT_LOCAL_SERVE_URL": true,
	"LOCAL_ARTIFACT_PATH":      true,
}

var composeVar = regexp.MustCompile(`^\$\{([A-Z0-9_]+)(:\?[^}]*|:-([^}]*))?\}$`)

// translate maps a Compose value to where the same thing lives for a Stigmer.
func translate(st *stigmerv1.Stigmer, role, name, v string) string {
	db := Database(st)
	t := Temporal(st)
	if name == "ARTIFACT_STORAGE_TYPE" && v == "local" && ObjectStore(st) != nil {
		if role == "runner" {
			return "proxy"
		}
		return "s3"
	}
	switch v {
	case "postgres://postgres@postgres:5432":
		return fmt.Sprintf("postgres://%s@%s:%d", userEscape(db.User), db.Host, db.Port)
	case "temporal:7233":
		return t.HostPort
	case "http://stigmer-server:7234":
		return "http://localhost:7234"
	case "http://localhost:7234":
		// Compose's public URL default; a front door replaces it.
		return PublicURL(st)
	case "http://localhost:7235":
		return ArtifactServeURL(st)
	case "/data/.stigmer/data/artifacts":
		return ArtifactsMount
	}
	if name == "PGDATABASE" || name == "TEMPORAL_NAMESPACE" {
		switch name {
		case "PGDATABASE":
			return db.Database
		default:
			return t.Namespace
		}
	}
	return v
}

func envMap(env []corev1.EnvVar) map[string]corev1.EnvVar {
	out := map[string]corev1.EnvVar{}
	for _, e := range env {
		out[e.Name] = e
	}
	return out
}

func checkParity(t *testing.T, profile, role string, st *stigmerv1.Stigmer, compose map[string]string, rendered []corev1.EnvVar) {
	t.Helper()
	got := envMap(rendered)
	if len(got) != len(rendered) {
		t.Errorf("%s/%s: a name is rendered twice", profile, role)
	}
	for name, raw := range compose {
		e, present := got[name]
		if !present && onVolumeOnly[name] && ObjectStore(st) != nil {
			continue
		}
		m := composeVar.FindStringSubmatch(raw)
		switch {
		case m != nil && strings.HasPrefix(m[2], ":?"):
			if !present || e.ValueFrom == nil || e.ValueFrom.SecretKeyRef == nil {
				t.Errorf("%s/%s: %s is required in Compose; the operator must reference it from a Secret", profile, role, name)
				continue
			}
			// A key the operator mints lives in its keys Secret under
			// Compose's own name; the database's password is the database's
			// Secret's (CloudNativePG's, or the adopter's), named by them.
			if ref := e.ValueFrom.SecretKeyRef; ref.Name == KeysSecret(st) && ref.Key != m[1] {
				t.Errorf("%s/%s: %s reads key %q of the keys Secret; Compose names it %s", profile, role, name, ref.Key, m[1])
			}
		case m != nil && m[2] == ":-":
			// Optional: absent, a reference, or a value.
		case m != nil:
			want := translate(st, role, name, m[3])
			if !present || e.Value != want {
				t.Errorf("%s/%s: %s = %q, want Compose's default %q", profile, role, name, e.Value, want)
			}
		default:
			want := translate(st, role, name, raw)
			if !present || e.Value != want {
				t.Errorf("%s/%s: %s = %q, want %q (Compose: %q)", profile, role, name, e.Value, want, raw)
			}
		}
	}
	for name := range got {
		if _, inCompose := compose[name]; inCompose {
			continue
		}
		extra, declared := operatorOnly[name]
		switch {
		case !declared:
			t.Errorf("%s/%s: %s is rendered but Compose has no such setting; add it to docker-compose.yml, or declare why in operatorOnly", profile, role, name)
		case !slices.Contains(extra.profiles, profile):
			t.Errorf("%s/%s: %s is rendered, but operatorOnly declares it for %v only", profile, role, name, extra.profiles)
		}
	}
}

func TestServerAndRunnerSettingsMatchCompose(t *testing.T) {
	c := readCompose(t)
	server, runner := c.Services["stigmer-server"], c.Services["stigmer-runner"]
	if len(server.Environment) == 0 || len(runner.Environment) == 0 {
		t.Fatal("docker-compose.yml has no stigmer-server or stigmer-runner environment")
	}
	for name, st := range profiles() {
		checkParity(t, name, "server", st, server.Environment, ServerEnv(st, nil))
		if RunnerEnabled(st) {
			checkParity(t, name, "runner", st, runner.Environment, RunnerEnv(st))
		}
	}
}

func TestTaskQueueIsOneValueOnBothSides(t *testing.T) {
	c := readCompose(t)
	if got := c.Services["stigmer-server"].Environment["TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE"]; got != RunnerTaskQueue {
		t.Errorf("Compose's server queue is %q, the operator's %q", got, RunnerTaskQueue)
	}
	if got := c.Services["stigmer-runner"].Environment["STIGMER_TASK_QUEUE"]; got != RunnerTaskQueue {
		t.Errorf("Compose's runner queue is %q, the operator's %q", got, RunnerTaskQueue)
	}
}

func repository(image string) string {
	// Compose's tag is an interpolation (${STIGMER_VERSION:-v0.2.0}) that
	// carries a colon of its own.
	if i := strings.Index(image, ":${"); i >= 0 {
		return image[:i]
	}
	if i := strings.LastIndex(image, ":"); i > strings.LastIndex(image, "/") {
		return image[:i]
	}
	return image
}

func tag(image string) string { return strings.TrimPrefix(image, repository(image)+":") }

// release is an exact release tag: X.Y or X.Y.Z, never a moving name.
var release = regexp.MustCompile(`^\d+\.\d+(\.\d+)?$`)

func TestImagesMatchCompose(t *testing.T) {
	c := readCompose(t)
	st := profiles()["bundled"]
	for _, image := range []string{PostgresImage, c.Services["postgres"].Image} {
		if !release.MatchString(tag(image)) {
			t.Errorf("%s is not pinned to an exact release", image)
		}
	}
	if got, want := repository(ServerImage(st)), repository(c.Services["stigmer-server"].Image); got != want {
		t.Errorf("server image %s, Compose's %s", got, want)
	}
	if got, want := repository(RunnerImage(st)), repository(c.Services["stigmer-runner"].Image); got != want {
		t.Errorf("runner image %s, Compose's %s", got, want)
	}
	if got, want := tag(PostgresImage), tag(c.Services["postgres"].Image); got != want {
		t.Errorf("Postgres %s, Compose's %s", got, want)
	}

	chart, _, err := manifests.TemporalChart()
	if err != nil {
		t.Fatal(err)
	}
	objs, err := helmrender.Render(chart, st.Name, st.Namespace, TemporalValues(st))
	if err != nil {
		t.Fatalf("rendering Temporal: %v", err)
	}
	// Compose runs one Temporal release across its server and admin tools.
	wantTemporal := tag(c.Services["temporal"].Image)
	if !release.MatchString(wantTemporal) {
		t.Errorf("Compose's Temporal %s is not an exact release", wantTemporal)
	}
	for name, svc := range c.Services {
		if strings.HasPrefix(svc.Image, "temporalio/") && tag(svc.Image) != wantTemporal {
			t.Errorf("Compose's %s runs %s; its Temporal is %s", name, svc.Image, wantTemporal)
		}
	}
	seen := 0
	for _, o := range objs {
		for _, field := range []string{"containers", "initContainers"} {
			containers, _, _ := unstructured.NestedSlice(o.Object, "spec", "template", "spec", field)
			for _, ct := range containers {
				image, _ := ct.(map[string]any)["image"].(string)
				if strings.HasPrefix(image, "temporalio/") {
					seen++
					if tag(image) != wantTemporal {
						t.Errorf("%s %s runs %s; Compose runs Temporal %s", o.GetKind(), o.GetName(), image, wantTemporal)
					}
				}
			}
		}
	}
	if seen == 0 {
		t.Error("the Temporal render runs no temporalio image")
	}
}

func TestTemporalRetentionMatchesCompose(t *testing.T) {
	c := readCompose(t)
	script := strings.Join(c.Services["temporal-namespace"].Command, "\n")
	if !strings.Contains(script, "--retention "+TemporalRetention) {
		t.Errorf("Compose's temporal-namespace does not register retention %s", TemporalRetention)
	}
}

func TestOperatorOnlyNamesAreRenderedWhereDeclared(t *testing.T) {
	all := profiles()
	for name, extra := range operatorOnly {
		for _, profile := range extra.profiles {
			st, known := all[profile]
			if !known {
				t.Errorf("operatorOnly declares %s for profile %q, which does not exist", name, profile)
				continue
			}
			env := ServerEnv(st, nil)
			if RunnerEnabled(st) {
				env = append(env, RunnerEnv(st)...)
			}
			if !slices.ContainsFunc(env, func(e corev1.EnvVar) bool { return e.Name == name }) {
				t.Errorf("operatorOnly declares %s for %s, which does not render it", name, profile)
			}
		}
	}
}
