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

package tasks

import (
	"context"
	"fmt"

	workflowtasks "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/notification"
	"go.temporal.io/sdk/activity"
)

func init() {
	activitiesRegistry = append(activitiesRegistry, &NotificationActivities{})
}

// NotificationActivities implements the Temporal activity for notification tasks.
type NotificationActivities struct{}

// NotificationActivity sends a notification through the configured channel provider.
func (a *NotificationActivities) NotificationActivity(
	ctx context.Context,
	config *workflowtasks.NotificationTaskConfig,
	input any,
	runtimeEnv map[string]any,
) (any, error) {
	logger := activity.GetLogger(ctx)

	// Resolve JIT placeholders in string fields
	resolvedBody := config.Body
	resolvedSubject := config.Subject
	resolvedRecipients := make([]string, len(config.Recipients))
	copy(resolvedRecipients, config.Recipients)

	if runtimeEnv != nil {
		var err error
		if resolvedBody, err = ResolvePlaceholders(config.Body, runtimeEnv); err != nil {
			return nil, fmt.Errorf("failed to resolve body placeholders: %w", err)
		}
		if config.Subject != "" {
			if resolvedSubject, err = ResolvePlaceholders(config.Subject, runtimeEnv); err != nil {
				return nil, fmt.Errorf("failed to resolve subject placeholders: %w", err)
			}
		}
		for i, r := range resolvedRecipients {
			if resolvedRecipients[i], err = ResolvePlaceholders(r, runtimeEnv); err != nil {
				return nil, fmt.Errorf("failed to resolve recipient placeholders: %w", err)
			}
		}
	}

	// Resolve metadata values
	resolvedMetadata := make(map[string]string, len(config.Metadata))
	for k, v := range config.Metadata {
		resolved := v
		if runtimeEnv != nil {
			var err error
			if resolved, err = ResolvePlaceholders(v, runtimeEnv); err != nil {
				return nil, fmt.Errorf("failed to resolve metadata[%s] placeholders: %w", k, err)
			}
		}
		resolvedMetadata[k] = resolved
	}

	provider, err := notification.Get(config.Channel)
	if err != nil {
		return nil, err
	}

	logger.Info("Sending notification",
		"channel", config.Channel,
		"recipients_count", len(resolvedRecipients))

	result, err := provider.Send(ctx, notification.NotificationRequest{
		Channel:    config.Channel,
		Recipients: resolvedRecipients,
		Subject:    resolvedSubject,
		Body:       resolvedBody,
		Template:   config.Template,
		Metadata:   resolvedMetadata,
	})
	if err != nil {
		return nil, fmt.Errorf("notification delivery failed: %w", err)
	}

	return result, nil
}
