package reconcile

import "testing"

func TestDefaultOptions(t *testing.T) {
	opts := DefaultOptions()

	t.Run("is singleton", func(t *testing.T) {
		opts2 := DefaultOptions()
		if opts != opts2 {
			t.Error("expected DefaultOptions to return same instance")
		}
	})

	t.Run("prune is enabled", func(t *testing.T) {
		if !opts.IsPruneEnabled() {
			t.Error("expected prune to be enabled by default")
		}
	})

	t.Run("dry run is disabled", func(t *testing.T) {
		if opts.IsDryRun() {
			t.Error("expected dry run to be disabled by default")
		}
	})
}

func TestDryRunOptions(t *testing.T) {
	opts := DryRunOptions()

	t.Run("is singleton", func(t *testing.T) {
		opts2 := DryRunOptions()
		if opts != opts2 {
			t.Error("expected DryRunOptions to return same instance")
		}
	})

	t.Run("prune is enabled", func(t *testing.T) {
		if !opts.IsPruneEnabled() {
			t.Error("expected prune to be enabled")
		}
	})

	t.Run("dry run is enabled", func(t *testing.T) {
		if !opts.IsDryRun() {
			t.Error("expected dry run to be enabled")
		}
	})
}

func TestNoPruneOptions(t *testing.T) {
	opts := NoPruneOptions()

	t.Run("is singleton", func(t *testing.T) {
		opts2 := NoPruneOptions()
		if opts != opts2 {
			t.Error("expected NoPruneOptions to return same instance")
		}
	})

	t.Run("prune is disabled", func(t *testing.T) {
		if opts.IsPruneEnabled() {
			t.Error("expected prune to be disabled")
		}
	})

	t.Run("dry run is disabled", func(t *testing.T) {
		if opts.IsDryRun() {
			t.Error("expected dry run to be disabled")
		}
	})
}

func TestReconciliationOptions_WithPrune(t *testing.T) {
	t.Run("returns same instance when no change", func(t *testing.T) {
		opts := DefaultOptions()
		opts2 := opts.WithPrune(true)
		if opts != opts2 {
			t.Error("expected same instance when prune value unchanged")
		}
	})

	t.Run("returns new instance when changed", func(t *testing.T) {
		opts := DefaultOptions()
		opts2 := opts.WithPrune(false)
		if opts == opts2 {
			t.Error("expected new instance when prune value changed")
		}
	})

	t.Run("new instance has correct values", func(t *testing.T) {
		opts := DryRunOptions() // prune=true, dryRun=true
		opts2 := opts.WithPrune(false)

		if opts2.IsPruneEnabled() {
			t.Error("expected prune to be disabled")
		}
		if !opts2.IsDryRun() {
			t.Error("expected dryRun to remain true")
		}
	})

	t.Run("original is not modified", func(t *testing.T) {
		opts := DefaultOptions()
		_ = opts.WithPrune(false)
		if !opts.IsPruneEnabled() {
			t.Error("original options should not be modified")
		}
	})
}

func TestReconciliationOptions_WithDryRun(t *testing.T) {
	t.Run("returns same instance when no change", func(t *testing.T) {
		opts := DryRunOptions()
		opts2 := opts.WithDryRun(true)
		if opts != opts2 {
			t.Error("expected same instance when dryRun value unchanged")
		}
	})

	t.Run("returns new instance when changed", func(t *testing.T) {
		opts := DefaultOptions()
		opts2 := opts.WithDryRun(true)
		if opts == opts2 {
			t.Error("expected new instance when dryRun value changed")
		}
	})

	t.Run("new instance has correct values", func(t *testing.T) {
		opts := NoPruneOptions() // prune=false, dryRun=false
		opts2 := opts.WithDryRun(true)

		if opts2.IsPruneEnabled() {
			t.Error("expected prune to remain false")
		}
		if !opts2.IsDryRun() {
			t.Error("expected dryRun to be true")
		}
	})

	t.Run("original is not modified", func(t *testing.T) {
		opts := DefaultOptions()
		_ = opts.WithDryRun(true)
		if opts.IsDryRun() {
			t.Error("original options should not be modified")
		}
	})
}

func TestReconciliationOptions_Chaining(t *testing.T) {
	// Test that copy methods can be chained
	opts := DefaultOptions().WithPrune(false).WithDryRun(true)

	if opts.IsPruneEnabled() {
		t.Error("expected prune to be disabled")
	}
	if !opts.IsDryRun() {
		t.Error("expected dryRun to be enabled")
	}
}
