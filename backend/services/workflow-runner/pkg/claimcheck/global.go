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

package claimcheck

import (
	"sync"
)

var (
	globalManager *Manager
	managerMutex  sync.RWMutex
)

// SetGlobalManager sets the global Claim Check Manager instance
// This should be called once during worker initialization
func SetGlobalManager(mgr *Manager) {
	managerMutex.Lock()
	defer managerMutex.Unlock()
	globalManager = mgr
}

// GetGlobalManager returns the global Claim Check Manager instance
// Returns nil if Claim Check is disabled
func GetGlobalManager() *Manager {
	managerMutex.RLock()
	defer managerMutex.RUnlock()
	return globalManager
}

// IsEnabled returns true if Claim Check is enabled
func IsEnabled() bool {
	return GetGlobalManager() != nil
}
