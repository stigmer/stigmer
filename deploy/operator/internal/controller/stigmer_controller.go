// The Stigmer controller: one thin walk over the components, one status
// write per pass.
//
// Each pass refuses, before touching anything, what no component could carry
// out: a second Stigmer in the cluster, a size no workload can run with, an
// extraEnv entry that would undo a declared setting. Then it walks the
// components in order. A component whose dependencies are not Ready waits,
// naming them; the rest reconcile. A component's error is the operator's to
// retry, so it becomes the component's Error status and a requeue, never a
// returned error: the install's status already says it, and a healthy
// install's log stays free of ERROR lines. Events are recorded only when a
// component's phase or reason changes, so a stuck install does not flood
// the namespace. The pass ends with one status patch, made only when
// something changed, and a 30-second requeue; changes to what the Stigmer
// owns wake it sooner.

package controller

import (
	"context"
	"fmt"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/equality"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/record"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/builder"
	"sigs.k8s.io/controller-runtime/pkg/client"
	logf "sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/predicate"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/component"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
	"github.com/stigmer/stigmer/deploy/operator/internal/singleton"
	"github.com/stigmer/stigmer/deploy/operator/internal/status"
	"github.com/stigmer/stigmer/deploy/operator/internal/substrate/install"
)

// RequeueAfter is how often a Stigmer is reconciled with nothing to wake it.
const RequeueAfter = 30 * time.Second

// Components are the components in the order they are brought up.
func Components() []component.Component {
	return []component.Component{
		component.Keys{},
		component.ObjectStore{},
		component.Database{},
		component.Temporal{},
		component.FrontDoor{},
		component.Identity{},
		component.Sandboxes{},
		component.Server{},
		component.Runner{},
	}
}

// StigmerReconciler reconciles Stigmer resources.
type StigmerReconciler struct {
	// Client is the manager's cached client.
	Client client.Client
	// Reader reads straight from the API server.
	Reader client.Reader
	// Recorder records Events on the Stigmer.
	Recorder record.EventRecorder
	// Discovery answers questions about the cluster's APIs.
	Discovery install.Discovery
	// Operator is how the operator itself was configured for this cluster.
	Operator component.OperatorSettings
	// ServerHealth asks the running server whether sessions can start; nil
	// skips the question, for tests with no server.
	ServerHealth component.ServerHealth
	// Components defaults to Components().
	Components []component.Component
	// Now defaults to the wall clock.
	Now func() metav1.Time
}

// +kubebuilder:rbac:groups=stigmer.ai,resources=stigmers,verbs=get;list;watch;update;patch
// +kubebuilder:rbac:groups=stigmer.ai,resources=stigmers/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=stigmer.ai,resources=stigmers/finalizers,verbs=update
// +kubebuilder:rbac:groups="",resources=secrets;configmaps;services;serviceaccounts;persistentvolumeclaims;namespaces,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=pods,verbs=get;list;watch
// +kubebuilder:rbac:groups="",resources=events,verbs=get;list;watch;create;patch
// +kubebuilder:rbac:groups=events.k8s.io,resources=events,verbs=create;patch
// +kubebuilder:rbac:groups=apps,resources=deployments;statefulsets;daemonsets,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=resourcequotas,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=ate.dev,resources=workerpools;sandboxconfigs;csidriverconfigs,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=certificates.k8s.io,resources=clustertrustbundles,verbs=get;list;watch;patch
// +kubebuilder:rbac:groups=admissionregistration.k8s.io,resources=validatingadmissionpolicies;validatingadmissionpolicybindings,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:urls=/.well-known/openid-configuration,verbs=get
// +kubebuilder:rbac:groups=batch,resources=jobs,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=policy,resources=poddisruptionbudgets,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=coordination.k8s.io,resources=leases,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=postgresql.cnpg.io,resources=clusters;databases;backups;scheduledbackups,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=barmancloud.cnpg.io,resources=objectstores,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=cert-manager.io,resources=issuers;certificates,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=networking.k8s.io,resources=ingresses;networkpolicies,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=discovery.k8s.io,resources=endpointslices,verbs=get;list;watch
// +kubebuilder:rbac:groups=agents.x-k8s.io,resources=sandboxes,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=gateway.networking.k8s.io,resources=httproutes,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=gateway.networking.k8s.io,resources=gateways,verbs=get;list;watch
// +kubebuilder:rbac:groups=apiextensions.k8s.io,resources=customresourcedefinitions,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=rbac.authorization.k8s.io,resources=clusterroles;clusterrolebindings;roles;rolebindings,verbs=get;list;watch;create;update;patch;delete;escalate;bind
// +kubebuilder:rbac:groups=admissionregistration.k8s.io,resources=mutatingwebhookconfigurations;validatingwebhookconfigurations,verbs=get;list;watch;create;update;patch;delete

