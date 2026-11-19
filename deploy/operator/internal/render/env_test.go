// Pins the settings rules parity cannot see: extraEnv may not repeat a name
// the operator sets, in any declaration; the runner is held back under
// sign-in; secrets are always referenced, never copied in; a database user
// is escaped into the URL; sizing refuses what cannot run, in words naming
// the field; and a declared bucket replaces the artifacts volume, the runner
// reaching it through the server's lane and never holding its keys.

package render

import (
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
)

func TestExtraEnvMayNotRepeatAnOwnedName(t *testing.T) {
	st := profiles()["bundled"]
	st.Spec.Server.ExtraEnv = []corev1.EnvVar{{Name: "STIGMER_OIDC_ISSUER", Value: ""}}
	if msg := ExtraEnvConflicts(st); !strings.Contains(msg, "spec.server.extraEnv sets STIGMER_OIDC_ISSUER") {
		t.Errorf("an extraEnv entry that would turn sign-in off was not refused: %q", msg)
	}
	st.Spec.Server.ExtraEnv = []corev1.EnvVar{{Name: "STIGMER_LOG_LEVEL", Value: "debug"}}
	st.Spec.Runner.ExtraEnv = []corev1.EnvVar{{Name: "STIGMER_TOKEN", Value: "x"}}
	if msg := ExtraEnvConflicts(st); !strings.Contains(msg, "spec.runner.extraEnv sets STIGMER_TOKEN") {
		t.Errorf("the runner's reserved key name was not refused: %q", msg)
	}
	st.Spec.Runner.ExtraEnv = nil
	if msg := ExtraEnvConflicts(st); msg != "" {
		t.Errorf("a setting the operator does not own was refused: %q", msg)
	}
}

func TestRunnerIsHeldBackUnderSignIn(t *testing.T) {
	if !RunnerEnabled(profiles()["bundled"]) {
		t.Error("the runner does not run without sign-in")
	}
	st := profiles()["oidc"]
	if RunnerEnabled(st) {
		t.Error("the runner runs under sign-in with no key")
	}
	d := ServerDeploymentObject(st)
	if n := len(d.Spec.Template.Spec.Containers); n != 1 {
		t.Errorf("the server's pod holds %d containers under sign-in; want the server alone", n)
	}
}

func TestSecretsAreReferencedNeverCopied(t *testing.T) {
	for name, st := range profiles() {
		for _, e := range append(ServerEnv(st), RunnerEnv(st)...) {
			if strings.HasSuffix(e.Name, "_KEY") || strings.Contains(e.Name, "PASSWORD") || strings.HasSuffix(e.Name, "_DATA") {
				if e.Value != "" || e.ValueFrom == nil || e.ValueFrom.SecretKeyRef == nil {
					t.Errorf("%s: %s is not a Secret reference", name, e.Name)
				}
			}
		}
	}
}

func TestDatabaseUserIsEscaped(t *testing.T) {
	st := profiles()["byo"]
	for _, e := range ServerEnv(st) {
		if e.Name == "DATABASE_URL" && e.Value != "postgres://stigmer%20app@db.internal:5432" {
			t.Errorf("DATABASE_URL = %q", e.Value)
		}
	}
}

func TestBundledDatabaseUsesItsOwnRoleNotTheSuperuser(t *testing.T) {
	db := Database(profiles()["bundled"])
	if db.User != PostgresAppUser || db.Password.Name != "stigmer-postgres-app" {
		t.Errorf("the server connects as %s with %s", db.User, db.Password.Name)
	}
}

func TestSizingRefusesWhatCannotRun(t *testing.T) {
	st := profiles()["bundled"]
	if msg := SizingRefusal(st); msg != "" {
		t.Fatalf("the defaults are refused: %s", msg)
	}
	st.Spec.Server.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("3Gi")},
	}
	if msg := SizingRefusal(st); !strings.Contains(msg, "spec.server.resources requests 3Gi memory, more than its limit of 2Gi") {
		t.Errorf("a request above the default limit: %q", msg)
	}
	st.Spec.Server.Resources = &corev1.ResourceRequirements{
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("128Mi")},
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("128Mi")},
	}
	if msg := SizingRefusal(st); !strings.Contains(msg, "below the 512Mi it needs to boot") {
		t.Errorf("a limit below the floor: %q", msg)
	}
	st.Spec.Server.Resources = &corev1.ResourceRequirements{
		Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("3Gi")},
	}
	eff := ServerSizing.Effective(st.Spec.Server.Resources)
	if eff.Requests.Memory().String() != "1Gi" || eff.Limits.Memory().String() != "3Gi" {
		t.Errorf("an override does not merge per resource: %v", eff)
	}
}

