// The server's side of Agent Substrate: the settings its substrate driver
// reads, the identity files it is handed, and the worker pool its actors run
// on.
//
// Everything here depends only on Substrate's public contract
// (internal/substrate): the control plane in ate-system, its API and router
// by their in-cluster names, the two podcert signers, and the ate.dev/v1
// WorkerPool. How Substrate got installed (by this operator, by Substrate's
// own installer, by a chart) is not visible from here, so the installer can
// be replaced without touching this file.
//
// The server proves who it is three ways, each a projected volume the
// kubelet keeps fresh (docs/guides/self-hosting/runners.mdx): a service
// account token for the API's audience, the router client certificate the
// podidentity signer issues, and the servicedns trust bundle both of
// Substrate's addresses are served under. The server's namespace must also
// carry ate.dev/api-access=true, which Substrate's own network policy reads.
//
// A sandbox reaches the bucket on its own: the server hands it URLs signed
// for the bucket's runner address (S3_RUNNER_ENDPOINT, else S3_ENDPOINT, else
// AWS), and Substrate's egress gateway lets it out only to what the server
// declares. A cleartext bucket is an EGRESS_HTTP lane; an HTTPS one is a
// platform host, which stays reachable in an environment limited to its own
// hosts (sandbox/substrate/egress.ts).

package render

import (
	"fmt"
	"net"
	"net/url"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/substrate"
)

// SubstrateAccessFieldManager owns the one label the operator sets on the
// Stigmer's namespace, which Substrate's API admits it by. The janitor
// withdraws the label under the same manager, so a label someone else set
// stays.
const SubstrateAccessFieldManager = "stigmer-operator-substrate-access"

// SubstrateWorkerImage is the gVisor worker's image name under Substrate's
// registry.
const SubstrateWorkerImage = "ateworker-gvisor"

// Where the server's Substrate identity is projected.
const (
	substrateMount     = "/var/run/substrate"
	substrateTokenFile = "token"
	substrateCAFile    = "ca.pem"
	substrateCertFile  = "identity.pem"
)

// SubstratePoolLabel is the label the pool's workers carry and the server's
// WORKER_SELECTOR names.
const SubstratePoolLabel = "stigmer-pool"

// SubstratePool is the install's WorkerPool.
func SubstratePool(st *stigmerv1.Stigmer) string { return st.Name }

// SubstrateAtespace is the atespace the server keeps its actors in.
func SubstrateAtespace(st *stigmerv1.Stigmer) string { return st.Name }

// ServerPrincipal is the server's identity in Substrate's authorization:
// its token's subject, as the API writes a user.
func ServerPrincipal(st *stigmerv1.Stigmer) string {
	return substrate.Principal(st.Namespace, ServerServiceAccount(st))
}

// ServerSPIFFEID is the identity the router admits the server's client
// certificate under.
func ServerSPIFFEID(st *stigmerv1.Stigmer) string {
	return substrate.SPIFFEID(st.Namespace, ServerServiceAccount(st))
}

// substrate is the declared substrate settings, empty when none are.
func substrateSpec(st *stigmerv1.Stigmer) stigmerv1.SubstrateSpec {
	if st.Spec.Sandboxes == nil || st.Spec.Sandboxes.Substrate == nil {
		return stigmerv1.SubstrateSpec{}
	}
	return *st.Spec.Sandboxes.Substrate
}

