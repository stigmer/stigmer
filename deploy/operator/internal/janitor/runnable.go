// The janitor's loop: a sweep on every tick while this operator leads, so
// a Stigmer deleted while the operator was down is cleaned up when it comes
// back, and a draining prerequisite is swept again until it is gone. A
// sweep with nothing to do says nothing; a sweep whose verdicts changed
// logs them once, at info level, in words.

package janitor

import (
	"context"
	"fmt"
	"strings"
	"time"

	"sigs.k8s.io/controller-runtime/pkg/manager"

	logf "sigs.k8s.io/controller-runtime/pkg/log"
)

// Runnable sweeps every interval; the manager runs it only on the leader.
func Runnable(c Client, every time.Duration) manager.RunnableFunc {
	return func(ctx context.Context) error {
		log := logf.FromContext(ctx).WithName("janitor")
		last := ""
		ticker := time.NewTicker(every)
		defer ticker.Stop()
		for {
			outcomes, err := Sweep(ctx, c)
			switch {
			case err != nil:
				// Retried on the next tick; an API hiccup is not an error worth
				// paging on.
				log.Info("sweep failed, retrying", "reason", err.Error())
			case outcomes != nil:
				// Say every change, and the sweep that finishes a cleanup; stay
				// quiet while there was never anything to do.
				if summary := summarize(outcomes); summary != last && (last != "" || !nothingToDo(outcomes)) {
					log.Info("cleaned up after the last Stigmer", "verdicts", summary)
					last = summary
				}
			}
			select {
			case <-ctx.Done():
				return nil
			case <-ticker.C:
			}
		}
	}
}

func summarize(outcomes []Outcome) string {
	parts := make([]string, 0, len(outcomes))
	for _, o := range outcomes {
		part := fmt.Sprintf("%s: %s", o.Name, o.Verdict)
		if o.Detail != "" {
			part += " (" + o.Detail + ")"
		}
		parts = append(parts, part)
	}
	return strings.Join(parts, "; ")
}

// nothingToDo reports a sweep that found nothing of the operator's: every
// prerequisite removed or someone else's, with no detail to tell.
func nothingToDo(outcomes []Outcome) bool {
	for _, o := range outcomes {
		if o.Verdict != Removed && o.Verdict != KeptForeign || o.Detail != "" {
			return false
		}
	}
	return true
}
