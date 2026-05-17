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

package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

func init() {
	Register(&WebhookProvider{
		client: &http.Client{Timeout: 30 * time.Second},
	})
}

// WebhookProvider sends notifications via HTTP POST to recipient URLs.
type WebhookProvider struct {
	client *http.Client
}

func (w *WebhookProvider) Channel() string { return "webhook" }

func (w *WebhookProvider) Send(ctx context.Context, req NotificationRequest) (*NotificationResult, error) {
	payload := map[string]any{
		"subject":  req.Subject,
		"body":     req.Body,
		"metadata": req.Metadata,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal webhook payload: %w", err)
	}

	now := time.Now().UTC().Format(time.RFC3339)

	for _, url := range req.Recipients {
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return &NotificationResult{
				Channel:    "webhook",
				Recipients: req.Recipients,
				Delivered:  false,
				Error:      fmt.Sprintf("failed to create request for %s: %s", url, err),
			}, nil
		}
		httpReq.Header.Set("Content-Type", "application/json")

		resp, err := w.client.Do(httpReq)
		if err != nil {
			return &NotificationResult{
				Channel:    "webhook",
				Recipients: req.Recipients,
				Delivered:  false,
				Error:      fmt.Sprintf("webhook delivery to %s failed: %s", url, err),
			}, nil
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()

		if resp.StatusCode >= 400 {
			return &NotificationResult{
				Channel:    "webhook",
				Recipients: req.Recipients,
				Delivered:  false,
				Error:      fmt.Sprintf("webhook %s returned status %d", url, resp.StatusCode),
			}, nil
		}
	}

	return &NotificationResult{
		Channel:     "webhook",
		Recipients:  req.Recipients,
		Delivered:   true,
		DeliveredAt: now,
	}, nil
}