// Reconcile walks one Stigmer's components.
func (r *StigmerReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := logf.FromContext(ctx)
	var st stigmerv1.Stigmer
	if err := r.Client.Get(ctx, req.NamespacedName, &st); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}
	if st.DeletionTimestamp != nil {
		return ctrl.Result{}, nil
	}
	orig := st.DeepCopy()
	st.Status.ObservedGeneration = st.Generation
	st.Status.Edition = render.Edition(&st)
	// Published before the walk, so it reads true while the front door
	// still waits for its certificate.
	st.Status.URL = render.PublicURL(&st)

	if msg, err := r.refusal(ctx, &st); err != nil {
		log.Info("could not check the declaration; retrying", "error", err.Error())
		return ctrl.Result{RequeueAfter: RequeueAfter}, nil
	} else if msg != "" {
		return r.finish(ctx, orig, &st)
	}

	components := r.Components
	if components == nil {
		components = Components()
	}
	now := r.now()
	env := &component.Env{Client: r.Client, Reader: r.Reader, Stigmer: &st, Discovery: r.Discovery, Operator: r.Operator, ServerHealth: r.ServerHealth}
	phases := map[string]stigmerv1.Phase{}
	names := make([]string, 0, len(components))
	for _, c := range components {
		names = append(names, c.Name())
		res := r.waitFor(c, phases)
		if res == nil {
			got, err := c.Reconcile(ctx, env)
			if err != nil {
				log.Info("component did not converge; retrying", "component", c.Name(), "error", err.Error())
				got = component.Result{Phase: stigmerv1.PhaseError, Reason: stigmerv1.ReasonReconcileFailed, Message: err.Error()}
			}
			res = &got
		}
		phases[c.Name()] = res.Phase
		next := stigmerv1.ComponentStatus{Name: c.Name(), Phase: res.Phase, Reason: res.Reason, Object: res.Object, Message: res.Message}
		if changed, prev := status.SetComponent(&st.Status, next, now); changed {
			r.event(&st, next, prev)
		}
	}
	status.Keep(&st.Status, names)
	status.Summarize(&st, readySentence(&st))
	return r.finish(ctx, orig, &st)
}

// readySentence is what a Ready install's Ready condition says: where to
// reach it and, while the owner has not signed in, how.
func readySentence(st *stigmerv1.Stigmer) string {
	if render.FrontDoor(st) == nil {
		return fmt.Sprintf("Ready; reach it with: kubectl -n %s port-forward svc/%s %s",
			st.Namespace, render.ServerService(st), render.PortForwardPorts(st))
	}
	sentence := "Ready · " + render.PublicURL(st)
	for _, c := range st.Status.Components {
		if c.Name == render.ComponentIdentity && strings.Contains(c.Message, component.OwnerSetupHint) {
			sentence += fmt.Sprintf(" · sign in as %s with the one-time password in Secret %s (kubectl -n %s get secret %s -o jsonpath='{.data.password}' | base64 -d)",
				st.Spec.Owner.Email, render.OwnerSetupSecret(st), st.Namespace, render.OwnerSetupSecret(st))
		}
	}
	return sentence
}

