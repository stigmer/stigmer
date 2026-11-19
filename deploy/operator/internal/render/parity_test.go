// Pins the operator's server and runner settings to docker-compose.yml, the
// canonical topology, name for name.
//
// Compose's value forms decide what the operator must render: `${X:?...}`
// (required) must be a Secret reference; `${X:-}` (optional, empty default)
// may be absent, a reference or a value; `${X:-default}` and plain values
// must equal the operator's after the address table, which maps each Compose
// address to where the same thing lives in a cluster. A name the operator
// renders that Compose does not carry fails unless it is declared below,
// with the reason. The images are held to Compose's too: the server's and
// runner's repositories, Temporal's server image (through a render of the
// embedded chart), Postgres's exact release, and the default namespace's
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
	return map[string]*stigmerv1.Stigmer{"bundled": bundled, "byo": byo, "oidc": oidc, "enterprise": enterprise}
}

// operatorOnly are names the operator renders that Compose does not carry,
// each with its reason.
var operatorOnly = map[string]string{
	"PGSSLMODE":                                "the external database's declared sslmode; Compose's Postgres is on its own network",
	"STIGMER_TEMPORAL_TLS":                     "TLS to an external Temporal; Compose's Temporal is on its own network",
	"STIGMER_TEMPORAL_TLS_SERVER_NAME":         "as above",
	"STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_DATA": "as above",
	"STIGMER_TEMPORAL_TLS_CLIENT_CERT_DATA":    "as above",
	"STIGMER_TEMPORAL_TLS_CLIENT_KEY_DATA":     "as above",
	"STIGMER_TEMPORAL_API_KEY":                 "an external Temporal's API key",
	"STIGMER_LICENSE_KEY":                      "Stigmer Enterprise; Compose runs the open-source server",
	"STIGMER_OUTBOUND_EGRESS":                  "Stigmer Enterprise",
	"STIGMER_ORGANIZATION_CREATORS":            "Stigmer Enterprise",
	"STIGMER_ACCESS_HISTORY_RETENTION_DAYS":    "Stigmer Enterprise",
	"OPENAI_API_KEY":                           "the runner's other model providers, read from the same Secret",
	"ANTHROPIC_FOUNDRY_API_KEY":                "as above",
	"AWS_BEARER_TOKEN_BEDROCK":                 "as above",
}

var composeVar = regexp.MustCompile(`^\$\{([A-Z0-9_]+)(:\?[^}]*|:-([^}]*))?\}$`)

// translate maps a Compose value to where the same thing lives for a Stigmer.
func translate(st *stigmerv1.Stigmer, name, v string) string {
	db := Database(st)
	t := Temporal(st)
	switch v {
	case "postgres://postgres@postgres:5432":
		return fmt.Sprintf("postgres://%s@%s:%d", userEscape(db.User), db.Host, db.Port)
	case "temporal:7233":
		return t.HostPort
	case "http://stigmer-server:7234":
		return "http://localhost:7234"
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
		m := composeVar.FindStringSubmatch(raw)
		switch {
		case m != nil && strings.HasPrefix(m[2], ":?"):
			if !present || e.ValueFrom == nil || e.ValueFrom.SecretKeyRef == nil {
				t.Errorf("%s/%s: %s is required in Compose; the operator must reference it from a Secret", profile, role, name)
			}
		case m != nil && m[2] == ":-":
			// Optional: absent, a reference, or a value.
		case m != nil:
			want := translate(st, name, m[3])
			if !present || e.Value != want {
				t.Errorf("%s/%s: %s = %q, want Compose's default %q", profile, role, name, e.Value, want)
			}
		default:
			want := translate(st, name, raw)
			if !present || e.Value != want {
				t.Errorf("%s/%s: %s = %q, want %q (Compose: %q)", profile, role, name, e.Value, want, raw)
			}
		}
	}
	for name := range got {
		if _, inCompose := compose[name]; inCompose {
			continue
		}
		if _, declared := operatorOnly[name]; !declared {
			t.Errorf("%s/%s: %s is rendered but Compose has no such setting; add it to docker-compose.yml, or declare why in operatorOnly", profile, role, name)
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
		checkParity(t, name, "server", st, server.Environment, ServerEnv(st))
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

func TestImagesMatchCompose(t *testing.T) {
	c := readCompose(t)
	st := profiles()["bundled"]
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
	wantTemporal := tag(c.Services["temporal"].Image)
	seen := 0
	for _, o := range objs {
		containers, _, _ := unstructured.NestedSlice(o.Object, "spec", "template", "spec", "containers")
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

func TestOperatorOnlyNamesAreRendered(t *testing.T) {
	var all []string
	for _, st := range profiles() {
		for _, e := range append(ServerEnv(st), RunnerEnv(st)...) {
			all = append(all, e.Name)
		}
	}
	for name := range operatorOnly {
		if !slices.Contains(all, name) {
			t.Errorf("operatorOnly declares %s, which no profile renders; remove it", name)
		}
	}
}
