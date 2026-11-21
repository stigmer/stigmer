// The front door component: the one hostname people reach Stigmer at, Ready
// only when it actually works.
//
// The Ingress arm renders the Ingresses and, when the declaration names a
// cert-manager issuer, a Certificate, and is Ready once that Certificate is
// (or, with a certificate the adopter keeps, once its Secret exists). While
// it waits the sentence carries cert-manager's own reason and, when the
// controller has published one, the address to point the hostname at. The
// Gateway arm attaches routes to the named Gateway and relays the Gateway
// controller's verdict: the routes accepted and their backends resolved, the
// listener programmed, and the listener's certificate Ready when cert-manager
// issues it. Switching arms removes the other arm's objects.
//
// The public URL is published in status before the walk (the controller), so
// every other component converges while the certificate waits: a front door
// that waits only for DNS holds nothing else back.

package component

import (
	"context"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// FrontDoor is the front door component.
type FrontDoor struct{}

// Name implements Component.
func (FrontDoor) Name() string { return render.ComponentFrontDoor }

// Dependencies implements Component.
func (FrontDoor) Dependencies() []string { return nil }

var (
	certificateGVK = schema.GroupVersionKind{Group: "cert-manager.io", Version: "v1", Kind: render.CertificateKind}
	httpRouteGVK   = schema.GroupVersionKind{Group: "gateway.networking.k8s.io", Version: "v1", Kind: render.HTTPRouteKind}
	gatewayGVK     = schema.GroupVersionKind{Group: "gateway.networking.k8s.io", Version: "v1", Kind: render.GatewayKind}
)

// Reconcile implements Component.
func (FrontDoor) Reconcile(ctx context.Context, env *Env) (Result, error) {
	st := env.Stigmer
	fd := render.FrontDoor(st)
	if fd == nil {
		if err := removeFrontDoor(ctx, env, true, true); err != nil {
			return Result{}, err
		}
		return Ready("none declared: the install is reached by port-forward"), nil
	}
	if fd.GatewayRef != nil {
		return reconcileGatewayArm(ctx, env)
	}
	return reconcileIngressArm(ctx, env)
}

func reconcileIngressArm(ctx context.Context, env *Env) (Result, error) {
	st := env.Stigmer
	fd := render.FrontDoor(st)
	if err := removeFrontDoor(ctx, env, false, true); err != nil {
		return Result{}, err
	}
	var objs []client.Object
	for _, ing := range render.FrontDoorIngressObjects(st) {
		objs = append(objs, ing)
	}
	if render.UsesCertificate(st) {
		for _, crd := range render.CertManagerCRDs {
			present, err := crdPresent(ctx, env, crd)
			if err != nil {
				return Result{}, err
			}
			if !present {
				return Refused(stigmerv1.ReasonPrerequisiteMissing, Ref("CustomResourceDefinition", "", crd),
					fmt.Sprintf("spec.ingress.tls.issuer asks cert-manager for the certificate, and this cluster has no cert-manager (no definition %s): install it, or name a certificate you keep in spec.ingress.tls.secretName", crd)), nil
			}
		}
		objs = append(objs, render.FrontDoorCertificateObject(st))
	} else if err := removeObject(ctx, env, certificateGVK, render.FrontDoorCertificate(st)); err != nil {
		return Result{}, err
	}
	if err := Apply(ctx, env, objs...); err != nil {
		return Result{}, err
	}

	address := ingressAddress(ctx, env)
	pointAt := ""
	if address != "" {
		pointAt = fmt.Sprintf("; point %s at %s if it does not resolve there yet", fd.Hostname, address)
	}
	if render.UsesCertificate(st) {
		name := render.FrontDoorCertificate(st)
		cert := &unstructured.Unstructured{}
		cert.SetGroupVersionKind(certificateGVK)
		if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: name}, cert); err != nil {
			return Result{}, fmt.Errorf("reading Certificate %s: %w", name, err)
		}
		if !conditionTrue(cert, "Ready") {
			reason, message := conditionWords(cert, "Ready")
			says := "cert-manager has not reported on it yet"
			if message != "" {
				says = "cert-manager says: " + message
				if reason != "" {
					says += " (" + reason + ")"
				}
			}
			return Pending(stigmerv1.ReasonCertificatePending, Ref("Certificate", st.Namespace, name),
				fmt.Sprintf("the certificate for %s waits; %s%s. The front door is Ready only with a valid certificate, because people sign in through it", fd.Hostname, says, pointAt)), nil
		}
	} else {
		var secret corev1.Secret
		name := render.FrontDoorTLSSecret(st)
		if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: name}, &secret); err != nil {
			if !apierrors.IsNotFound(err) {
				return Result{}, fmt.Errorf("reading Secret %s: %w", name, err)
			}
			return Pending(stigmerv1.ReasonCertificatePending, Ref("Secret", st.Namespace, name),
				fmt.Sprintf("the certificate for %s waits: create TLS Secret %s in namespace %s (spec.ingress.tls.secretName)", fd.Hostname, name, st.Namespace)), nil
		}
	}
	return Ready(fmt.Sprintf("%s serves the console, the API%s", render.PublicURL(st), identityAndFiles(st))), nil
}