// refusal refuses the whole Stigmer when no component could proceed, and
// returns the sentence ("" when it proceeds).
func (r *StigmerReconciler) refusal(ctx context.Context, st *stigmerv1.Stigmer) (string, error) {
	var all stigmerv1.StigmerList
	if err := r.Client.List(ctx, &all); err != nil {
		return "", fmt.Errorf("listing Stigmers: %w", err)
	}
	if oldest := singleton.Oldest(all.Items); oldest != nil && oldest.UID != st.UID {
		msg := fmt.Sprintf("this cluster already runs Stigmer %s/%s, and a cluster holds one Stigmer: delete this one, or that one", oldest.Namespace, oldest.Name)
		status.Refuse(st, stigmerv1.ReasonAnotherStigmer, msg)
		return msg, nil
	}
	if msg := render.SizingRefusal(st); msg != "" {
		status.Refuse(st, stigmerv1.ReasonSizingRefused, msg)
		return msg, nil
	}
	if msg := render.ExtraEnvConflicts(st); msg != "" {
		status.Refuse(st, stigmerv1.ReasonConfigurationRefused, msg)
		return msg, nil
	}
	return "", nil
}

// waitFor returns the waiting Result of a component whose dependencies are
// not Ready, or nil when it may reconcile.
func (r *StigmerReconciler) waitFor(c component.Component, phases map[string]stigmerv1.Phase) *component.Result {
	var waiting []string
	for _, dep := range c.Dependencies() {
		if phases[dep] != stigmerv1.PhaseReady {
			waiting = append(waiting, dep)
		}
	}
	if len(waiting) == 0 {
		return nil
	}
	res := component.Pending(stigmerv1.ReasonWaitingForDependency, nil,
		fmt.Sprintf("waiting for %s to be ready", strings.Join(waiting, " and ")))
	return &res
}

func (r *StigmerReconciler) event(st *stigmerv1.Stigmer, next stigmerv1.ComponentStatus, prev *stigmerv1.ComponentStatus) {
	if r.Recorder == nil {
		return
	}
	switch {
	case next.Reason.IsFailure() || next.Phase == stigmerv1.PhaseError:
		r.Recorder.Event(st, corev1.EventTypeWarning, string(next.Reason), fmt.Sprintf("%s: %s", next.Name, next.Message))
	case next.Phase == stigmerv1.PhaseReady && prev != nil && prev.Phase != stigmerv1.PhaseReady:
		r.Recorder.Event(st, corev1.EventTypeNormal, "ComponentReady", fmt.Sprintf("%s: %s", next.Name, next.Message))
	}
}

func (r *StigmerReconciler) finish(ctx context.Context, orig, st *stigmerv1.Stigmer) (ctrl.Result, error) {
	if !equality.Semantic.DeepEqual(orig.Status, st.Status) {
		if err := r.Client.Status().Patch(ctx, st, client.MergeFrom(orig)); err != nil {
			logf.FromContext(ctx).Info("could not write status; retrying", "error", err.Error())
		}
	}
	return ctrl.Result{RequeueAfter: RequeueAfter}, nil
}

func (r *StigmerReconciler) now() metav1.Time {
	if r.Now != nil {
		return r.Now()
	}
	return metav1.Now()
}

// SetupWithManager registers the controller.
func (r *StigmerReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&stigmerv1.Stigmer{}, builder.WithPredicates(predicate.GenerationChangedPredicate{})).
		Owns(&appsv1.Deployment{}).
		Owns(&batchv1.Job{}).
		Owns(&corev1.Service{}).
		Owns(&corev1.PersistentVolumeClaim{}).
		Owns(&networkingv1.Ingress{}).
		Owns(&networkingv1.NetworkPolicy{}).
		Named("stigmer").
		Complete(r)
}
