// The object store component: the bucket a declaration names, checked before
// anything that writes to it starts.
//
// The operator never reads or writes the bucket itself. It checks that the
// credentials Secret holds the two keys the server and the database's
// backups read, and says in Ready where files go. Whether the bucket answers
// is the server's own store probe at boot and the backup plugin's archiving
// condition, both relayed in their own words by the components they belong
// to. No bucket declared, the component is Ready and says files live on the
// server's volume.

package component

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// ObjectStore is the object store component.
type ObjectStore struct{}

// Name implements Component.
func (ObjectStore) Name() string { return render.ComponentObjectStore }

// Dependencies implements Component.
func (ObjectStore) Dependencies() []string { return nil }

// Reconcile implements Component.
func (ObjectStore) Reconcile(ctx context.Context, env *Env) (Result, error) {
	s3 := render.ObjectStore(env.Stigmer)
	if s3 == nil {
		return Ready("no bucket declared: files live on the server's volume, and the database is not backed up"), nil
	}
	ok, res, err := CheckSecretKeys(ctx, env, s3.CredentialsSecret.Name, "the bucket's access key",
		render.ObjectStoreAccessKeyID, render.ObjectStoreSecretAccessKey)
	if err != nil || !ok {
		return res, err
	}
	return Ready(fmt.Sprintf("files and the database's archive go to bucket %s", s3.Bucket)), nil
}
