// Pins what the installer changes in Agent Substrate's files and what it
// leaves: every image pinned by digest, each patch landing once and
// idempotently, a missing anchor failing with its file and object named, the
// API server's settings hash stable across passes, the release steps
// Substrate allows, and the embedded release sharing its major and minor with
// the server's Substrate driver and the Makefile's pin.

package install

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func testSettings() Settings {
	return Settings{
		BootstrapOwners:         []string{"system:serviceaccount:stigmer:stigmer-server"},
		IngressAllowedSPIFFEIDs: []string{"spiffe://cluster.local/ns/stigmer/sa/stigmer-server"},
		SnapshotLocation:        "s3://stigmer/substrate/",
		SnapshotStore: ObjectStore{
			Endpoint: "http://minio.storage.svc.cluster.local:9000", Region: "us-east-1", PathStyle: true,
			AccessKeyID: "id", SecretAccessKey: "secret",
		},
	}
}

func mustEmbedded(t *testing.T) *release {
	t.Helper()
	r, err := embedded()
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// images collects every image a pod template names.
func images(u *unstructured.Unstructured) []string {
	var out []string
	for _, field := range []string{"containers", "initContainers"} {
		list, _, _ := unstructured.NestedSlice(u.Object, "spec", "template", "spec", field)
		for _, c := range list {
			if m, ok := c.(map[string]any); ok {
				if img, ok := m["image"].(string); ok {
					out = append(out, img)
				}
			}
		}
	}
	return out
}

func TestEveryImageIsPinnedByDigest(t *testing.T) {
	r := mustEmbedded(t)
	objs, err := Objects()
	if err != nil {
		t.Fatal(err)
	}
	plane, err := controlPlaneObjects(r, testSettings(), "hash")
	if err != nil {
		t.Fatal(err)
	}
	pinned := regexp.MustCompile(`^[a-z0-9./-]+(:[a-z0-9.-]+)?@sha256:[0-9a-f]{64}$`)
	count := 0
	for _, u := range append(objs, plane...) {
		for _, img := range images(u) {
			count++
			if !pinned.MatchString(img) {
				t.Errorf("%s %s runs %q, not an image pinned by digest", u.GetKind(), u.GetName(), img)
			}
		}
	}
	if count == 0 {
		t.Fatal("found no images")
	}
	worker, err := WorkerImage()
	if err != nil || !pinned.MatchString(worker) || !strings.Contains(worker, "/ateworker-gvisor:") {
		t.Fatalf("WorkerImage = %q, %v", worker, err)
	}
}

func containerArgs(t *testing.T, objs []*unstructured.Unstructured, kind, name, ctr string) []string {
	t.Helper()
	u, err := find(objs, kind, name)
	if err != nil {
		t.Fatal(err)
	}
	var args []string
	if err := container(u, ctr, false, func(c map[string]any) error {
		args, _, _ = unstructured.NestedStringSlice(c, "args")
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return args
}

func countPrefix(args []string, prefix string) int {
	n := 0
	for _, a := range args {
		if strings.HasPrefix(a, prefix) {
			n++
		}
	}
	return n
}

func TestControlPlanePatchesLandOnceAndIdempotently(t *testing.T) {
	r := mustEmbedded(t)
	s := testSettings()
	s.LocalhostRegistryReplacement = "kind-registry:5000"
	objs, err := controlPlaneObjects(r, s, "abc")
	if err != nil {
		t.Fatal(err)
	}
	// A second pass over the same objects changes nothing.
	for _, patch := range []func() error{
		func() error { return patchAPIServer(objs, s, "abc") },
		func() error { return patchIDPServer(objs) },
		func() error { return patchRouter(objs, s) },
	} {
		if err := patch(); err != nil {
			t.Fatal(err)
		}
	}

	api := containerArgs(t, objs, "Deployment", "ate-api-server", "ate-api-server")
	if !slices.Contains(api, "--authz-bootstrap-owners=system:serviceaccount:stigmer:stigmer-server") || countPrefix(api, "--authz-bootstrap-owners") != 1 {
		t.Errorf("API server args %v: want one bootstrap owners flag naming the server", api)
	}
	idp := containerArgs(t, objs, "Deployment", "ate-idp-server", "ate-idp-server")
	if !slices.Contains(idp, "--issuer="+ActorJWTIssuer) || countPrefix(idp, "--issuer") != 1 {
		t.Errorf("identity server args %v: want one issuer", idp)
	}
	router := containerArgs(t, objs, "Deployment", "atenet-router", "atenet-router")
	if !slices.Contains(router, "--ingress-allowed-spiffe-ids=spiffe://cluster.local/ns/stigmer/sa/stigmer-server") || countPrefix(router, "--ingress-allowed-spiffe-ids") != 1 {
		t.Errorf("router args %v: want the server's SPIFFE ID once", router)
	}

	dep, _ := find(objs, "Deployment", "ate-api-server")
	if got, _, _ := unstructured.NestedString(dep.Object, "spec", "template", "metadata", "annotations", envHashAnnotation); got != "abc" {
		t.Errorf("API server env hash = %q, want abc", got)
	}

	atelet := containerArgs(t, objs, "DaemonSet", "atelet", "atelet")
	if countPrefix(atelet, "--image-credential-provider") != 0 {
		t.Errorf("atelet args %v keep the credential provider", atelet)
	}
	if !slices.Contains(atelet, "--localhost-registry-replacement=kind-registry:5000") {
		t.Errorf("atelet args %v: want the development registry", atelet)
	}
	ds, _ := find(objs, "DaemonSet", "atelet")
	raw := toYAML(t, ds)
	for _, gone := range []string{"/home/kubernetes/bin", "cri_auth_config", "cloud.google.com/compute-class"} {
		if strings.Contains(raw, gone) {
			t.Errorf("atelet still names %s", gone)
		}
	}
	for _, kind := range []string{"Deployment", "DaemonSet"} {
		name := map[string]string{"Deployment": "ate-api-server", "DaemonSet": "atelet"}[kind]
		u, _ := find(objs, kind, name)
		if err := container(u, "objectstore-plugin", true, func(c map[string]any) error {
			env := toYAMLValue(t, c["env"])
			for _, want := range []string{"ATE_STORAGE_BACKEND", "value: s3", "AWS_ENDPOINT_URL", SnapshotStoreSecret} {
				if !strings.Contains(env, want) {
					t.Errorf("%s %s object-store sidecar env lacks %s", kind, name, want)
				}
			}
			if strings.Contains(env, "gcs") {
				t.Errorf("%s %s object-store sidecar still selects GCS", kind, name)
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestARealClusterGetsNoDevelopmentRegistry(t *testing.T) {
	objs, err := controlPlaneObjects(mustEmbedded(t), testSettings(), "abc")
	if err != nil {
		t.Fatal(err)
	}
	if args := containerArgs(t, objs, "DaemonSet", "atelet", "atelet"); countPrefix(args, "--localhost-registry-replacement") != 0 {
		t.Errorf("atelet args %v name a development registry no one declared", args)
	}
}

func TestPostgresMakesItsOwnRoles(t *testing.T) {
	objs, err := mustEmbedded(t).objects(filePostgres)
	if err != nil {
		t.Fatal(err)
	}
	if err := patchPostgres(objs); err != nil {
		t.Fatal(err)
	}
	raw := toYAML(t, objs[len(objs)-1])
	for _, want := range []string{"storage: " + postgresClaim, "createdb", "-f /etc/postgresql-setup/setup.sql", "--single-transaction",
		"substrate_readwrite_user=" + postgresReadWriteUser, "name: " + postgresSetupConfigMap} {
		if !strings.Contains(raw, want) {
			t.Errorf("patched StatefulSet lacks %q", want)
		}
	}
}

func TestAMovedAnchorFailsNamingIt(t *testing.T) {
	src := mustEmbedded(t)
	files := fstest.MapFS{}
	for _, name := range []string{fileImages, fileAtelet} {
		b, err := readRelease(src, name)
		if err != nil {
			t.Fatal(err)
		}
		files[name] = &fstest.MapFile{Data: b}
	}
	files[fileAtelet].Data = []byte(strings.ReplaceAll(string(files[fileAtelet].Data), "--image-credential-provider-bin-dir", "--renamed-flag"))
	r, err := loadRelease(files)
	if err != nil {
		t.Fatal(err)
	}
	objs, err := r.objects(fileAtelet)
	if err != nil {
		t.Fatal(err)
	}
	err = patchAtelet(objs, testSettings())
	if err == nil || !strings.Contains(err.Error(), "DaemonSet atelet") || !strings.Contains(err.Error(), "--image-credential-provider-bin-dir") {
		t.Fatalf("patchAtelet over a moved flag = %v, want an error naming the DaemonSet and the flag", err)
	}
}

func TestAnImageWithNoPinIsRefused(t *testing.T) {
	r, err := loadRelease(fstest.MapFS{fileImages: {Data: []byte("version: v1.0.1\nimages:\n  atelet: ghcr.io/x/atelet:v1.0.1@sha256:" + strings.Repeat("0", 64) + "\n")}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.pinImages("x.yaml", []byte("image: ko://go.ate.dev/substrate/cmd/ateapi\n"))
	if err == nil || !strings.Contains(err.Error(), "ateapi") {
		t.Fatalf("pinImages = %v, want a refusal naming ateapi", err)
	}
}

func TestEnvHashIsStableAndSeesEveryChange(t *testing.T) {
	r := mustEmbedded(t)
	km := keyMaterial{actorIDRoot: []byte("root")}
	a, err := configObjects(r, testSettings(), km, "https://kubernetes.default.svc.cluster.local")
	if err != nil {
		t.Fatal(err)
	}
	b, err := configObjects(r, testSettings(), km, "https://kubernetes.default.svc.cluster.local")
	if err != nil {
		t.Fatal(err)
	}
	if a.envHash != b.envHash {
		t.Fatal("the same settings hash differently")
	}
	moved := testSettings()
	moved.SnapshotLocation = "s3://elsewhere/substrate/"
	c, err := configObjects(r, moved, km, "https://kubernetes.default.svc.cluster.local")
	if err != nil {
		t.Fatal(err)
	}
	if c.envHash == a.envHash {
		t.Fatal("a new snapshot location kept the hash, so the API server would not restart")
	}
	d, err := configObjects(r, testSettings(), km, "https://oidc.example.com")
	if err != nil {
		t.Fatal(err)
	}
	if d.envHash == a.envHash {
		t.Fatal("a new issuer kept the hash")
	}
}

func TestAuthenticationTrustsTheClustersIssuer(t *testing.T) {
	inCluster, err := authenticationConfig("https://kubernetes.default.svc.cluster.local")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"name: kubernetes", "- " + APIServerName, "certificateAuthorityFile:", "discoveryTokenFile:"} {
		if !strings.Contains(inCluster, want) {
			t.Errorf("in-cluster authentication lacks %q:\n%s", want, inCluster)
		}
	}
	public, err := authenticationConfig("https://oidc.eks.example.com/id/X")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(public, "discoveryTokenFile") {
		t.Errorf("a public issuer is read with the pod's token:\n%s", public)
	}
}

func TestUpgradeSteps(t *testing.T) {
	for _, tc := range []struct {
		from, to string
		ok       bool
	}{
		{"v1.0.1", "v1.0.1", true},
		{"v1.0.0", "v1.0.9", true},
		{"v1.0.9", "v1.1.0", true},
		{"v1.1.0", "v1.0.3", true},
		{"v1.0.1", "v1.2.0", false},
		{"v1.3.0", "v1.1.0", false},
		{"v1.4.0", "v2.0.0", false},
		{"main", "v1.0.1", false},
	} {
		if got := upgradeProblem(tc.from, tc.to); (got == "") != tc.ok {
			t.Errorf("upgradeProblem(%s, %s) = %q, want ok=%v", tc.from, tc.to, got, tc.ok)
		}
	}
}

// repoRoot is the stigmer repository, from this package's directory.
func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs("../../../../..")
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func TestTheReleaseMatchesTheServerAndTheMakefile(t *testing.T) {
	version, err := Version()
	if err != nil {
		t.Fatal(err)
	}
	major, minor, ok := majorMinor(version)
	if !ok {
		t.Fatalf("embedded release %q is not a version", version)
	}
	server, err := os.ReadFile(filepath.Join(repoRoot(t), "backend/services/stigmer-server/src/sandbox/substrate/release.ts"))
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`SUBSTRATE_RELEASE\s*=\s*"(v[0-9.]+)"`).FindSubmatch(server)
	if m == nil {
		t.Fatal("release.ts has no SUBSTRATE_RELEASE")
	}
	if smaj, smin, _ := majorMinor(string(m[1])); smaj != major || smin != minor {
		t.Fatalf("the operator installs Agent Substrate %s and the server speaks %s: their major and minor must match", version, m[1])
	}
	makefile, err := os.ReadFile(filepath.Join(repoRoot(t), "deploy/operator/Makefile"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(makefile), "SUBSTRATE_VERSION := "+version+"\n") {
		t.Fatalf("the Makefile does not pin SUBSTRATE_VERSION to the embedded %s: run make vendor-substrate", version)
	}
}
