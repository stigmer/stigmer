// Package dserrors defines the datastore record-RPC error contract.
//
// Errors from record operations are part of the cross-edition API
// contract (DD-002 SD-5, DD-005 SD-6): gRPC codes, message bytes, and
// the google.rpc.ErrorInfo companion must be identical in the Go and
// Java control planes, because agents relay the messages verbatim to end
// users and the mcp-server bridge projects {error, code, reason,
// constraint} straight from them.
//
// Code map:
//   - ALREADY_EXISTS       unique-constraint violation (declared message)
//   - FAILED_PRECONDITION  check/exists violation (declared message);
//     resource-layer delete/sync guards
//   - PERMISSION_DENIED    reach or role/verb/scope denial (fixed texts)
//   - INVALID_ARGUMENT     filter/type/system-field violations
//   - NOT_FOUND            datastore/collection/record not found
//
// Raw driver errors never cross this boundary.
package dserrors

import (
	"fmt"

	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Domain is the ErrorInfo domain for every datastore record error.
const Domain = "datastore.stigmer.ai"

// ErrorInfo reason codes. These are contract values consumed by the
// mcp-server bridge's records error mapper and the console.
const (
	ReasonConstraintViolation = "CONSTRAINT_VIOLATION"
	ReasonAccessDenied        = "ACCESS_DENIED"
	ReasonInvalidRecord       = "INVALID_RECORD"
	ReasonInvalidFilter       = "INVALID_FILTER"
	ReasonNotFound            = "NOT_FOUND"
)

// withErrorInfo attaches a google.rpc.ErrorInfo detail. Failure to attach
// (a marshaling problem, never expected) falls back to the bare status
// rather than masking the domain error.
func withErrorInfo(st *status.Status, reason string, metadata map[string]string) error {
	detailed, err := st.WithDetails(&errdetails.ErrorInfo{
		Reason:   reason,
		Domain:   Domain,
		Metadata: metadata,
	})
	if err != nil {
		return st.Err()
	}
	return detailed.Err()
}

// UniqueViolation is a violated unique constraint: ALREADY_EXISTS
// carrying the constraint's declared agent-relayable message.
func UniqueViolation(constraintName, declaredMessage string) error {
	return withErrorInfo(
		status.New(codes.AlreadyExists, declaredMessage),
		ReasonConstraintViolation,
		map[string]string{"constraint": constraintName},
	)
}

// CheckViolation is a violated check/exists/not_exists constraint:
// FAILED_PRECONDITION carrying the constraint's declared message.
func CheckViolation(constraintName, declaredMessage string) error {
	return withErrorInfo(
		status.New(codes.FailedPrecondition, declaredMessage),
		ReasonConstraintViolation,
		map[string]string{"constraint": constraintName},
	)
}

// VerbDenied is a role/verb denial: the caller's resolved role holds no
// grant for the verb on the collection. The text is a fixed, relayable
// contract string — identical whether the caller is unbound, bound to a
// role without the grant, or the collection has no grants at all
// (deny-by-default must not leak which case occurred).
func VerbDenied(verb, collection string) error {
	return withErrorInfo(
		status.New(codes.PermissionDenied,
			fmt.Sprintf("you are not allowed to %s records in %s", verb, collection)),
		ReasonAccessDenied,
		map[string]string{"verb": verb, "collection": collection},
	)
}

// OwnScopeDenied is an own-scope denial: the caller holds the verb but
// only for records it created, and the target record is not theirs.
func OwnScopeDenied(verb, collection string) error {
	return withErrorInfo(
		status.New(codes.PermissionDenied,
			fmt.Sprintf("you may only %s records you created in %s", verb, collection)),
		ReasonAccessDenied,
		map[string]string{"verb": verb, "collection": collection, "scope": "own"},
	)
}

// InvalidRecord is a write-payload violation (unknown field, system
// field supplied, type mismatch, missing required field).
func InvalidRecord(format string, args ...any) error {
	return withErrorInfo(
		status.New(codes.InvalidArgument, fmt.Sprintf(format, args...)),
		ReasonInvalidRecord,
		nil,
	)
}

// InvalidFilter is a find-filter violation (unknown field, operator not
// in the field type's matrix, malformed value).
func InvalidFilter(format string, args ...any) error {
	return withErrorInfo(
		status.New(codes.InvalidArgument, fmt.Sprintf(format, args...)),
		ReasonInvalidFilter,
		nil,
	)
}

// DatastoreNotFound reports an unresolvable datastore slug.
func DatastoreNotFound(slug string) error {
	return withErrorInfo(
		status.New(codes.NotFound, fmt.Sprintf("datastore %q not found", slug)),
		ReasonNotFound,
		map[string]string{"datastore": slug},
	)
}

// CollectionNotFound reports an undeclared collection.
func CollectionNotFound(datastore, collection string) error {
	return withErrorInfo(
		status.New(codes.NotFound,
			fmt.Sprintf("collection %q not found in datastore %q", collection, datastore)),
		ReasonNotFound,
		map[string]string{"datastore": datastore, "collection": collection},
	)
}

// RecordNotFound reports a missing record id. It is also returned when an
// own-scoped READ grant hides a record that exists but belongs to another
// caller — the record's existence must not leak through the error.
func RecordNotFound(collection, id string) error {
	return withErrorInfo(
		status.New(codes.NotFound,
			fmt.Sprintf("record %q not found in collection %q", id, collection)),
		ReasonNotFound,
		map[string]string{"collection": collection, "record": id},
	)
}
