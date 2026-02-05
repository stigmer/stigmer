package reconcile

// ChangeType represents the type of operation to perform during reconciliation.
//
// ChangeType is used in ResourceChange to indicate whether a resource should be
// created, updated, or deleted. It forms the core classification for the diff
// algorithm that compares desired state with actual state.
//
// This is an enumeration type implemented using typed constants. The zero value
// is explicitly invalid to catch uninitialized values.
//
// Example:
//
//	change := NewCreateChange(key, resource)
//	if change.ChangeType() == ChangeTypeCreate {
//	    // Handle creation
//	}
type ChangeType int

const (
	// changeTypeInvalid is the zero value and represents an uninitialized ChangeType.
	// This is unexported to prevent external use.
	changeTypeInvalid ChangeType = iota

	// ChangeTypeCreate indicates a resource should be created.
	// The resource exists in desired state but not in actual state.
	ChangeTypeCreate

	// ChangeTypeUpdate indicates a resource should be updated.
	// The resource exists in both states but the specs differ.
	ChangeTypeUpdate

	// ChangeTypeDelete indicates a resource should be deleted.
	// The resource exists in actual state but not in desired state (orphan).
	ChangeTypeDelete
)

// changeTypeStrings maps ChangeType values to their string representations.
var changeTypeStrings = map[ChangeType]string{
	ChangeTypeCreate: "create",
	ChangeTypeUpdate: "update",
	ChangeTypeDelete: "delete",
}

// String returns the string representation of the ChangeType.
//
// Returns "create", "update", or "delete" for valid types.
// Returns "invalid" for the zero value or unknown values.
//
// Implements fmt.Stringer for clean printing and logging.
func (c ChangeType) String() string {
	if s, ok := changeTypeStrings[c]; ok {
		return s
	}
	return "invalid"
}

// IsValid returns true if this is a valid ChangeType (Create, Update, or Delete).
//
// The zero value and any other undefined values return false.
func (c ChangeType) IsValid() bool {
	_, ok := changeTypeStrings[c]
	return ok
}
