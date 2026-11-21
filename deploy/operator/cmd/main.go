// The Stigmer operator's entry point: a controller-runtime manager running
// the Stigmer controller.
//
// The manager's cache holds only what the operator made: Secrets,
// ConfigMaps and the workload kinds it owns are cached by the operator's
// managed-by label, and Pods and Events are never cached (they are read
// directly, and only while explaining a component that is not ready). So the
// operator never keeps the cluster's other Secrets in memory, and its memory
// does not grow with the cluster. Before the manager starts, a second
// operator elsewhere in the cluster stops this one with a line naming it.
// Leader election is on, so a rolling update of the operator never runs two
// walks at once. The janitor runs beside the controller on the leader, and
// reads the cluster directly rather than through the cache.

package main

import (
	"context"
	"flag"
	"os"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	"k8s.io/client-go/discovery"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/cache"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/healthz"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"
	metricsserver "sigs.k8s.io/controller-runtime/pkg/metrics/server"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/component"
	"github.com/stigmer/stigmer/deploy/operator/internal/controller"
	"github.com/stigmer/stigmer/deploy/operator/internal/janitor"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
	"github.com/stigmer/stigmer/deploy/operator/internal/serverhealth"
	"github.com/stigmer/stigmer/deploy/operator/internal/singleton"
	"github.com/stigmer/stigmer/deploy/operator/internal/version"
)

// janitorEvery is how often the janitor looks for an operator-installed
// prerequisite no Stigmer needs any more.
const janitorEvery = 15 * time.Second

func main() {
	var metricsAddr, probeAddr string
	var leaderElect bool
	var localRegistry string
	flag.StringVar(&metricsAddr, "metrics-bind-address", "0", "Address the metrics endpoint binds to; 0 turns it off.")
	flag.StringVar(&probeAddr, "health-probe-bind-address", ":8081", "Address the health probes bind to.")
	flag.BoolVar(&leaderElect, "leader-elect", true, "Elect a leader so only one replica reconciles.")
	flag.StringVar(&localRegistry, "local-registry", "",
		"On a development cluster, the in-cluster address of its local registry (kind-registry:5000 on kind), which Agent Substrate's node agent pulls localhost image references through. Empty on a real cluster.")
	opts := zap.Options{}
	opts.BindFlags(flag.CommandLine)
	flag.Parse()
	ctrl.SetLogger(zap.New(zap.UseFlagOptions(&opts)))
	log := ctrl.Log.WithName("setup")

	scheme := runtime.NewScheme()
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
	utilruntime.Must(stigmerv1.AddToScheme(scheme))

	cfg := ctrl.GetConfigOrDie()
	direct, err := client.New(cfg, client.Options{Scheme: scheme})
	if err != nil {
		log.Error(err, "could not build a client")
		os.Exit(1)
	}
	ownNamespace := singleton.OwnNamespace()
	checkCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	conflict, err := singleton.OperatorConflict(checkCtx, direct, ownNamespace)
	cancel()
	if err != nil {
		log.Error(err, "could not check for another operator")
		os.Exit(1)
	}
	if conflict != "" {
		log.Info(conflict)
		os.Exit(1)
	}

	managed := labels.SelectorFromSet(labels.Set{render.ManagedByLabel: render.ManagedByValue})
	byLabel := cache.ByObject{Label: managed}
	mgr, err := ctrl.NewManager(cfg, ctrl.Options{
		Scheme:                  scheme,
		Metrics:                 metricsserver.Options{BindAddress: metricsAddr},
		HealthProbeBindAddress:  probeAddr,
		LeaderElection:          leaderElect,
		LeaderElectionID:        "stigmer-operator.stigmer.ai",
		LeaderElectionNamespace: ownNamespace,
		Cache: cache.Options{ByObject: map[client.Object]cache.ByObject{
			&corev1.Secret{}:                byLabel,
			&corev1.ConfigMap{}:             byLabel,
			&corev1.Service{}:               byLabel,
			&corev1.PersistentVolumeClaim{}: byLabel,
			&appsv1.Deployment{}:            byLabel,
			&batchv1.Job{}:                  byLabel,
			&networkingv1.Ingress{}:         byLabel,
			&networkingv1.NetworkPolicy{}:   byLabel,
		}},
		Client: client.Options{Cache: &client.CacheOptions{
			DisableFor: []client.Object{&corev1.Pod{}, &corev1.Event{}},
		}},
	})
	if err != nil {
		log.Error(err, "could not start the manager")
		os.Exit(1)
	}

	disc, err := discovery.NewDiscoveryClientForConfig(cfg)
	if err != nil {
		log.Error(err, "could not build a discovery client")
		os.Exit(1)
	}
	reconciler := &controller.StigmerReconciler{
		Client:       mgr.GetClient(),
		Reader:       mgr.GetAPIReader(),
		Recorder:     mgr.GetEventRecorderFor("stigmer-operator"),
		Discovery:    component.ClusterDiscovery{Client: disc},
		Operator:     component.OperatorSettings{LocalRegistry: localRegistry},
		ServerHealth: serverhealth.New(),
	}
	if err := reconciler.SetupWithManager(mgr); err != nil {
		log.Error(err, "could not set up the controller")
		os.Exit(1)
	}
	// Once no Stigmer remains, the janitor removes the cluster-level pieces
	// this operator installed (internal/janitor).
	if err := mgr.Add(janitor.Runnable(janitor.Direct{Reader: mgr.GetAPIReader(), Writer: mgr.GetClient()}, janitorEvery)); err != nil {
		log.Error(err, "could not add the janitor")
		os.Exit(1)
	}
	if err := mgr.AddHealthzCheck("healthz", healthz.Ping); err != nil {
		log.Error(err, "could not add the health check")
		os.Exit(1)
	}
	if err := mgr.AddReadyzCheck("readyz", healthz.Ping); err != nil {
		log.Error(err, "could not add the readiness check")
		os.Exit(1)
	}

	log.Info("starting the Stigmer operator", "stigmerVersion", version.Stigmer)
	if err := mgr.Start(ctrl.SetupSignalHandler()); err != nil {
		log.Error(err, "the manager stopped")
		os.Exit(1)
	}
}
