package activityv1

// Deliberate type error for the 20260904.04 Stage A gate proof on PR #1040.
// This commit is reverted in the next one; squash-merge erases both.
var broken int = "not an int"
