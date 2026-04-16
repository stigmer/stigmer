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

package dotenv

import (
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
)

// Load loads environment variables from .env file for local development.
// Tries multiple paths and fails silently if not found (expected in production).
func Load() {
	if err := godotenv.Load("backend/services/workflow-runner/.env"); err == nil {
		return
	}

	if err := godotenv.Load(".env"); err == nil {
		return
	}

	if exe, err := os.Executable(); err == nil {
		envFile := filepath.Join(filepath.Dir(exe), ".env")
		if err := godotenv.Load(envFile); err == nil {
			return
		}
	}
}
