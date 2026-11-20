// The Temporal component: Temporal's own chart on the bundled database, or
// the adopter's Temporal.
//
// Bundled: the chart is rendered in memory and every object applied as the
// Stigmer's. Readiness follows the order Temporal comes up in: the schema Job
// (still running is a wait; failed names the Job to read), then each server
// service's Deployment (a pod that is not ready is explained by its own
// cause), then the namespace Job. Temporal is Ready only once `default` is
// registered, because a Stigmer server that connects before the namespace
// exists never retries its worker. External: the Secrets its TLS and API key
// name must hold their keys; reachability is the server's to report.

package component

import (
	"context"
	"fmt"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/helmrender"
	"github.com/stigmer/stigmer/deploy/operator/internal/manifests"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// Temporal is the Temporal component.
type Temporal struct{}

// Name implements Component.
func (Temporal) Name() string { return render.ComponentTemporal }

// Dependencies implements Component.
func (Temporal) Dependencies() []string { return []string{render.ComponentDatabase} }

// RenderTemporal renders the bundled Temporal's objects.
func RenderTemporal(st *stigmerv1.Stigmer) ([]*unstructured.Unstructured, error) {
	chart, _, err := manifests.TemporalChart()
	if err != nil {
		return nil, err
	}
	return helmrender.Render(chart, st.Name, st.Namespace, render.TemporalValues(st))
}

// Reconcile implements Component.
func (Temporal) Reconcile(ctx context.Context, env *Env) (Result, error) {
	st := env.Stigmer
	conn := render.Temporal(st)
	if !conn.Bundled {
		return checkExternalTemporal(ctx, env, conn)
	}

	objs, err := RenderTemporal(st)
	if err != nil {
		return Result{}, err
	}

	// Applied in the order Temporal comes up, so no server pod starts on a
	// database without its schema and the namespace Job never retries
	// against a frontend that is not there: first everything but the
	// services and the namespace Job (configuration, Services, the schema
	// Job), then the services once the schema is in, then the namespace Job
	// once they are ready. Each stage is re-applied on every pass.
	var first, services []client.Object
	var namespaceObj *unstructured.Unstructured
	var schemaJob string
	var deployments []*unstructured.Unstructured
	for _, o := range objs {
		switch {
		case o.GetKind() == "Job" && strings.HasPrefix(o.GetName(), render.TemporalNamespaceJobPrefix(st)):
			namespaceObj = o
		case o.GetKind() == "Deployment":
			deployments = append(deployments, o)
			services = append(services, o)
		default:
			if o.GetKind() == "Job" && strings.HasPrefix(o.GetName(), render.TemporalSchemaJobPrefix(st)) {
				schemaJob = o.GetName()
			}
			first = append(first, o)
		}
	}
	if err := Apply(ctx, env, first...); err != nil {
		return Result{}, err
	}
	if err := Apply(ctx, env, render.TemporalPolicyObject(st)); err != nil {
		return Result{}, err
	}
	if schemaJob != "" {
		done, res, err := jobStanding(ctx, env, schemaJob, stigmerv1.ReasonWaitingForSchema, "setting up Temporal's database schema")
		if err != nil || !done {
			return res, err
		}
	}
	if err := Apply(ctx, env, services...); err != nil {
		return Result{}, err
	}
	for _, d := range deployments {
		var live appsv1.Deployment
		if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: d.GetName()}, &live); err != nil {
			return Result{}, fmt.Errorf("reading Deployment %s: %w", d.GetName(), err)
		}
		if live.Status.AvailableReplicas >= 1 && live.Status.UpdatedReplicas >= 1 && live.Status.ObservedGeneration >= live.Generation {
			continue
		}
		selector, _, _ := unstructured.NestedStringMap(d.Object, "spec", "selector", "matchLabels")
		return Explain(ctx, env, selector, nil, Deploying(stigmerv1.ReasonDeploying,
			Ref("Deployment", st.Namespace, d.GetName()), fmt.Sprintf("waiting for Temporal's %s to come up", d.GetName())))
	}
	if namespaceObj != nil {
		if err := Apply(ctx, env, namespaceObj); err != nil {
			return Result{}, err
		}
		done, res, err := jobStanding(ctx, env, namespaceObj.GetName(), stigmerv1.ReasonDeploying,
			fmt.Sprintf("registering Temporal namespace %s", render.TemporalNamespace))
		if err != nil || !done {
			return res, err
		}
	}
	return Ready(fmt.Sprintf("Temporal at %s, namespace %s registered (%s retention)", conn.HostPort, conn.Namespace, render.TemporalRetention)), nil
}

// jobStanding reports whether a Job has succeeded, and when it has not, the
// Result that says where it stands.
func jobStanding(ctx context.Context, env *Env, name string, running stigmerv1.ComponentReason, doing string) (bool, Result, error) {
	ns := env.Stigmer.Namespace
	ref := Ref("Job", ns, name)
	var job batchv1.Job
	err := env.Reader.Get(ctx, client.ObjectKey{Namespace: ns, Name: name}, &job)
	if apierrors.IsNotFound(err) {
		return false, Deploying(running, ref, doing), nil
	}
	if err != nil {
		return false, Result{}, fmt.Errorf("reading Job %s: %w", name, err)
	}
	for _, c := range job.Status.Conditions {
		if c.Status != corev1.ConditionTrue {
			continue
		}
		switch c.Type {
		case batchv1.JobComplete, batchv1.JobSuccessCriteriaMet:
			return true, Result{}, nil
		case batchv1.JobFailed, batchv1.JobFailureTarget:
			return false, Deploying(stigmerv1.ReasonJobFailed, ref,
				fmt.Sprintf("Job %s failed (%s): read why with kubectl -n %s logs job/%s", name, c.Message, ns, name)), nil
		}
	}
	if job.Status.Succeeded > 0 {
		return true, Result{}, nil
	}
	msg := doing
	if job.Status.Failed > 0 {
		msg = fmt.Sprintf("%s; %d attempts failed so far, read why with kubectl -n %s logs job/%s", doing, job.Status.Failed, ns, name)
	}
	return false, Deploying(running, ref, msg), nil
}

func checkExternalTemporal(ctx context.Context, env *Env, conn render.TemporalConnection) (Result, error) {
	if tls := conn.TLS; tls != nil && tls.SecretName != "" {
		var keys []string
		for _, k := range []string{tls.CAKey, tls.CertKey, tls.KeyKey} {
			if k != "" {
				keys = append(keys, k)
			}
		}
		if len(keys) > 0 {
			ok, res, err := CheckSecretKeys(ctx, env, tls.SecretName, "Temporal's TLS material (PEM)", keys...)
			if err != nil || !ok {
				return res, err
			}
		}
	}
	if conn.APIKey != nil {
		ok, res, err := CheckSecretKeys(ctx, env, conn.APIKey.Name, "Temporal's API key", conn.APIKey.Key)
		if err != nil || !ok {
			return res, err
		}
	}
	return Ready(fmt.Sprintf("using your Temporal at %s, namespace %s", conn.HostPort, conn.Namespace)), nil
}
