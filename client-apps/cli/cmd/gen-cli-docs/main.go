// gen-cli-docs generates MDX reference documentation for every stigmer CLI
// command by walking the Cobra command tree. Output is committed to
// docs/cli/commands/ and verified for freshness in CI.
//
// Each command may have a hand-written enrichment template that controls the
// page layout and prose content. The generator reads enrichment files from
// --enrichments-dir (co-located with Go source) and injects auto-generated
// sections (usage syntax, flags table, subcommands) at marked insertion
// points. Commands without enrichments get a default generated page.
//
// Enrichment markers:
//
//	{/* AUTO_USAGE */}        — replaced with ## Usage + syntax code block
//	{/* AUTO_FLAGS */}        — replaced with ## Options + flags table
//	{/* AUTO_GLOBAL_FLAGS */} — replaced with ## Global Flags + flags table
//	{/* AUTO_SUBCOMMANDS */}  — replaced with ## Subcommands + inline docs
//
// Usage:
//
//	go run ./cmd/gen-cli-docs --output ../../docs/cli/commands/
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
	stigmercli "github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer"
)

// groupOrder controls the display order for command groups in the sidebar and
// index page. This matches the order defined in root.go.
var groupOrder = []string{"core", "resource", "artifact", "server", "config"}

var groupTitles = map[string]string{
	"core":     "Core Commands",
	"resource": "Resource Management",
	"artifact": "Artifact Commands",
	"server":   "Server Commands",
	"config":   "Configuration",
}

// sectionHeaderRe matches terminal-style UPPERCASE section headers found in
// Cobra Long descriptions (e.g. "USAGE FORMS:", "ENVIRONMENT VARIABLES:").
var sectionHeaderRe = regexp.MustCompile(`^([A-Z][A-Z0-9]+(?: [A-Za-z0-9]+)*):\s*$`)

// angleBracketRe matches bare CLI placeholder tokens like <id>, <agent-ref>,
// <name-or-id> that MDX would otherwise parse as JSX elements.
var angleBracketRe = regexp.MustCompile(`<([a-zA-Z][a-zA-Z0-9_-]*)>`)

type flagDoc struct {
	Name      string
	Shorthand string
	Type      string
	Default   string
	Usage     string
}

func main() {
	outputDir := flag.String("output", "", "output directory for generated MDX docs")
	enrichmentsDir := flag.String("enrichments-dir", "", "directory containing hand-written enrichment templates (default: ./cmd/stigmer/root/docs/)")
	flag.Parse()

	if *outputDir == "" {
		fmt.Fprintln(os.Stderr, "error: --output is required")
		os.Exit(1)
	}

	if *enrichmentsDir == "" {
		*enrichmentsDir = "./cmd/stigmer/root/docs/"
	}

	if err := generate(*outputDir, *enrichmentsDir); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func generate(outputDir, enrichmentsDir string) error {
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("creating output directory: %w", err)
	}

	root := stigmercli.GetRootCommand()
	globalFlags := collectFlags(root.PersistentFlags())
	grouped := groupCommands(root)

	enriched := 0
	defaulted := 0
	for _, cmd := range root.Commands() {
		if skipCommand(cmd) {
			continue
		}
		content, wasEnriched := renderCommandPage(cmd, globalFlags, enrichmentsDir)
		if err := writeFile(outputDir, cmd.Name()+".mdx", content); err != nil {
			return fmt.Errorf("writing %s.mdx: %w", cmd.Name(), err)
		}
		if wasEnriched {
			enriched++
		} else {
			defaulted++
		}
	}

	if err := writeFile(outputDir, "index.mdx", renderIndexPage(grouped, globalFlags)); err != nil {
		return fmt.Errorf("writing index.mdx: %w", err)
	}

	if err := writeMetaJSON(outputDir, grouped); err != nil {
		return fmt.Errorf("writing meta.json: %w", err)
	}

	fmt.Printf("generated %d command pages (%d enriched, %d default) + index in %s\n",
		enriched+defaulted, enriched, defaulted, outputDir)
	return nil
}

// ---------------------------------------------------------------------------
// Command grouping
// ---------------------------------------------------------------------------

func skipCommand(cmd *cobra.Command) bool {
	return cmd.Hidden || cmd.Name() == "help" || cmd.GroupID == ""
}

func groupCommands(root *cobra.Command) map[string][]*cobra.Command {
	grouped := make(map[string][]*cobra.Command)
	for _, cmd := range root.Commands() {
		if skipCommand(cmd) {
			continue
		}
		grouped[cmd.GroupID] = append(grouped[cmd.GroupID], cmd)
	}
	return grouped
}

