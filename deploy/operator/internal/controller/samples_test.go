// Pins config/samples to the definition: every sample, the files the README
// and the Kubernetes guide point a platform engineer at, is accepted by a
// real API server with the generated definition installed, so its schema,
// its defaults and every CEL rule run against it. The create is a strict
// server-side dry run: an unknown or misspelt field is refused rather than
// pruned, and nothing is stored for the controller to reconcile. A sample
// that drifts from the definition fails here, not in someone's cluster.

package controller

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"
)

func TestEverySampleIsAcceptedByTheAPIServer(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "..", "config", "samples", "*.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("config/samples holds no sample")
	}
	ns := namespace(t)
	for _, file := range files {
		t.Run(filepath.Base(file), func(t *testing.T) {
			data, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			for i, doc := range strings.Split(string(data), "\n---\n") {
				var obj unstructured.Unstructured
				if err := yaml.Unmarshal([]byte(doc), &obj.Object); err != nil {
					t.Fatalf("document %d: %v", i, err)
				}
				if obj.Object == nil {
					continue
				}
				if obj.GetKind() != "Stigmer" {
					t.Fatalf("document %d is a %s; a sample declares a Stigmer", i, obj.GetKind())
				}
				obj.SetNamespace(ns)
				if err := k8s.Create(context.Background(), &obj, client.DryRunAll, client.FieldValidation("Strict")); err != nil {
					t.Errorf("the API server refuses %s: %v", filepath.Base(file), err)
				}
			}
		})
	}
}
