//go:build e2e
// +build e2e

package e2e

import (
	"regexp"
	"strings"
	"unicode"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// ValidationResult holds the result of a validation check
type ValidationResult struct {
	Passed bool
	Reason string
}

// ExecutionValidator provides deterministic validation for agent executions
type ExecutionValidator struct {
	execution *agentexecutionv1.AgentExecution
	messages  []string
}

// NewExecutionValidator creates a validator for an execution
func NewExecutionValidator(execution *agentexecutionv1.AgentExecution) *ExecutionValidator {
	var messages []string
	if execution.Status != nil {
		messages = make([]string, len(execution.Status.Messages))
		for i, msg := range execution.Status.Messages {
			messages[i] = msg.Content
		}
	}

	return &ExecutionValidator{
		execution: execution,
		messages:  messages,
	}
}

// ===================================================================
// TIER 1: EXECUTION STATUS VALIDATION (MUST PASS)
// ===================================================================

// ValidateCompleted checks if execution reached completed state
func (v *ExecutionValidator) ValidateCompleted() ValidationResult {
	if v.execution.Status == nil {
		return ValidationResult{false, "execution has no status"}
	}

	if v.execution.Status.Phase != agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED {
		return ValidationResult{
			false,
			"execution phase is " + v.execution.Status.Phase.String() + ", expected EXECUTION_COMPLETED",
		}
	}

	return ValidationResult{true, "execution completed successfully"}
}

// ValidateNotFailed checks if execution did not fail
func (v *ExecutionValidator) ValidateNotFailed() ValidationResult {
	if v.execution.Status == nil {
		return ValidationResult{false, "execution has no status"}
	}

	if v.execution.Status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED {
		return ValidationResult{false, "execution failed"}
	}

	return ValidationResult{true, "execution did not fail"}
}

// ValidateHasMessages checks if execution produced at least one message
func (v *ExecutionValidator) ValidateHasMessages() ValidationResult {
	if len(v.messages) == 0 {
		return ValidationResult{false, "execution has no messages"}
	}

	return ValidationResult{true, "execution has messages"}
}

// ===================================================================
// TIER 2: OUTPUT QUALITY VALIDATION (MUST PASS)
// ===================================================================

// ValidateOutputNotEmpty checks if the last message has content
func (v *ExecutionValidator) ValidateOutputNotEmpty() ValidationResult {
	if len(v.messages) == 0 {
		return ValidationResult{false, "no messages to validate"}
	}

	lastMsg := v.messages[len(v.messages)-1]
	if len(strings.TrimSpace(lastMsg)) == 0 {
		return ValidationResult{false, "last message is empty"}
	}

	return ValidationResult{true, "output is not empty"}
}

// ValidateOutputMinLength checks if output meets minimum length requirement
func (v *ExecutionValidator) ValidateOutputMinLength(minLength int) ValidationResult {
	if len(v.messages) == 0 {
		return ValidationResult{false, "no messages to validate"}
	}

	lastMsg := v.messages[len(v.messages)-1]
	if len(lastMsg) < minLength {
		return ValidationResult{
			false,
			"output length is " + string(rune(len(lastMsg))) + " chars, expected at least " + string(rune(minLength)),
		}
	}

	return ValidationResult{true, "output meets minimum length"}
}

// ValidateNotGibberish checks if output is not random characters
func (v *ExecutionValidator) ValidateNotGibberish() ValidationResult {
	if len(v.messages) == 0 {
		return ValidationResult{false, "no messages to validate"}
	}

	lastMsg := v.messages[len(v.messages)-1]

	// Check 1: Too many repeated characters (e.g., "aaaaaaa", "........")
	if hasExcessiveRepeatedChars(lastMsg) {
		return ValidationResult{false, "output contains excessive repeated characters"}
	}

	// Check 2: No vowels in long text (likely keyboard mashing)
	if len(lastMsg) > 20 && !hasVowels(lastMsg) {
		return ValidationResult{false, "output has no vowels (likely gibberish)"}
	}

	// Check 3: Too low ratio of letters to total characters
	if hasLowLetterRatio(lastMsg) {
		return ValidationResult{false, "output has too few letters (likely gibberish)"}
	}

	// Check 4: Common keyboard mashing patterns
	if hasKeyboardMashing(lastMsg) {
		return ValidationResult{false, "output contains keyboard mashing patterns"}
	}

	return ValidationResult{true, "output is not gibberish"}
}

// ValidateNotErrorMessage checks if output doesn't contain error indicators
func (v *ExecutionValidator) ValidateNotErrorMessage() ValidationResult {
	if len(v.messages) == 0 {
		return ValidationResult{false, "no messages to validate"}
	}

	lastMsg := strings.ToLower(v.messages[len(v.messages)-1])

	// Check for common error patterns
	errorPatterns := []string{
		"error:",
		"exception:",
		"failed to",
		"undefined",
		"null pointer",
		"traceback",
		"stack trace",
		"fatal:",
		"panic:",
	}

	for _, pattern := range errorPatterns {
		if strings.Contains(lastMsg, pattern) {
			return ValidationResult{false, "output contains error indicator: " + pattern}
		}
	}

	return ValidationResult{true, "output does not contain error indicators"}
}

// ValidateHasSentenceStructure checks if output has basic sentence structure
func (v *ExecutionValidator) ValidateHasSentenceStructure() ValidationResult {
	if len(v.messages) == 0 {
		return ValidationResult{false, "no messages to validate"}
	}

	lastMsg := v.messages[len(v.messages)-1]

	// Check for sentence-ending punctuation
	hasPunctuation := strings.ContainsAny(lastMsg, ".!?")
	
	// Check for capital letters (start of sentences)
	hasCapitals := hasUpperCase(lastMsg)

	// Check for spaces (words separated)
	hasSpaces := strings.Contains(lastMsg, " ")

	if !hasPunctuation && !hasCapitals {
		return ValidationResult{false, "output lacks basic sentence structure (no punctuation or capitals)"}
	}

	if !hasSpaces && len(lastMsg) > 20 {
		return ValidationResult{false, "output has no spaces (not human-readable)"}
	}

	return ValidationResult{true, "output has basic sentence structure"}
}

// ===================================================================
// TIER 3: BEHAVIORAL VALIDATION (SHOULD PASS)
// ===================================================================

// ValidateContainsKeywords checks if output contains expected keywords
func (v *ExecutionValidator) ValidateContainsKeywords(keywords []string, mode string) ValidationResult {
	if len(v.messages) == 0 {
		return ValidationResult{false, "no messages to validate"}
	}

	lastMsg := strings.ToLower(v.messages[len(v.messages)-1])

	switch mode {
	case "any":
		// At least one keyword must be present
		for _, keyword := range keywords {
			if strings.Contains(lastMsg, strings.ToLower(keyword)) {
				return ValidationResult{true, "output contains keyword: " + keyword}
			}
		}
		return ValidationResult{false, "output does not contain any of the expected keywords"}

	case "all":
		// All keywords must be present
		for _, keyword := range keywords {
			if !strings.Contains(lastMsg, strings.ToLower(keyword)) {
				return ValidationResult{false, "output missing keyword: " + keyword}
			}
		}
		return ValidationResult{true, "output contains all expected keywords"}

	default:
		return ValidationResult{false, "invalid validation mode: " + mode}
	}
}

// ValidateMatchesPattern checks if output matches a regex pattern
func (v *ExecutionValidator) ValidateMatchesPattern(pattern string, description string) ValidationResult {
	if len(v.messages) == 0 {
		return ValidationResult{false, "no messages to validate"}
	}

	lastMsg := v.messages[len(v.messages)-1]

	re, err := regexp.Compile(pattern)
	if err != nil {
		return ValidationResult{false, "invalid regex pattern: " + err.Error()}
	}

	if !re.MatchString(lastMsg) {
		return ValidationResult{false, "output does not match pattern: " + description}
	}

	return ValidationResult{true, "output matches expected pattern"}
}

// ValidateDoesNotContain checks if output doesn't contain unwanted phrases
func (v *ExecutionValidator) ValidateDoesNotContain(phrases []string) ValidationResult {
	if len(v.messages) == 0 {
		return ValidationResult{false, "no messages to validate"}
	}

	lastMsg := strings.ToLower(v.messages[len(v.messages)-1])

	for _, phrase := range phrases {
		if strings.Contains(lastMsg, strings.ToLower(phrase)) {
			return ValidationResult{false, "output contains unwanted phrase: " + phrase}
		}
	}

	return ValidationResult{true, "output does not contain unwanted phrases"}
}

// ===================================================================
// HELPER FUNCTIONS
// ===================================================================

// hasExcessiveRepeatedChars checks for patterns like "aaaaaaa" or "........"
func hasExcessiveRepeatedChars(text string) bool {
	if len(text) < 5 {
		return false
	}

	consecutiveCount := 1
	var prevChar rune

	for _, char := range text {
		if char == prevChar {
			consecutiveCount++
			if consecutiveCount >= 5 {
				return true
			}
		} else {
			consecutiveCount = 1
			prevChar = char
		}
	}

	return false
}

// hasVowels checks if text contains vowels
func hasVowels(text string) bool {
	vowels := "aeiouAEIOU"
	return strings.ContainsAny(text, vowels)
}

// hasLowLetterRatio checks if text has too few letters compared to total length
func hasLowLetterRatio(text string) bool {
	if len(text) < 10 {
		return false
	}

	letterCount := 0
	for _, char := range text {
		if unicode.IsLetter(char) {
			letterCount++
		}
	}

	ratio := float64(letterCount) / float64(len(text))
	return ratio < 0.3 // Less than 30% letters is suspicious
}

// hasKeyboardMashing checks for common keyboard mashing patterns
func hasKeyboardMashing(text string) bool {
	patterns := []string{
		"asdfasdf",
		"qwerqwer",
		"zxcvzxcv",
		"hjkl",
		"asdf",
		"qwerty",
		"jkl;",
	}

	lowerText := strings.ToLower(text)
	for _, pattern := range patterns {
		if strings.Contains(lowerText, pattern) {
			return true
		}
	}

	return false
}

// hasUpperCase checks if text contains uppercase letters
func hasUpperCase(text string) bool {
	for _, char := range text {
		if unicode.IsUpper(char) {
			return true
		}
	}
	return false
}

// GetLastMessage returns the last message from the execution
func (v *ExecutionValidator) GetLastMessage() string {
	if len(v.messages) == 0 {
		return ""
	}
	return v.messages[len(v.messages)-1]
}

// GetAllMessages returns all messages from the execution
func (v *ExecutionValidator) GetAllMessages() []string {
	return v.messages
}
