// Pins the server's side of Agent Substrate: the driver settings it is
// handed (Substrate's in-cluster addresses, its identity files, its atespace
// and the worker selector, the sandboxes' cleartext lanes and their size),
// the identity projected into its pod without the default token, the
// bucket's lane in each of its forms and the addresses refused, the worker
// pool's shape, and the server's fence admitting only Substrate's API and
// router on their ports.

package render

import (
	"slices"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/substrate"
)

func substrateProfile() *stigmerv1.Stigmer {
	st := profiles()["bucket"]
	idle := int32(60)
	cpu, mem := int32(500), int32(512)
	st.Spec.Sandboxes = &stigmerv1.SandboxesSpec{Driver: stigmerv1.SandboxDriverSubstrate, IdleSeconds: &idle,
		Substrate: &stigmerv1.SubstrateSpec{
			Workers: 3,
			Sandbox: stigmerv1.SubstrateSandboxSpec{CPUMillicores: &cpu, MemoryMiB: &mem},
			Egress:  stigmerv1.SubstrateEgressSpec{HTTP: []string{"models.ai.svc.cluster.local:8080"}},
		}}
	return st
}

func TestSubstrateTellsTheServerWhereEverythingIs(t *testing.T) {
	st := substrateProfile()
	env := envMap(ServerEnv(st, nil))
	for name, want := range map[string]string{
		"SANDBOX_PROVISIONER_TYPE":                          "substrate",
		"STIGMER_SANDBOX_SUBSTRATE_API_ENDPOINT":            "https://" + substrate.APIServerName,
		"STIGMER_SANDBOX_SUBSTRATE_ROUTER_URL":              "https://" + substrate.RouterServerName,
		"STIGMER_SANDBOX_SUBSTRATE_API_TOKEN_FILE":          "/var/run/substrate/token",
		"STIGMER_SANDBOX_SUBSTRATE_API_CA_FILE":             "/var/run/substrate/ca.pem",
		"STIGMER_SANDBOX_SUBSTRATE_ROUTER_CLIENT_CERT_FILE": "/var/run/substrate/identity.pem",
		"STIGMER_SANDBOX_SUBSTRATE_ATESPACE":                st.Name,
		"STIGMER_SANDBOX_SUBSTRATE_WORKER_SELECTOR":         SubstratePoolLabel + "=" + SubstratePool(st),
		"STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTP":             "minio.example:9000,models.ai.svc.cluster.local:8080",
		"STIGMER_SANDBOX_SUBSTRATE_SUSPEND_AFTER_SECONDS":   "60",
		"STIGMER_SANDBOX_SUBSTRATE_CPU_MILLICORES":          "500",
		"STIGMER_SANDBOX_SUBSTRATE_MEMORY_MIB":              "512",
		"STIGMER_SANDBOX_BACKEND_ENDPOINT":                  "http://stigmer.stigmer.svc.cluster.local:7234",
	} {
		if got := env[name].Value; got != want {
			t.Errorf("%s = %q; want %q", name, got, want)
		}
	}
}

func TestTheServerCarriesItsSubstrateIdentity(t *testing.T) {
	dep := ServerDeploymentObject(substrateProfile(), nil)
	spec := dep.Spec.Template.Spec
	if spec.AutomountServiceAccountToken == nil || *spec.AutomountServiceAccountToken {
		t.Error("the server is handed its Kubernetes API token, which the substrate driver never uses")
	}
	i := slices.IndexFunc(spec.Volumes, func(v corev1.Volume) bool { return v.Name == "substrate-identity" })
	if i < 0 {
		t.Fatal("no Substrate identity volume")
	}
	sources := spec.Volumes[i].Projected.Sources
	if len(sources) != 3 || sources[0].ServiceAccountToken.Audience != substrate.APIServerName ||
		*sources[1].ClusterTrustBundle.SignerName != substrate.ServiceDNSSigner ||
		sources[2].PodCertificate.SignerName != substrate.PodIdentitySigner {
		t.Errorf("the identity volume projects %+v", sources)
	}
	if spec.ServiceAccountName != ServerServiceAccount(substrateProfile()) {
		t.Errorf("the server runs as %q, the identity Substrate's grants name is %q", spec.ServiceAccountName, ServerServiceAccount(substrateProfile()))
	}
}

