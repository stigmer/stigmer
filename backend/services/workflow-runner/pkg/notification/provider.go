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
	"context"
	"fmt"
	"sync"
)

// NotificationRequest holds the resolved notification content.
type NotificationRequest struct {
	Channel    string
	Recipients []string
	Subject    string
	Body       string
	Template   string
	Metadata   map[string]string
}

// NotificationResult describes delivery outcome.
type NotificationResult struct {
	Channel     string   `json:"channel"`
	Recipients  []string `json:"recipients"`
	Delivered   bool     `json:"delivered"`
	DeliveredAt string   `json:"delivered_at,omitempty"`
	Error       string   `json:"error,omitempty"`
}

// Provider sends notifications through a specific channel.
type Provider interface {
	Send(ctx context.Context, req NotificationRequest) (*NotificationResult, error)
	Channel() string
}

var (
	mu        sync.RWMutex
	providers = map[string]Provider{}
)

// Register adds a provider for the given channel.
func Register(p Provider) {
	mu.Lock()
	defer mu.Unlock()
	providers[p.Channel()] = p
}

// Get returns the provider for the given channel, or an error if not found.
func Get(channel string) (Provider, error) {
	mu.RLock()
	defer mu.RUnlock()
	p, ok := providers[channel]
	if !ok {
		return nil, fmt.Errorf("notification channel '%s' is not implemented; available channels: webhook", channel)
	}
	return p, nil
}
