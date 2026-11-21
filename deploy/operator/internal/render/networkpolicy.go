// The fences: one NetworkPolicy per workload whose callers or destinations
// are known, so an agent's commands reach what a session needs and nothing
// else of the install, and a compromised piece cannot wander.
//
// - The bundled Postgres admits the server, Temporal, the bundled sign-in,
//   its own instances and the Postgres operator's namespace (which manages
//   it and carries its backup plugin), on every port the operator uses and
//   on 5432 for the rest. Always on with the bundled database.
// - The bundled Temporal admits the server on its frontend port and its own
//   services on every port. Sandboxes reach Temporal only through the
//   server's worker lane, never directly. Always on with bundled Temporal.
// - agent-sandbox sandboxes admit nothing in and reach out only to DNS, the
//   server's unified port, the bucket, the public internet (every address
//   but the private, shared, link-local and loopback ranges) and the
//   private ranges the declaration names. Always on under that driver:
//   agents run commands nobody reviewed. Substrate's actors are fenced by
//   Substrate's own egress gateway instead (substrate.go), which lets them
//   out only to the lanes the server names.
// - The server's egress is fenced only when asked for (spec.server.egress)
//   or under an Enterprise license whose outbound egress is strict, as the
//   Helm chart had it: a server's own outbound calls include an issuer or an
//   MCP server on the adopter's private network, which a default fence
//   would cut. Fenced, it reaches DNS, the Kubernetes API (the agent-sandbox
//   driver's), its database, Temporal, the bundled sign-in, Substrate, the
//   bucket, the public internet and the declared ranges.
//
// The server and the bundled sign-in take no ingress fence: the front door's
// controller runs in a namespace the operator does not know.
//
// A bucket inside the cluster is named by its Service, so the fences admit
// that Service's pods on their target ports: MinIO's pod has no address a
// declaration could name. One outside is reached as part of the public
// internet, or through a declared range when it sits on a private network.

package render

import (
	"strings"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/substrate"
)

// The ranges "the public internet" leaves out.
var (
	privateIPv4 = []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "127.0.0.0/8"}
	privateIPv6 = []string{"fc00::/7", "fe80::/10", "::1/128"}
)

// PostgresOperatorNamespace is where CloudNativePG runs, whoever installed
// it: its release's own namespace.
const PostgresOperatorNamespace = "cnpg-system"

// ServicePeer is an in-cluster Service's pods as a fence names them.
type ServicePeer struct {
	Namespace string
	Selector  map[string]string
	Ports     []intstr.IntOrString
}

// FenceInputs is what the fences need from the cluster, read by the
// components: the bucket's Service when the bucket is in the cluster, and
// the Kubernetes API's endpoint addresses and ports.
type FenceInputs struct {
	Bucket        *ServicePeer
	APIServerIPs  []string
	APIServerPort []int32
}

// BucketServiceRef is the in-cluster Service a bucket address names, as
// namespace and name, or ok false when the address is not a Service's
// (http://minio.storage.svc.cluster.local:9000 names minio in storage).
func BucketServiceRef(st *stigmerv1.Stigmer) (namespace, name string, ok bool) {
	s3 := ObjectStore(st)
	if s3 == nil {
		return "", "", false
	}
	for _, endpoint := range []string{s3.RunnerEndpoint, s3.Endpoint} {
		host := endpointHost(endpoint)
		parts := strings.Split(strings.TrimSuffix(host, ".cluster.local"), ".")
		if len(parts) == 3 && parts[2] == "svc" {
			return parts[1], parts[0], true
		}
	}
	return "", "", false
}

func endpointHost(endpoint string) string {
	host := endpoint
	if i := strings.Index(host, "://"); i >= 0 {
		host = host[i+3:]
	}
	if i := strings.IndexAny(host, ":/"); i >= 0 {
		host = host[:i]
	}
	return strings.ToLower(host)
}

// ServerFenced reports whether the server's egress is fenced.
func ServerFenced(st *stigmerv1.Stigmer) bool {
	if e := st.Spec.Server.Egress; e != nil && e.Fenced {
		return true
	}
	if Licensed(st) {
		egress := st.Spec.Enterprise.OutboundEgress
		return egress == "" || egress == "strict"
	}
	return false
}

// PostgresPolicy is the bundled database's fence.
func PostgresPolicy(st *stigmerv1.Stigmer) string { return st.Name + "-postgres" }

// TemporalPolicy is the bundled Temporal's fence.
func TemporalPolicy(st *stigmerv1.Stigmer) string { return st.Name + "-temporal" }

// ServerEgressPolicy is the server's egress fence.
func ServerEgressPolicy(st *stigmerv1.Stigmer) string { return st.Name + "-server-egress" }