func TestTheBucketsLane(t *testing.T) {
	for _, tc := range []struct {
		endpoint, lane, platform, problem string
	}{
		{"http://minio.storage.svc.cluster.local:9000", "minio.storage.svc.cluster.local:9000", "", ""},
		{"http://store.example.com", "store.example.com:80", "", ""},
		{"https://acc.r2.cloudflarestorage.com", "", "acc.r2.cloudflarestorage.com", ""},
		{"", "", "acme.s3.us-east-1.amazonaws.com", ""},
		{"http://10.0.0.5:9000", "", "", "two or more labels"},
		{"http://minio:9000", "", "", "two or more labels"},
	} {
		st := substrateProfile()
		st.Spec.ObjectStore.S3.Bucket = "acme"
		st.Spec.ObjectStore.S3.Region = "us-east-1"
		st.Spec.ObjectStore.S3.Endpoint = tc.endpoint
		st.Spec.ObjectStore.S3.RunnerEndpoint = ""
		lane, platform, problem := SubstrateBucketLane(st)
		if lane != tc.lane || platform != tc.platform || (tc.problem == "") != (problem == "") || !strings.Contains(problem, tc.problem) {
			t.Errorf("%q: lane %q platform %q problem %q", tc.endpoint, lane, platform, problem)
		}
	}
}

func TestThePoolIsTheDeclaredSize(t *testing.T) {
	st := substrateProfile()
	pool := SubstratePoolObject(st, "ghcr.io/x/ateworker-gvisor:v1@sha256:abc")
	if replicas, _, _ := unstructured.NestedInt64(pool.Object, "spec", "replicas"); replicas != 3 {
		t.Errorf("replicas %d, want the declared 3", replicas)
	}
	if pool.GetNamespace() != SandboxNamespace(st) || pool.GetLabels()[SubstratePoolLabel] != SubstratePool(st) {
		t.Errorf("pool %s/%s labelled %v", pool.GetNamespace(), pool.GetName(), pool.GetLabels())
	}
	labels, _, _ := unstructured.NestedStringMap(pool.Object, "spec", "template", "labels")
	if labels[SubstratePoolLabel] != SubstratePool(st) {
		t.Errorf("the workers' labels %v lack the pool label", labels)
	}
	st.Spec.Sandboxes.Substrate.Workers = 0
	if replicas, _, _ := unstructured.NestedInt64(SubstratePoolObject(st, "x").Object, "spec", "replicas"); replicas != 1 {
		t.Errorf("an undeclared size keeps %d workers, want 1", replicas)
	}
}

func TestAFencedServerReachesOnlySubstratesAPIAndRouter(t *testing.T) {
	st := substrateProfile()
	st.Spec.Server.Egress = &stigmerv1.ServerEgressSpec{Fenced: true}
	p := ServerEgressPolicyObject(st, FenceInputs{})
	var ports []int32
	for _, r := range p.Spec.Egress {
		for _, peer := range r.To {
			if peer.NamespaceSelector == nil || peer.NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"] != substrate.Namespace {
				continue
			}
			if peer.PodSelector == nil || len(r.Ports) != 1 {
				t.Errorf("a rule into %s admits every pod or every port: %+v", substrate.Namespace, r)
				continue
			}
			ports = append(ports, r.Ports[0].Port.IntVal)
		}
	}
	slices.Sort(ports)
	if !slices.Equal(ports, []int32{substrate.APIServerPort, substrate.RouterPort}) {
		t.Errorf("the fenced server reaches %s on %v, want the API's and the router's ports", substrate.Namespace, ports)
	}
}