func TestEnterpriseRunsTheEnterpriseImage(t *testing.T) {
	if got := ServerImage(profiles()["enterprise"]); !strings.Contains(got, "/stigmer-server-ee:") {
		t.Errorf("a licensed server runs %s", got)
	}
	if got := ServerImage(profiles()["bundled"]); !strings.Contains(got, "/stigmer-server:") {
		t.Errorf("an open-source server runs %s", got)
	}
	st := profiles()["bundled"]
	st.Spec.Image.Registry = "mirror.example.com/stigmer"
	if got := RunnerImage(st); !strings.HasPrefix(got, "mirror.example.com/stigmer/stigmer-runner:") {
		t.Errorf("a mirror is not used: %s", got)
	}
}

func TestEveryObjectIsLabelledAsTheOperators(t *testing.T) {
	st := profiles()["bundled"]
	check := func(kind string, labels map[string]string) {
		if labels[ManagedByLabel] != ManagedByValue || labels[InstanceLabel] != st.Name {
			t.Errorf("%s is not labelled as the operator's: %v", kind, labels)
		}
	}
	check("Deployment", ServerDeploymentObject(st).Labels)
	check("pod template", ServerDeploymentObject(st).Spec.Template.Labels)
	check("Service", ServerServiceObject(st).Labels)
	for _, c := range ServerClaims(st) {
		check("claim "+c.Name, c.Labels)
	}
	check("Cluster", PostgresClusterObject(st, ClusterBackup{}).GetLabels())
}

func TestABucketReplacesTheArtifactsVolume(t *testing.T) {
	st := profiles()["bucket"]
	for _, c := range ServerClaims(st) {
		if c.Name == ArtifactsClaim(st) {
			t.Error("the artifacts claim is rendered with a bucket declared")
		}
	}
	d := ServerDeploymentObject(st)
	for _, v := range d.Spec.Template.Spec.Volumes {
		if v.Name == "artifacts" {
			t.Error("the pod mounts the artifacts volume with a bucket declared")
		}
	}
	server := envMap(ServerEnv(st))
	for name, want := range map[string]string{
		"ARTIFACT_STORAGE_TYPE": "s3", "SKILL_ARTIFACT_STORAGE_TYPE": "s3", "S3_BUCKET": "acme-stigmer",
		"S3_REGION": "eu-west-1", "S3_ENDPOINT": "http://minio.storage:9000", "S3_RUNNER_ENDPOINT": "http://minio.example:9000",
	} {
		if got := server[name].Value; got != want {
			t.Errorf("server %s = %q, want %q", name, got, want)
		}
	}
	for _, name := range []string{"S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"} {
		ref := server[name].ValueFrom
		if ref == nil || ref.SecretKeyRef == nil || ref.SecretKeyRef.Name != "bucket" {
			t.Errorf("server %s is not read from the credentials Secret", name)
		}
	}
	runner := envMap(RunnerEnv(st))
	if runner["ARTIFACT_STORAGE_TYPE"].Value != "proxy" || runner["STIGMER_ARTIFACT_PROXY_ENDPOINT"].Value != "http://localhost:7234" {
		t.Errorf("the runner does not reach files through the server's lane: %v", runner["STIGMER_ARTIFACT_PROXY_ENDPOINT"])
	}
	for name := range runner {
		if strings.HasPrefix(name, "S3_") || name == "STIGMER_PROXY_ENDPOINT" {
			t.Errorf("the runner is handed %s", name)
		}
	}
	st.Spec.ObjectStore.S3.Region = ""
	if got := envMap(ServerEnv(st))["S3_REGION"].Value; got != "us-east-1" {
		t.Errorf("a bucket declared without a region is signed for %q, want us-east-1", got)
	}
}
