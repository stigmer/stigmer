// The envtest suite's setup: a real API server and etcd, at the Kubernetes
// minor k8s.io/api names, with the generated Stigmer definition installed.
//
// The definition's CEL rules are evaluated by that API server exactly as a
// cluster evaluates them, so admission is tested, not assumed. There is no
// kubelet and no garbage collector, so these tests read what the operator
// writes (objects, owner references, status) rather than pods running.
// `make test` in deploy/operator downloads the binaries and sets
// KUBEBUILDER_ASSETS; without it the suite looks in ./bin/k8s, where that
// download lands, and fails with the command to run when they are absent.

package controller

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/envtest"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

var (
	k8s    client.Client
	scheme = runtime.NewScheme()
)

func TestMain(m *testing.M) {
	utilruntime.Must(clientgoscheme.AddToScheme(scheme))
	utilruntime.Must(stigmerv1.AddToScheme(scheme))

	if os.Getenv("KUBEBUILDER_ASSETS") == "" {
		matches, _ := filepath.Glob(filepath.Join("..", "..", "bin", "k8s", "*"))
		if len(matches) == 0 {
			fmt.Fprintln(os.Stderr, "envtest binaries are missing: run `make test` in deploy/operator, which downloads them")
			os.Exit(1)
		}
		_ = os.Setenv("KUBEBUILDER_ASSETS", matches[0])
	}
	env := &envtest.Environment{
		CRDDirectoryPaths:     []string{filepath.Join("..", "..", "config", "crd", "bases")},
		ErrorIfCRDPathMissing: true,
	}
	cfg, err := env.Start()
	if err != nil {
		fmt.Fprintf(os.Stderr, "starting envtest: %v\n", err)
		os.Exit(1)
	}
	k8s, err = client.New(cfg, client.Options{Scheme: scheme})
	if err != nil {
		fmt.Fprintf(os.Stderr, "building a client: %v\n", err)
		_ = env.Stop()
		os.Exit(1)
	}
	code := m.Run()
	_ = env.Stop()
	os.Exit(code)
}

var namespaceSeq int

// namespace creates a fresh namespace for one test.
func namespace(t *testing.T) string {
	t.Helper()
	namespaceSeq++
	name := fmt.Sprintf("t%d-%d", namespaceSeq, os.Getpid()%10000)
	if err := k8s.Create(context.Background(), &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: name}}); err != nil {
		t.Fatalf("creating namespace %s: %v", name, err)
	}
	return name
}