// ---------------------------------------------------------------------------
// Page rendering — individual command pages
// ---------------------------------------------------------------------------

// renderCommandPage produces the full MDX for a single command page. If a
// hand-written enrichment template exists for this command, the template
// controls the page layout and AUTO markers are replaced with generated
// content. Otherwise a default page is produced from the Cobra fields.
// The second return value indicates whether an enrichment was used.
func renderCommandPage(cmd *cobra.Command, globalFlags []flagDoc, enrichmentsDir string) (string, bool) {
	enrichmentPath := filepath.Join(enrichmentsDir, cmd.Name()+".mdx")
	enrichment, err := os.ReadFile(enrichmentPath)
	if err == nil && len(enrichment) > 0 {
		return renderEnrichedPage(cmd, globalFlags, string(enrichment)), true
	}
	return renderDefaultPage(cmd, globalFlags), false
}

// renderEnrichedPage builds a command page from a hand-written enrichment
// template. The enrichment controls the full page structure; AUTO markers
// are replaced with auto-generated content from the Cobra command tree.
func renderEnrichedPage(cmd *cobra.Command, globalFlags []flagDoc, enrichment string) string {
	var b strings.Builder

	writeFrontmatter(&b, cmd.CommandPath(), cmd.Short)

	replaced := enrichment
	replaced = strings.ReplaceAll(replaced, "{/* AUTO_USAGE */}", renderAutoUsage(cmd))
	replaced = strings.ReplaceAll(replaced, "{/* AUTO_FLAGS */}", renderAutoFlags(cmd))
	replaced = strings.ReplaceAll(replaced, "{/* AUTO_GLOBAL_FLAGS */}", renderAutoGlobalFlags(globalFlags))
	replaced = strings.ReplaceAll(replaced, "{/* AUTO_SUBCOMMANDS */}", renderAutoSubcommands(cmd))

	b.WriteString(strings.TrimSpace(replaced))
	b.WriteString("\n")

	return b.String()
}

// renderDefaultPage builds the default page layout used when no enrichment
// template exists. This is an improved version of the original generator
// output with a back-link to the command index.
func renderDefaultPage(cmd *cobra.Command, globalFlags []flagDoc) string {
	var b strings.Builder

	writeFrontmatter(&b, cmd.CommandPath(), cmd.Short)
	writeDescription(&b, cmd)

	b.WriteString("## Usage\n\n")
	fmt.Fprintf(&b, "```bash\n%s\n```\n\n", cmd.UseLine())

	writeFlags(&b, "Options", collectLocalFlags(cmd))
	writeFlags(&b, "Global Flags", globalFlags)
	writeExamples(&b, cmd)
	writeSubcommands(&b, cmd)

	b.WriteString("## See also\n\n")
	b.WriteString("- [Command Reference](./) — all available commands\n")

	return b.String()
}

// ---------------------------------------------------------------------------
// Auto-generated section renderers (for enrichment marker replacement)
// ---------------------------------------------------------------------------

func renderAutoUsage(cmd *cobra.Command) string {
	var b strings.Builder
	b.WriteString("## Usage\n\n")
	fmt.Fprintf(&b, "```bash\n%s\n```", cmd.UseLine())
	return b.String()
}

func renderAutoFlags(cmd *cobra.Command) string {
	flags := collectLocalFlags(cmd)
	if len(flags) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("## Options\n\n")
	writeFlagsTable(&b, flags)
	return strings.TrimRight(b.String(), "\n")
}

func renderAutoGlobalFlags(globalFlags []flagDoc) string {
	if len(globalFlags) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("## Global Flags\n\n")
	writeFlagsTable(&b, globalFlags)
	return strings.TrimRight(b.String(), "\n")
}

func renderAutoSubcommands(cmd *cobra.Command) string {
	subs := visibleSubcommands(cmd)
	if len(subs) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("## Subcommands\n\n")
	for _, sub := range subs {
		renderSubcommand(&b, sub)
	}
	return strings.TrimRight(b.String(), "\n")
}

// ---------------------------------------------------------------------------
// Page rendering — commands index page
// ---------------------------------------------------------------------------

func renderIndexPage(grouped map[string][]*cobra.Command, globalFlags []flagDoc) string {
	var b strings.Builder

	writeFrontmatter(&b, "Command Reference", "Complete reference for all stigmer CLI commands.")
	b.WriteString("Complete reference for all `stigmer` CLI commands, organized by category.\n\n")

	for _, gid := range groupOrder {
		cmds := grouped[gid]
		if len(cmds) == 0 {
			continue
		}
		fmt.Fprintf(&b, "## %s\n\n", groupTitles[gid])
		b.WriteString("| Command | Description |\n")
		b.WriteString("|---------|-------------|\n")
		for _, cmd := range cmds {
			fmt.Fprintf(&b, "| [`%s`](./%s) | %s |\n",
				cmd.CommandPath(), cmd.Name(), escapeTable(cmd.Short))
		}
		b.WriteString("\n")
	}

	if len(globalFlags) > 0 {
		b.WriteString("## Global Flags\n\n")
		b.WriteString("These flags are available on every command.\n\n")
		writeFlagsTable(&b, globalFlags)
		b.WriteString("\n")
	}

	return b.String()
}