// SubstrateBucketLane is how a Substrate sandbox reaches the bucket: a
// cleartext host:port lane, or an HTTPS platform host. problem is a sentence
// when the bucket's address is one Substrate's egress cannot name.
func SubstrateBucketLane(st *stigmerv1.Stigmer) (httpLane, platformHost, problem string) {
	s3 := ObjectStore(st)
	if s3 == nil {
		return "", "", ""
	}
	endpoint := s3.RunnerEndpoint
	if endpoint == "" {
		endpoint = s3.Endpoint
	}
	if endpoint == "" {
		// AWS S3 itself, addressed by virtual host (no endpoint means the
		// server signs path style off).
		return "", fmt.Sprintf("%s.s3.%s.amazonaws.com", s3.Bucket, ObjectStoreRegion(s3)), ""
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Hostname() == "" {
		return "", "", fmt.Sprintf("the bucket's address %s is not a URL Substrate's egress can name", endpoint)
	}
	host := strings.ToLower(u.Hostname())
	if net.ParseIP(host) != nil || !strings.Contains(host, ".") {
		return "", "", fmt.Sprintf("a Substrate sandbox reaches the bucket only by a DNS name of two or more labels, and %s names %s: "+
			"give the bucket such a name (an in-cluster store's Service is <service>.<namespace>.svc.cluster.local), "+
			"in spec.objectStore.s3.runnerEndpoint if the server reaches it otherwise", endpoint, host)
	}
	if u.Scheme == "https" {
		return "", host, ""
	}
	port := u.Port()
	if port == "" {
		port = "80"
	}
	return host + ":" + port, "", ""
}

// substrateEnv is the server's substrate driver settings
// (sandbox/substrate/config.ts).
func substrateEnv(st *stigmerv1.Stigmer) []corev1.EnvVar {
	sub := substrateSpec(st)
	httpLane, platform, _ := SubstrateBucketLane(st)
	lanes := []string{}
	if httpLane != "" {
		lanes = append(lanes, httpLane)
	}
	lanes = append(lanes, sub.Egress.HTTP...)
	env := []corev1.EnvVar{
		value("STIGMER_SANDBOX_SUBSTRATE_API_ENDPOINT", "https://"+substrate.APIServerName),
		value("STIGMER_SANDBOX_SUBSTRATE_API_SERVER_NAME", substrate.APIServerName),
		value("STIGMER_SANDBOX_SUBSTRATE_API_CA_FILE", substrateMount+"/"+substrateCAFile),
		value("STIGMER_SANDBOX_SUBSTRATE_API_TOKEN_FILE", substrateMount+"/"+substrateTokenFile),
		value("STIGMER_SANDBOX_SUBSTRATE_ROUTER_URL", "https://"+substrate.RouterServerName),
		value("STIGMER_SANDBOX_SUBSTRATE_ROUTER_SERVER_NAME", substrate.RouterServerName),
		value("STIGMER_SANDBOX_SUBSTRATE_ROUTER_CA_FILE", substrateMount+"/"+substrateCAFile),
		value("STIGMER_SANDBOX_SUBSTRATE_ROUTER_CLIENT_CERT_FILE", substrateMount+"/"+substrateCertFile),
		value("STIGMER_SANDBOX_SUBSTRATE_ATESPACE", SubstrateAtespace(st)),
		value("STIGMER_SANDBOX_SUBSTRATE_WORKER_SELECTOR", SubstratePoolLabel+"="+SubstratePool(st)),
	}
	if len(lanes) > 0 {
		env = append(env, value("STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTP", strings.Join(lanes, ",")))
	}
	if platform != "" {
		env = append(env, value("STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTPS_PLATFORM", platform))
	}
	if idle := idleSeconds(st); idle != "" {
		env = append(env, value("STIGMER_SANDBOX_SUBSTRATE_SUSPEND_AFTER_SECONDS", idle))
	}
	if c := sub.Sandbox.CPUMillicores; c != nil {
		env = append(env, value("STIGMER_SANDBOX_SUBSTRATE_CPU_MILLICORES", fmt.Sprint(*c)))
	}
	if m := sub.Sandbox.MemoryMiB; m != nil {
		env = append(env, value("STIGMER_SANDBOX_SUBSTRATE_MEMORY_MIB", fmt.Sprint(*m)))
	}
	return env
}

// substrateIdentityVolume projects the server's three Substrate credentials
// into one directory.
func substrateIdentityVolume() (corev1.Volume, corev1.VolumeMount) {
	v := corev1.Volume{Name: "substrate-identity", VolumeSource: corev1.VolumeSource{
		Projected: &corev1.ProjectedVolumeSource{Sources: []corev1.VolumeProjection{
			{ServiceAccountToken: &corev1.ServiceAccountTokenProjection{
				Audience:          substrate.APIServerName,
				ExpirationSeconds: ptr(int64(3600)),
				Path:              substrateTokenFile,
			}},
			{ClusterTrustBundle: &corev1.ClusterTrustBundleProjection{
				SignerName:    ptr(substrate.ServiceDNSSigner),
				LabelSelector: &metav1.LabelSelector{MatchLabels: map[string]string{substrate.TrustBundleLabel: "live"}},
				Path:          substrateCAFile,
			}},
			{PodCertificate: &corev1.PodCertificateProjection{
				SignerName:           substrate.PodIdentitySigner,
				KeyType:              "ECDSAP256",
				CredentialBundlePath: substrateCertFile,
			}},
		}},
	}}
	return v, corev1.VolumeMount{Name: v.Name, MountPath: substrateMount, ReadOnly: true}
}

// SubstratePoolGVK is the WorkerPool's kind.
var SubstratePoolGVK = schema.GroupVersionKind{Group: "ate.dev", Version: "v1", Kind: "WorkerPool"}

// SubstrateWorkers is the declared pool size.
func SubstrateWorkers(st *stigmerv1.Stigmer) int32 {
	if w := substrateSpec(st).Workers; w > 0 {
		return w
	}
	return 1
}

// SubstratePoolObject is the install's WorkerPool: gVisor workers at the
// pinned worker image, as many as declared. The operator never changes its
// size from demand; Substrate's autoscaler is the one that will. The pool
// label is on the pool itself, which Substrate copies onto the workers it
// lists, and on the worker pods.
func SubstratePoolObject(st *stigmerv1.Stigmer, workerImage string) *unstructured.Unstructured {
	sub := substrateSpec(st)
	workers := SubstrateWorkers(st)
	resources := SubstrateWorkerSizing.Effective(sub.Worker.Resources)
	labels := Labels(st, ComponentSandboxes)
	labels[SubstratePoolLabel] = SubstratePool(st)
	template := map[string]any{
		"labels":    toAnyMap(labels),
		"resources": resourcesAny(resources),
	}
	if len(sub.Worker.NodeSelector) > 0 {
		template["nodeSelector"] = toAnyMap(sub.Worker.NodeSelector)
	}
	if len(sub.Worker.Tolerations) > 0 {
		template["tolerations"] = tolerationsAny(sub.Worker.Tolerations)
	}
	pool := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "ate.dev/v1",
		"kind":       "WorkerPool",
		"metadata": map[string]any{
			"name":      SubstratePool(st),
			"namespace": SandboxNamespace(st),
			"labels":    toAnyMap(labels),
		},
		"spec": map[string]any{
			"replicas":       int64(workers),
			"sandboxClasses": []any{map[string]any{"name": "gvisor"}},
			"workerImage":    workerImage,
			"template":       template,
		},
	}}
	return pool
}

func toAnyMap(m map[string]string) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func resourcesAny(r corev1.ResourceRequirements) map[string]any {
	list := func(l corev1.ResourceList) map[string]any {
		out := map[string]any{}
		for k, v := range l {
			out[string(k)] = v.String()
		}
		return out
	}
	out := map[string]any{}
	if len(r.Requests) > 0 {
		out["requests"] = list(r.Requests)
	}
	if len(r.Limits) > 0 {
		out["limits"] = list(r.Limits)
	}
	return out
}

func tolerationsAny(ts []corev1.Toleration) []any {
	out := make([]any, 0, len(ts))
	for _, t := range ts {
		m := map[string]any{}
		if t.Key != "" {
			m["key"] = t.Key
		}
		if t.Operator != "" {
			m["operator"] = string(t.Operator)
		}
		if t.Value != "" {
			m["value"] = t.Value
		}
		if t.Effect != "" {
			m["effect"] = string(t.Effect)
		}
		if t.TolerationSeconds != nil {
			m["tolerationSeconds"] = *t.TolerationSeconds
		}
		out = append(out, m)
	}
	return out
}
