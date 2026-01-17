// Copyright 2026 Stigmer Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package backend

import (
	"fmt"

	"github.com/stigmer/stigmer/internal/backend/cloud"
	"github.com/stigmer/stigmer/internal/backend/local"
)

// NewBackend creates a backend instance based on configuration
func NewBackend(cfg *Config) (Backend, error) {
	if cfg == nil {
		return nil, fmt.Errorf("backend configuration is required")
	}

	switch cfg.Type {
	case "local":
		if cfg.Local == nil {
			return nil, fmt.Errorf("local backend configuration is required")
		}
		return local.NewBackend(cfg.Local.DBPath)

	case "cloud":
		if cfg.Cloud == nil {
			return nil, fmt.Errorf("cloud backend configuration is required")
		}
		return cloud.NewBackend(cfg.Cloud.Endpoint, cfg.Cloud.Token)

	default:
		return nil, fmt.Errorf("unknown backend type: %s (must be 'local' or 'cloud')", cfg.Type)
	}
}