// ---------------------------------------------------------------------------
// Section writers
// ---------------------------------------------------------------------------

func writeFrontmatter(b *strings.Builder, title, description string) {
	b.WriteString("---\n")
	fmt.Fprintf(b, "title: %s\n", escapeYAML(title))
	fmt.Fprintf(b, "description: %s\n", escapeYAML(description))
	b.WriteString("---\n\n")
	b.WriteString("{/* Auto-generated by gen-cli-docs. Do not edit manually. */}\n")
	b.WriteString("{/* To enrich this page, create an enrichment template in client-apps/cli/cmd/stigmer/root/docs/ */}\n\n")
}

func writeDescription(b *strings.Builder, cmd *cobra.Command) {
	desc := cmd.Long
	if desc == "" {
		desc = cmd.Short
	}
	b.WriteString(formatLongDescription(desc))
	b.WriteString("\n\n")
}

func writeFlags(b *strings.Builder, heading string, flags []flagDoc) {
	if len(flags) == 0 {
		return
	}
	fmt.Fprintf(b, "## %s\n\n", heading)
	writeFlagsTable(b, flags)
	b.WriteString("\n")
}

func writeExamples(b *strings.Builder, cmd *cobra.Command) {
	if cmd.Example == "" {
		return
	}
	b.WriteString("## Examples\n\n")
	b.WriteString("```bash\n")
	b.WriteString(strings.TrimSpace(dedent(cmd.Example)))
	b.WriteString("\n```\n\n")
}

func writeSubcommands(b *strings.Builder, cmd *cobra.Command) {
	subs := visibleSubcommands(cmd)
	if len(subs) == 0 {
		return
	}
	b.WriteString("## Subcommands\n\n")
	for _, sub := range subs {
		renderSubcommand(b, sub)
	}
}

func renderSubcommand(b *strings.Builder, sub *cobra.Command) {
	fmt.Fprintf(b, "### %s\n\n", sub.CommandPath())

	desc := sub.Long
	if desc == "" {
		desc = sub.Short
	}
	if desc != "" {
		b.WriteString(formatLongDescription(desc))
		b.WriteString("\n\n")
	}

	fmt.Fprintf(b, "```bash\n%s\n```\n\n", sub.UseLine())

	flags := collectLocalFlags(sub)
	if len(flags) > 0 {
		writeFlagsTable(b, flags)
		b.WriteString("\n")
	}

	if sub.Example != "" {
		b.WriteString("```bash\n")
		b.WriteString(strings.TrimSpace(dedent(sub.Example)))
		b.WriteString("\n```\n\n")
	}
}

// ---------------------------------------------------------------------------
// Text formatting
// ---------------------------------------------------------------------------

// formatLongDescription converts terminal-formatted Cobra Long descriptions to
// web-friendly markdown. UPPERCASE SECTION: headers become ### headings, and
// two-space leading indentation (Cobra convention) is stripped.
func formatLongDescription(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}

	lines := strings.Split(s, "\n")
	var result []string

	for _, line := range lines {
		if m := sectionHeaderRe.FindStringSubmatch(line); m != nil {
			result = append(result, "", "### "+toTitleCase(m[1]), "")
			continue
		}
		if len(line) >= 2 && line[:2] == "  " {
			line = line[2:]
		}
		result = append(result, line)
	}

	return escapeMDX(collapseBlankLines(strings.TrimSpace(strings.Join(result, "\n"))))
}

// collapseBlankLines replaces runs of 2+ consecutive blank lines with a single
// blank line so that section header insertion doesn't produce extra whitespace.
func collapseBlankLines(s string) string {
	var b strings.Builder
	prevBlank := false
	for _, line := range strings.Split(s, "\n") {
		blank := strings.TrimSpace(line) == ""
		if blank && prevBlank {
			continue
		}
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(line)
		prevBlank = blank
	}
	return b.String()
}

// toTitleCase converts "USAGE FORMS" to "Usage Forms".
func toTitleCase(s string) string {
	words := strings.Fields(strings.ToLower(s))
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}