func identityAndFiles(st *stigmerv1.Stigmer) string {
	parts := []string{}
	if render.BundledIdentity(st) {
		parts = append(parts, "sign-in at "+render.IdentityPath)
	}
	if render.ObjectStore(st) == nil {
		parts = append(parts, "files at "+render.ArtifactsPath)
	}
	if len(parts) == 0 {
		return ""
	}
	return ", " + strings.Join(parts, " and ")
}

// ingressAddress is the address the controller published on the server's
// Ingress, or "".
func ingressAddress(ctx context.Context, env *Env) string {
	var ing networkingv1.Ingress
	st := env.Stigmer
	if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: render.FrontDoorIngress(st)}, &ing); err != nil {
		return ""
	}
	for _, lb := range ing.Status.LoadBalancer.Ingress {
		if lb.IP != "" {
			return lb.IP
		}
		if lb.Hostname != "" {
			return lb.Hostname
		}
	}
	return ""
}

func reconcileGatewayArm(ctx context.Context, env *Env) (Result, error) {
	st := env.Stigmer
	fd := render.FrontDoor(st)
	present, err := crdPresent(ctx, env, render.HTTPRouteCRD)
	if err != nil {
		return Result{}, err
	}
	if !present {
		return Refused(stigmerv1.ReasonPrerequisiteMissing, Ref("CustomResourceDefinition", "", render.HTTPRouteCRD),
			fmt.Sprintf("spec.ingress.gatewayRef attaches routes to a Gateway, and this cluster serves no Gateway API (no definition %s): install a Gateway controller, or use an Ingress (spec.ingress.tls)", render.HTTPRouteCRD)), nil
	}
	if err := removeFrontDoor(ctx, env, true, false); err != nil {
		return Result{}, err
	}
	routes := render.FrontDoorRouteObjects(st)
	objs := make([]client.Object, 0, len(routes))
	for _, r := range routes {
		objs = append(objs, r)
	}
	if err := Apply(ctx, env, objs...); err != nil {
		return Result{}, err
	}

	gwNamespace := render.GatewayNamespace(st)
	gwRef := Ref("Gateway", gwNamespace, fd.GatewayRef.Name)
	for _, r := range routes {
		live := &unstructured.Unstructured{}
		live.SetGroupVersionKind(httpRouteGVK)
		if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: r.GetName()}, live); err != nil {
			return Result{}, fmt.Errorf("reading HTTPRoute %s: %w", r.GetName(), err)
		}
		ref := Ref("HTTPRoute", st.Namespace, r.GetName())
		parent := routeParentStatus(live, fd.GatewayRef.Name, gwNamespace)
		if parent == nil {
			return Pending(stigmerv1.ReasonFrontDoorPending, ref,
				fmt.Sprintf("waiting for Gateway %s/%s's controller to accept route %s", gwNamespace, fd.GatewayRef.Name, r.GetName())), nil
		}
		for _, cond := range []string{"Accepted", "ResolvedRefs"} {
			if status, reason, message := mapCondition(parent, cond); status != "True" {
				if status == "" {
					return Pending(stigmerv1.ReasonFrontDoorPending, ref,
						fmt.Sprintf("waiting for Gateway %s/%s's controller to report %s on route %s", gwNamespace, fd.GatewayRef.Name, cond, r.GetName())), nil
				}
				return Refused(stigmerv1.ReasonGatewayNotAccepted, ref,
					fmt.Sprintf("Gateway %s/%s does not take route %s: %s says %s (%s)", gwNamespace, fd.GatewayRef.Name, r.GetName(), cond, message, reason)), nil
			}
		}
	}

	gw := &unstructured.Unstructured{}
	gw.SetGroupVersionKind(gatewayGVK)
	if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: gwNamespace, Name: fd.GatewayRef.Name}, gw); err != nil {
		if apierrors.IsNotFound(err) {
			return Refused(stigmerv1.ReasonGatewayNotAccepted, gwRef,
				fmt.Sprintf("Gateway %s/%s does not exist: create it, or name the one your cluster runs in spec.ingress.gatewayRef", gwNamespace, fd.GatewayRef.Name)), nil
		}
		return Result{}, fmt.Errorf("reading Gateway %s/%s: %w", gwNamespace, fd.GatewayRef.Name, err)
	}
	listener, secret := gatewayListener(gw, fd.GatewayRef.SectionName, fd.Hostname)
	if listener == "" {
		return Refused(stigmerv1.ReasonGatewayNotAccepted, gwRef,
			fmt.Sprintf("Gateway %s/%s has no HTTPS listener for %s: add one, or name it in spec.ingress.gatewayRef.sectionName", gwNamespace, fd.GatewayRef.Name, fd.Hostname)), nil
	}
	if !listenerProgrammed(gw, listener) {
		return Pending(stigmerv1.ReasonFrontDoorPending, gwRef,
			fmt.Sprintf("waiting for Gateway %s/%s's listener %s to be programmed", gwNamespace, fd.GatewayRef.Name, listener)), nil
	}
	if secret != "" {
		if cert, err := certificateFor(ctx, env, gwNamespace, secret); err != nil {
			return Result{}, err
		} else if cert != nil && !conditionTrue(cert, "Ready") {
			_, message := conditionWords(cert, "Ready")
			return Pending(stigmerv1.ReasonCertificatePending, Ref("Certificate", gwNamespace, cert.GetName()),
				fmt.Sprintf("the certificate on Gateway %s/%s's listener %s waits; cert-manager says: %s", gwNamespace, fd.GatewayRef.Name, listener, message)), nil
		}
	}
	return Ready(fmt.Sprintf("%s serves the console, the API%s, through Gateway %s/%s", render.PublicURL(st), identityAndFiles(st), gwNamespace, fd.GatewayRef.Name)), nil
}

