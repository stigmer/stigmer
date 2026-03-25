/*
 * Copyright 2026 Leftbin/Stigmer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package grpc_client

import (
	"context"

	"google.golang.org/grpc/metadata"
)

const onBehalfOfHeader = "x-on-behalf-of"

// WithOnBehalfOf returns a derived context that carries the x-on-behalf-of
// gRPC metadata header.  The server-side interceptor reads this header,
// verifies the machine account has impersonation privileges, and treats the
// request as if it came from the specified identity account.
//
// Use this for user-facing reads (get execution, get session, etc.) where
// FGA authorization should be checked against the invoking user rather than
// the machine account.
//
// If identityAccountID is empty the original context is returned unchanged,
// providing safe backward compatibility when the identity is not yet threaded.
func WithOnBehalfOf(ctx context.Context, identityAccountID string) context.Context {
	if identityAccountID == "" {
		return ctx
	}
	return metadata.AppendToOutgoingContext(ctx, onBehalfOfHeader, identityAccountID)
}
