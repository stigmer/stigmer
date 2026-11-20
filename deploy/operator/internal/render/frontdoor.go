// The front door: one hostname for everything people reach. The console,
// the API and files kept on a volume (/artifacts) go to the server's one
// port; the bundled sign-in (/idp) goes to Keycloak.
//
// The Ingress arm is two Ingresses on the same host, because the server's
// lane may carry a controller's gRPC hint (spec.ingress.annotations) that
// must never reach Keycloak's. With spec.ingress.tls.issuer the operator asks
// cert-manager for the certificate through a Certificate of its own, so the
// front door's readiness can wait on that Certificate's own Ready condition
// and relay its reason; with tls.secretName the adopter keeps the Secret.
//
// The Gateway arm is two HTTPRoutes attached to a Gateway the cluster runs.
// The Gateway and its listener's certificate are the cluster's; the operator
// never edits them, and reads the routes' status for the controller's
// verdict.

package render

import (
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

// ComponentFrontDoor is the front door's component name.
const ComponentFrontDoor = "frontDoor"

// The front door's API groups and kinds, for the objects rendered
// unstructured: the operator carries no client for cert-manager or Gateway
// API, which it detects and never installs.
const (
	CertManagerAPIVersion = "cert-manager.io/v1"
	CertificateKind       = "Certificate"
	GatewayAPIVersion     = "gateway.networking.k8s.io/v1"
	HTTPRouteKind         = "HTTPRoute"
	GatewayKind           = "Gateway"
	// HTTPRouteCRD is the definition whose presence says the cluster serves
	// Gateway API routes.
	HTTPRouteCRD = "httproutes.gateway.networking.k8s.io"
)

func pathPrefix(path, service string, port int32) networkingv1.HTTPIngressPath {
	prefix := networkingv1.PathTypePrefix
	return networkingv1.HTTPIngressPath{
		Path:     path,
		PathType: &prefix,
		Backend: networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{
			Name: service,
			Port: networkingv1.ServiceBackendPort{Number: port},
		}},
	}
}

func ingress(st *stigmerv1.Stigmer, name string, annotations map[string]string, path networkingv1.HTTPIngressPath) *networkingv1.Ingress {
	fd := FrontDoor(st)
	m := meta(st, name, ComponentFrontDoor)
	if len(annotations) > 0 {
		m.Annotations = annotations
	}
	var class *string
	if fd.ClassName != "" {
		class = ptr(fd.ClassName)
	}
	return &networkingv1.Ingress{
		TypeMeta:   metav1.TypeMeta{APIVersion: "networking.k8s.io/v1", Kind: "Ingress"},
		ObjectMeta: m,
		Spec: networkingv1.IngressSpec{
			IngressClassName: class,
			TLS:              []networkingv1.IngressTLS{{Hosts: []string{fd.Hostname}, SecretName: FrontDoorTLSSecret(st)}},
			Rules: []networkingv1.IngressRule{{
				Host: fd.Hostname,
				IngressRuleValue: networkingv1.IngressRuleValue{HTTP: &networkingv1.HTTPIngressRuleValue{
					Paths: []networkingv1.HTTPIngressPath{path},
				}},
			}},
		},
	}
}

// FrontDoorIngressObjects are the Ingress arm's objects: the server's
// Ingress and, with the bundled sign-in, Keycloak's.
func FrontDoorIngressObjects(st *stigmerv1.Stigmer) []*networkingv1.Ingress {
	objs := []*networkingv1.Ingress{
		ingress(st, FrontDoorIngress(st), FrontDoor(st).Annotations, pathPrefix("/", ServerService(st), GRPCPort)),
	}
	if BundledIdentity(st) {
		objs = append(objs, ingress(st, IdentityIngress(st), nil, pathPrefix(IdentityPath, KeycloakService(st), KeycloakPort)))
	}
	return objs
}

// UsesCertificate reports whether the operator asks cert-manager for the
// front door's certificate.
func UsesCertificate(st *stigmerv1.Stigmer) bool {
	fd := FrontDoor(st)
	return fd != nil && fd.TLS != nil && fd.TLS.Issuer != nil
}

// FrontDoorCertificateObject is the Certificate for the hostname, issued
// into FrontDoorTLSSecret.
func FrontDoorCertificateObject(st *stigmerv1.Stigmer) *unstructured.Unstructured {
	fd := FrontDoor(st)
	kind := fd.TLS.Issuer.Kind
	if kind == "" {
		kind = "ClusterIssuer"
	}
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": CertManagerAPIVersion,
		"kind":       CertificateKind,
		"metadata":   objectMeta(st, FrontDoorCertificate(st), ComponentFrontDoor),
		"spec": map[string]any{
			"secretName": FrontDoorTLSSecret(st),
			"dnsNames":   []any{fd.Hostname},
			"issuerRef": map[string]any{
				"name":  fd.TLS.Issuer.Name,
				"kind":  kind,
				"group": "cert-manager.io",
			},
		},
	}}
}

func objectMeta(st *stigmerv1.Stigmer, name, component string) map[string]any {
	labels := map[string]any{}
	for k, v := range Labels(st, component) {
		labels[k] = v
	}
	return map[string]any{"name": name, "namespace": st.Namespace, "labels": labels}
}

// GatewayNamespace is the namespace of the Gateway the routes attach to.
func GatewayNamespace(st *stigmerv1.Stigmer) string {
	if ns := FrontDoor(st).GatewayRef.Namespace; ns != "" {
		return ns
	}
	return st.Namespace
}

func httpRoute(st *stigmerv1.Stigmer, name, path, service string, port int32) *unstructured.Unstructured {
	ref := FrontDoor(st).GatewayRef
	parent := map[string]any{
		"group":     "gateway.networking.k8s.io",
		"kind":      GatewayKind,
		"name":      ref.Name,
		"namespace": GatewayNamespace(st),
	}
	if ref.SectionName != "" {
		parent["sectionName"] = ref.SectionName
	}
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": GatewayAPIVersion,
		"kind":       HTTPRouteKind,
		"metadata":   objectMeta(st, name, ComponentFrontDoor),
		"spec": map[string]any{
			"parentRefs": []any{parent},
			"hostnames":  []any{FrontDoor(st).Hostname},
			"rules": []any{map[string]any{
				"matches": []any{map[string]any{
					"path": map[string]any{"type": "PathPrefix", "value": path},
				}},
				"backendRefs": []any{map[string]any{"name": service, "port": int64(port)}},
			}},
		},
	}}
}

// FrontDoorRouteObjects are the Gateway arm's HTTPRoutes.
func FrontDoorRouteObjects(st *stigmerv1.Stigmer) []*unstructured.Unstructured {
	objs := []*unstructured.Unstructured{httpRoute(st, FrontDoorRoute(st), "/", ServerService(st), GRPCPort)}
	if BundledIdentity(st) {
		objs = append(objs, httpRoute(st, IdentityRoute(st), IdentityPath, KeycloakService(st), KeycloakPort))
	}
	return objs
}