// dedent removes the common leading whitespace from all non-empty lines.
func dedent(s string) string {
	lines := strings.Split(s, "\n")
	minIndent := -1
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		indent := len(line) - len(strings.TrimLeft(line, " \t"))
		if minIndent < 0 || indent < minIndent {
			minIndent = indent
		}
	}
	if minIndent <= 0 {
		return s
	}
	for i, line := range lines {
		if len(line) > minIndent {
			lines[i] = line[minIndent:]
		} else if strings.TrimSpace(line) == "" {
			lines[i] = ""
		}
	}
	return strings.Join(lines, "\n")
}

// ---------------------------------------------------------------------------
// Flags table rendering
// ---------------------------------------------------------------------------

func writeFlagsTable(b *strings.Builder, flags []flagDoc) {
	b.WriteString("| Flag | Type | Default | Description |\n")
	b.WriteString("|------|------|---------|-------------|\n")
	for _, f := range flags {
		fmt.Fprintf(b, "| %s | `%s` | %s | %s |\n",
			formatFlagName(f), f.Type, formatDefault(f), escapeTable(f.Usage))
	}
}

func formatFlagName(f flagDoc) string {
	name := "`--" + f.Name + "`"
	if f.Shorthand != "" {
		name += ", `-" + f.Shorthand + "`"
	}
	return name
}

func formatDefault(f flagDoc) string {
	switch {
	case f.Default == "" || f.Default == "[]":
		return ""
	case f.Type == "bool" && f.Default == "false":
		return ""
	case f.Type == "int" && f.Default == "0":
		return ""
	default:
		return "`" + f.Default + "`"
	}
}

// ---------------------------------------------------------------------------
// Flag collection
// ---------------------------------------------------------------------------

func collectFlags(fs *pflag.FlagSet) []flagDoc {
	var flags []flagDoc
	fs.VisitAll(func(f *pflag.Flag) {
		if f.Hidden || f.Name == "help" {
			return
		}
		flags = append(flags, flagDoc{
			Name:      f.Name,
			Shorthand: f.Shorthand,
			Type:      f.Value.Type(),
			Default:   f.DefValue,
			Usage:     f.Usage,
		})
	})
	return flags
}

func collectLocalFlags(cmd *cobra.Command) []flagDoc {
	var flags []flagDoc
	cmd.NonInheritedFlags().VisitAll(func(f *pflag.Flag) {
		if f.Hidden || f.Name == "help" {
			return
		}
		flags = append(flags, flagDoc{
			Name:      f.Name,
			Shorthand: f.Shorthand,
			Type:      f.Value.Type(),
			Default:   f.DefValue,
			Usage:     f.Usage,
		})
	})
	return flags
}

func visibleSubcommands(cmd *cobra.Command) []*cobra.Command {
	var subs []*cobra.Command
	for _, sub := range cmd.Commands() {
		if !sub.Hidden && sub.Name() != "help" {
			subs = append(subs, sub)
		}
	}
	return subs
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

func escapeYAML(s string) string {
	if strings.ContainsAny(s, ":#{}[]&*!|>'\"@`") {
		return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"`
	}
	return s
}

func escapeTable(s string) string {
	return escapeMDX(strings.ReplaceAll(s, "|", "\\|"))
}

// escapeMDX makes prose text safe for MDX by escaping characters that the MDX
// compiler would otherwise parse as JSX. Bare <placeholder> tokens are wrapped
// in backticks for readable rendering; remaining angle brackets and curly braces
// outside backtick code spans are backslash-escaped.
func escapeMDX(s string) string {
	s = angleBracketRe.ReplaceAllString(s, "`<$1>`")

	var b strings.Builder
	b.Grow(len(s))
	inCode := false
	for i := 0; i < len(s); i++ {
		switch {
		case s[i] == '`':
			inCode = !inCode
			b.WriteByte('`')
		case !inCode && s[i] == '<':
			b.WriteString("\\<")
		case !inCode && s[i] == '{':
			b.WriteString("\\{")
		case !inCode && s[i] == '}':
			b.WriteString("\\}")
		default:
			b.WriteByte(s[i])
		}
	}
	return b.String()
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

func writeFile(dir, name, content string) error {
	return os.WriteFile(filepath.Join(dir, name), []byte(content), 0644)
}

func writeMetaJSON(dir string, grouped map[string][]*cobra.Command) error {
	pages := []string{"index"}
	for _, gid := range groupOrder {
		cmds := grouped[gid]
		if len(cmds) == 0 {
			continue
		}
		pages = append(pages, "---"+groupTitles[gid]+"---")
		for _, cmd := range cmds {
			pages = append(pages, cmd.Name())
		}
	}

	meta := map[string]any{
		"title": "Commands",
		"pages": pages,
	}

	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return writeFile(dir, "meta.json", string(data)+"\n")
}
