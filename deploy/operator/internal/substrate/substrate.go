// Agent Substrate's public contract: the names an install of any origin
// serves, which is all the operator outside internal/substrate/install
// depends on. Whether Substrate was installed by this operator, by
// Substrate's own installer or by a chart is invisible from here, so the
// installer can be replaced without touching anything that imports this.

package substrate

const (
	// Namespace holds Substrate's control plane.
	Namespace = "ate-system"
	// WorkerPoolCRD is the definition a Substrate install is recognised by.
	WorkerPoolCRD = "workerpools.ate.dev"
	// APIServerName is the API's in-cluster name and its tokens' audience.
	APIServerName = "api.ate-system.svc"
	// RouterServerName is the router's in-cluster name.
	RouterServerName = "atenet-router.ate-system.svc"
	// ServiceDNSSigner issues the certificates Substrate's services are
	// served under; its trust bundle verifies them.
	ServiceDNSSigner = "servicedns.podcert.ate.dev/identity"
	// PodIdentitySigner issues a pod's client certificate, which the router
	// checks against its allowed SPIFFE IDs.
	PodIdentitySigner = "podidentity.podcert.ate.dev/identity"
	// TrustBundleLabel selects the live trust bundles.
	TrustBundleLabel = "podcert.ate.dev/canarying"
	// APIAccessLabel admits a namespace's pods to Substrate's API through
	// Substrate's own network policy.
	APIAccessLabel = "ate.dev/api-access"
	// APIServerPort is the port the API's pods serve on.
	APIServerPort = 443
	// RouterPort is the port the router's pods serve on, behind its
	// Service's 443.
	RouterPort = 8443
)

// APIServerPodLabels selects the API's pods.
func APIServerPodLabels() map[string]string { return map[string]string{"app": "ate-api-server"} }

// RouterPodLabels selects the router's pods.
func RouterPodLabels() map[string]string { return map[string]string{"app": "atenet-router"} }

// Principal is a service account's identity in Substrate's authorization,
// as its token's subject.
func Principal(namespace, serviceAccount string) string {
	return "system:serviceaccount:" + namespace + ":" + serviceAccount
}

// SPIFFEID is a service account's identity in its pod certificate.
func SPIFFEID(namespace, serviceAccount string) string {
	return "spiffe://cluster.local/ns/" + namespace + "/sa/" + serviceAccount
}
