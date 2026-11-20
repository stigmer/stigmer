// What the fences read from the cluster (render/networkpolicy.go): the
// in-cluster bucket's Service, whose selector and target ports name the pods
// a sandbox and the server may reach it at, and the Kubernetes API's
// endpoint addresses, which a fenced server needs for the agent-sandbox
// driver. A NetworkPolicy matches traffic after a Service's address is
// translated to a pod's, so naming the API by its Service address would
// admit nothing.

package component

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/util/intstr"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// fenceInputs reads what the fences need from the cluster.
func fenceInputs(ctx context.Context, env *Env) (render.FenceInputs, error) {
	st := env.Stigmer
	in := render.FenceInputs{}
	if ns, name, ok := render.BucketServiceRef(st); ok {
		var svc corev1.Service
		err := env.Reader.Get(ctx, client.ObjectKey{Namespace: ns, Name: name}, &svc)
		switch {
		case err == nil && len(svc.Spec.Selector) > 0:
			peer := &render.ServicePeer{Namespace: ns, Selector: svc.Spec.Selector}
			for _, p := range svc.Spec.Ports {
				target := p.TargetPort
				if target.Type == intstr.Int && target.IntVal == 0 {
					target = intstr.FromInt32(p.Port)
				}
				peer.Ports = append(peer.Ports, target)
			}
			in.Bucket = peer
		case err != nil && !apierrors.IsNotFound(err):
			return in, fmt.Errorf("reading the bucket's Service %s/%s: %w", ns, name, err)
		}
	}
	if render.ServerFenced(st) {
		var slices discoveryv1.EndpointSliceList
		if err := env.Reader.List(ctx, &slices, client.InNamespace("default"),
			client.MatchingLabels{discoveryv1.LabelServiceName: "kubernetes"}); err != nil {
			return in, fmt.Errorf("reading the Kubernetes API's endpoints: %w", err)
		}
		for _, s := range slices.Items {
			for _, e := range s.Endpoints {
				in.APIServerIPs = append(in.APIServerIPs, e.Addresses...)
			}
			for _, p := range s.Ports {
				if p.Port != nil {
					in.APIServerPort = append(in.APIServerPort, *p.Port)
				}
			}
		}
	}
	return in, nil
}

// sandboxFences is the fence around agent-sandbox's sandboxes, applied in
// the sandbox namespace beside them.
func sandboxFences(ctx context.Context, env *Env) ([]*unstructured.Unstructured, error) {
	st := env.Stigmer
	if render.Driver(st) != stigmerv1.SandboxDriverAgentSandbox {
		return nil, nil
	}
	in, err := fenceInputs(ctx, env)
	if err != nil {
		return nil, err
	}
	u, err := ToUnstructured(render.SandboxPolicyObject(st, in))
	if err != nil {
		return nil, err
	}
	return []*unstructured.Unstructured{u}, nil
}

// ensureServerFence applies the server's egress fence when it is fenced,
// and removes one a declaration no longer asks for.
func ensureServerFence(ctx context.Context, env *Env) error {
	st := env.Stigmer
	if !render.ServerFenced(st) {
		stale := &networkingv1.NetworkPolicy{}
		stale.Name, stale.Namespace = render.ServerEgressPolicy(st), st.Namespace
		if err := env.Client.Delete(ctx, stale); err != nil && !apierrors.IsNotFound(err) {
			return fmt.Errorf("removing the server's egress fence: %w", err)
		}
		return nil
	}
	in, err := fenceInputs(ctx, env)
	if err != nil {
		return err
	}
	return Apply(ctx, env, render.ServerEgressPolicyObject(st, in))
}
