package main

import (
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
	stigmercli "github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer"
)

func TestCommandDocCoverage(t *testing.T) {
	root := stigmercli.GetRootCommand()

	for _, cmd := range root.Commands() {
		if cmd.Hidden || cmd.Name() == "help" {
			continue
		}

		t.Run(cmd.CommandPath(), func(t *testing.T) {
			if cmd.Short == "" {
				t.Errorf("%s: missing Short description", cmd.CommandPath())
			}

			if cmd.GroupID != "" && cmd.Long == "" {
				t.Errorf("%s: grouped command missing Long description", cmd.CommandPath())
			}

			checkSubcommands(t, cmd)
		})
	}
}

func checkSubcommands(t *testing.T, parent *cobra.Command) {
	t.Helper()
	for _, sub := range parent.Commands() {
		if sub.Hidden || sub.Name() == "help" {
			continue
		}
		t.Run(sub.CommandPath(), func(t *testing.T) {
			if sub.Short == "" {
				t.Errorf("%s: missing Short description", sub.CommandPath())
			}
		})

		checkSubcommands(t, sub)
	}
}

func TestFlagUsageCoverage(t *testing.T) {
	root := stigmercli.GetRootCommand()

	var walk func(cmd *cobra.Command)
	walk = func(cmd *cobra.Command) {
		if cmd.Hidden || cmd.Name() == "help" {
			return
		}

		cmd.NonInheritedFlags().VisitAll(func(f *pflag.Flag) {
			if f.Hidden || f.Name == "help" {
				return
			}
			if f.Usage == "" {
				t.Errorf("%s: flag --%s has empty Usage string", cmd.CommandPath(), f.Name)
			}
		})

		for _, sub := range cmd.Commands() {
			walk(sub)
		}
	}

	for _, cmd := range root.Commands() {
		walk(cmd)
	}
}