// SandboxEgressPolicy is the fence around agent-sandbox's sandboxes.
func SandboxEgressPolicy(st *stigmerv1.Stigmer) string { return st.Name + "-sandboxes" }

// TemporalPodLabels picks the bundled Temporal's pods, by the labels its
// chart gives them under the release the operator renders it as.
func TemporalPodLabels(st *stigmerv1.Stigmer) map[string]string {
	return map[string]string{NameLabel: "temporal", InstanceLabel: st.Name}
}

// PostgresPodLabels picks the bundled database's instances.
func PostgresPodLabels(st *stigmerv1.Stigmer) map[string]string {
	return map[string]string{"cnpg.io/cluster": PostgresCluster(st)}
}

func policy(st *stigmerv1.Stigmer, namespace, name, component string, selector map[string]string,
	types []networkingv1.PolicyType) *networkingv1.NetworkPolicy {
	return &networkingv1.NetworkPolicy{
		TypeMeta:   metav1.TypeMeta{APIVersion: "networking.k8s.io/v1", Kind: "NetworkPolicy"},
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, Labels: Labels(st, component)},
		Spec:       networkingv1.NetworkPolicySpec{PodSelector: metav1.LabelSelector{MatchLabels: selector}, PolicyTypes: types},
	}
}

func pods(labels map[string]string) networkingv1.NetworkPolicyPeer {
	return networkingv1.NetworkPolicyPeer{PodSelector: &metav1.LabelSelector{MatchLabels: labels}}
}

func podsIn(namespace string, labels map[string]string) networkingv1.NetworkPolicyPeer {
	p := networkingv1.NetworkPolicyPeer{
		NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": namespace}},
	}
	if labels != nil {
		p.PodSelector = &metav1.LabelSelector{MatchLabels: labels}
	}
	return p
}

func tcp(port intstr.IntOrString) networkingv1.NetworkPolicyPort {
	proto := corev1.ProtocolTCP
	return networkingv1.NetworkPolicyPort{Protocol: &proto, Port: &port}
}

func tcpPorts(ports ...int32) []networkingv1.NetworkPolicyPort {
	out := make([]networkingv1.NetworkPolicyPort, 0, len(ports))
	for _, p := range ports {
		out = append(out, tcp(intstr.FromInt32(p)))
	}
	return out
}

// dnsRule admits name lookups, wherever the cluster's resolver runs.
func dnsRule() networkingv1.NetworkPolicyEgressRule {
	udp, tcpProto := corev1.ProtocolUDP, corev1.ProtocolTCP
	port := intstr.FromInt32(53)
	return networkingv1.NetworkPolicyEgressRule{Ports: []networkingv1.NetworkPolicyPort{
		{Protocol: &udp, Port: &port}, {Protocol: &tcpProto, Port: &port},
	}}
}

// publicRule admits the public internet: every address but the private,
// shared, link-local and loopback ranges.
func publicRule() networkingv1.NetworkPolicyEgressRule {
	return networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{
		{IPBlock: &networkingv1.IPBlock{CIDR: "0.0.0.0/0", Except: privateIPv4}},
		{IPBlock: &networkingv1.IPBlock{CIDR: "::/0", Except: privateIPv6}},
	}}
}

func cidrRule(cidrs []string) (networkingv1.NetworkPolicyEgressRule, bool) {
	if len(cidrs) == 0 {
		return networkingv1.NetworkPolicyEgressRule{}, false
	}
	rule := networkingv1.NetworkPolicyEgressRule{}
	for _, c := range cidrs {
		rule.To = append(rule.To, networkingv1.NetworkPolicyPeer{IPBlock: &networkingv1.IPBlock{CIDR: c}})
	}
	return rule, true
}

func bucketRule(in FenceInputs) (networkingv1.NetworkPolicyEgressRule, bool) {
	if in.Bucket == nil {
		return networkingv1.NetworkPolicyEgressRule{}, false
	}
	rule := networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{podsIn(in.Bucket.Namespace, in.Bucket.Selector)}}
	for _, p := range in.Bucket.Ports {
		rule.Ports = append(rule.Ports, tcp(p))
	}
	return rule, true
}

// PostgresPolicyObject fences the bundled database's ingress.
func PostgresPolicyObject(st *stigmerv1.Stigmer) *networkingv1.NetworkPolicy {
	p := policy(st, st.Namespace, PostgresPolicy(st), ComponentDatabase, PostgresPodLabels(st), []networkingv1.PolicyType{networkingv1.PolicyTypeIngress})
	p.Spec.Ingress = []networkingv1.NetworkPolicyIngressRule{
		// Its own instances (replication, the instance manager) and the
		// Postgres operator, which drives it and its backup plugin.
		{From: []networkingv1.NetworkPolicyPeer{pods(PostgresPodLabels(st)), podsIn(PostgresOperatorNamespace, nil)}},
		{
			From: []networkingv1.NetworkPolicyPeer{
				pods(SelectorLabels(st, ComponentServer)),
				pods(TemporalPodLabels(st)),
				pods(SelectorLabels(st, ComponentIdentity)),
			},
			Ports: tcpPorts(5432),
		},
	}
	return p
}