// removeFrontDoor deletes the objects of an arm no longer declared.
func removeFrontDoor(ctx context.Context, env *Env, ingresses, routes bool) error {
	st := env.Stigmer
	if ingresses {
		for _, name := range []string{render.FrontDoorIngress(st), render.IdentityIngress(st)} {
			if err := removeObject(ctx, env, networkingv1.SchemeGroupVersion.WithKind("Ingress"), name); err != nil {
				return err
			}
		}
		if err := removeObject(ctx, env, certificateGVK, render.FrontDoorCertificate(st)); err != nil {
			return err
		}
	}
	if routes {
		for _, name := range []string{render.FrontDoorRoute(st), render.IdentityRoute(st)} {
			if err := removeObject(ctx, env, httpRouteGVK, name); err != nil {
				return err
			}
		}
	}
	return nil
}

// removeObject deletes one object this Stigmer owns, if it exists; a kind
// the cluster does not serve has nothing to delete.
func removeObject(ctx context.Context, env *Env, gvk schema.GroupVersionKind, name string) error {
	st := env.Stigmer
	u := &unstructured.Unstructured{}
	u.SetGroupVersionKind(gvk)
	err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: name}, u)
	if apierrors.IsNotFound(err) || meta.IsNoMatchError(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reading %s %s: %w", gvk.Kind, name, err)
	}
	if u.GetLabels()[render.ManagedByLabel] != render.ManagedByValue {
		return nil
	}
	if err := env.Client.Delete(ctx, u); err != nil && !apierrors.IsNotFound(err) {
		return fmt.Errorf("deleting %s %s: %w", gvk.Kind, name, err)
	}
	return nil
}

