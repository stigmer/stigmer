package grpc

import (
	"fmt"
	"sync"

	"buf.build/go/protovalidate"
)

// SharedValidator returns the process-wide protovalidate validator.
//
// protovalidate compiles and caches per-message CEL constraints on the
// validator instance, so a single shared instance is both correct (it is
// safe for concurrent use) and materially cheaper than constructing one per
// request. Both the transport-boundary validation interceptor and the
// in-pipeline ValidateProtoStep source their validator here so that field
// constraints are compiled exactly once for the lifetime of the process.
//
// Initialization failure is a programming/build error (a malformed constraint
// in a proto), not a runtime condition, so it panics — consistent with how the
// pipeline validation step has always treated it.
func SharedValidator() protovalidate.Validator {
	return sharedValidator()
}

var sharedValidator = sync.OnceValue(func() protovalidate.Validator {
	v, err := protovalidate.New()
	if err != nil {
		panic(fmt.Sprintf("failed to create shared protovalidate validator: %v", err))
	}
	return v
})