// TemporalPolicyObject fences the bundled Temporal's ingress.
func TemporalPolicyObject(st *stigmerv1.Stigmer) *networkingv1.NetworkPolicy {
	p := policy(st, st.Namespace, TemporalPolicy(st), ComponentTemporal, TemporalPodLabels(st), []networkingv1.PolicyType{networkingv1.PolicyTypeIngress})
	p.Spec.Ingress = []networkingv1.NetworkPolicyIngressRule{
		{From: []networkingv1.NetworkPolicyPeer{pods(TemporalPodLabels(st))}},
		{From: []networkingv1.NetworkPolicyPeer{pods(SelectorLabels(st, ComponentServer))}, Ports: tcpPorts(TemporalPort)},
	}
	return p
}

// SandboxPolicyObject fences agent-sandbox's sandboxes: nothing in; out only
// to DNS, the server, the bucket, the public internet and declared ranges.
func SandboxPolicyObject(st *stigmerv1.Stigmer, in FenceInputs) *networkingv1.NetworkPolicy {
	p := policy(st, SandboxNamespace(st), SandboxEgressPolicy(st), ComponentSandboxes, nil,
		[]networkingv1.PolicyType{networkingv1.PolicyTypeIngress, networkingv1.PolicyTypeEgress})
	p.Spec.PodSelector = metav1.LabelSelector{}
	p.Spec.Egress = []networkingv1.NetworkPolicyEgressRule{
		dnsRule(),
		{To: []networkingv1.NetworkPolicyPeer{podsIn(st.Namespace, SelectorLabels(st, ComponentServer))}, Ports: tcpPorts(GRPCPort)},
		publicRule(),
	}
	if r, ok := bucketRule(in); ok {
		p.Spec.Egress = append(p.Spec.Egress, r)
	}
	if st.Spec.Sandboxes != nil && st.Spec.Sandboxes.AgentSandbox != nil && st.Spec.Sandboxes.AgentSandbox.Egress != nil {
		if r, ok := cidrRule(st.Spec.Sandboxes.AgentSandbox.Egress.AllowCIDRs); ok {
			p.Spec.Egress = append(p.Spec.Egress, r)
		}
	}
	return p
}

// ServerEgressPolicyObject fences the server's egress (ServerFenced).
func ServerEgressPolicyObject(st *stigmerv1.Stigmer, in FenceInputs) *networkingv1.NetworkPolicy {
	p := policy(st, st.Namespace, ServerEgressPolicy(st), ComponentServer, SelectorLabels(st, ComponentServer),
		[]networkingv1.PolicyType{networkingv1.PolicyTypeEgress})
	rules := []networkingv1.NetworkPolicyEgressRule{dnsRule(), publicRule()}
	if len(in.APIServerIPs) > 0 {
		r, _ := cidrRule(hostCIDRs(in.APIServerIPs))
		r.Ports = tcpPorts(in.APIServerPort...)
		rules = append(rules, r)
	}
	db := Database(st)
	if db.Bundled {
		rules = append(rules, networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{pods(PostgresPodLabels(st))}, Ports: tcpPorts(5432)})
	}
	if Temporal(st).Bundled {
		rules = append(rules, networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{pods(TemporalPodLabels(st))}, Ports: tcpPorts(TemporalPort)})
	}
	if BundledIdentity(st) {
		rules = append(rules, networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{pods(SelectorLabels(st, ComponentIdentity))}})
	}
	if Driver(st) == stigmerv1.SandboxDriverSubstrate {
		rules = append(rules,
			networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{podsIn(substrate.Namespace, substrate.APIServerPodLabels())}, Ports: tcpPorts(substrate.APIServerPort)},
			networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{podsIn(substrate.Namespace, substrate.RouterPodLabels())}, Ports: tcpPorts(substrate.RouterPort)})
	}
	if r, ok := bucketRule(in); ok {
		rules = append(rules, r)
	}
	if e := st.Spec.Server.Egress; e != nil {
		if r, ok := cidrRule(e.AllowCIDRs); ok {
			rules = append(rules, r)
		}
	}
	p.Spec.Egress = rules
	return p
}

// hostCIDRs is each address as a one-host range.
func hostCIDRs(ips []string) []string {
	out := make([]string, 0, len(ips))
	for _, ip := range ips {
		if strings.Contains(ip, ":") {
			out = append(out, ip+"/128")
		} else {
			out = append(out, ip+"/32")
		}
	}
	return out
}