// conditionWords is a condition's reason and message.
func conditionWords(u *unstructured.Unstructured, condition string) (string, string) {
	conds, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	for _, c := range conds {
		m, ok := c.(map[string]any)
		if ok && m["type"] == condition {
			reason, _ := m["reason"].(string)
			message, _ := m["message"].(string)
			return reason, message
		}
	}
	return "", ""
}

func mapCondition(m map[string]any, condition string) (status, reason, message string) {
	conds, _ := m["conditions"].([]any)
	for _, c := range conds {
		cm, ok := c.(map[string]any)
		if ok && cm["type"] == condition {
			status, _ = cm["status"].(string)
			reason, _ = cm["reason"].(string)
			message, _ = cm["message"].(string)
			return status, reason, message
		}
	}
	return "", "", ""
}

// routeParentStatus is a route's status for the named Gateway, or nil.
func routeParentStatus(route *unstructured.Unstructured, name, namespace string) map[string]any {
	parents, _, _ := unstructured.NestedSlice(route.Object, "status", "parents")
	for _, p := range parents {
		pm, ok := p.(map[string]any)
		if !ok {
			continue
		}
		ref, _ := pm["parentRef"].(map[string]any)
		ns, _ := ref["namespace"].(string)
		if ns == "" {
			ns = route.GetNamespace()
		}
		if ref["name"] == name && ns == namespace {
			return pm
		}
	}
	return nil
}

// gatewayListener finds the listener the routes attach to (by section name,
// or the HTTPS listener whose hostname covers the front door's) and the
// Secret its certificate lives in.
func gatewayListener(gw *unstructured.Unstructured, sectionName, hostname string) (string, string) {
	listeners, _, _ := unstructured.NestedSlice(gw.Object, "spec", "listeners")
	for _, l := range listeners {
		lm, ok := l.(map[string]any)
		if !ok {
			continue
		}
		name, _ := lm["name"].(string)
		protocol, _ := lm["protocol"].(string)
		host, _ := lm["hostname"].(string)
		if sectionName != "" && name != sectionName {
			continue
		}
		if sectionName == "" && (protocol != "HTTPS" || !hostCovers(host, hostname)) {
			continue
		}
		secret := ""
		refs, _, _ := unstructured.NestedSlice(lm, "tls", "certificateRefs")
		if len(refs) > 0 {
			if rm, ok := refs[0].(map[string]any); ok {
				secret, _ = rm["name"].(string)
			}
		}
		return name, secret
	}
	return "", ""
}

func hostCovers(pattern, host string) bool {
	switch {
	case pattern == "":
		return true
	case strings.HasPrefix(pattern, "*."):
		return strings.HasSuffix(host, pattern[1:]) && strings.Count(host, ".") == strings.Count(pattern, ".")
	default:
		return pattern == host
	}
}

func listenerProgrammed(gw *unstructured.Unstructured, listener string) bool {
	statuses, _, _ := unstructured.NestedSlice(gw.Object, "status", "listeners")
	for _, s := range statuses {
		sm, ok := s.(map[string]any)
		if !ok || sm["name"] != listener {
			continue
		}
		status, _, _ := mapCondition(sm, "Programmed")
		return status == "True"
	}
	return false
}

// certificateFor is the cert-manager Certificate issuing secret in
// namespace, or nil when cert-manager is absent or none issues it.
func certificateFor(ctx context.Context, env *Env, namespace, secret string) (*unstructured.Unstructured, error) {
	list := &unstructured.UnstructuredList{}
	list.SetGroupVersionKind(certificateGVK.GroupVersion().WithKind("CertificateList"))
	if err := env.Reader.List(ctx, list, client.InNamespace(namespace)); err != nil {
		if meta.IsNoMatchError(err) || apierrors.IsNotFound(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("listing Certificates in %s: %w", namespace, err)
	}
	for i := range list.Items {
		name, _, _ := unstructured.NestedString(list.Items[i].Object, "spec", "secretName")
		if name == secret {
			return &list.Items[i], nil
		}
	}
	return nil, nil
}
