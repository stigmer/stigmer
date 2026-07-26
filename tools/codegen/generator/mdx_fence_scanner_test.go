package main

import (
	"strings"
	"testing"
)

func TestScanMarkdownFences(t *testing.T) {
	cases := []struct {
		name    string
		src     string
		want    []codeFence
		wantErr string // substring the error must contain; "" means no error
	}{
		{
			name: "basic fence with language",
			src:  "# Title\n\n```yaml\nfoo: bar\n```\n",
			want: []codeFence{{Line: 3, Lang: "yaml", Body: "foo: bar\n"}},
		},
		{
			name: "info string meta is captured separately",
			src:  "```yaml no-validate=\"fragment: shows one field\"\nfoo: bar\n```\n",
			want: []codeFence{{Line: 1, Lang: "yaml", Meta: `no-validate="fragment: shows one field"`, Body: "foo: bar\n"}},
		},
		{
			name: "four-backtick block shields an inner yaml fence",
			src:  "````mdx\nprose\n```yaml\nfoo: bar\n```\nmore prose\n````\n",
			want: []codeFence{{Line: 1, Lang: "mdx", Body: "prose\n```yaml\nfoo: bar\n```\nmore prose\n"}},
		},
		{
			name: "indented fence has its indentation stripped",
			src:  "1. step\n\n   ```yaml\n   foo: bar\n   ```\n",
			want: []codeFence{{Line: 3, Lang: "yaml", Body: "foo: bar\n"}},
		},
		{
			name: "closing fence may be longer than the opener",
			src:  "```go\nfunc main() {}\n````\n",
			want: []codeFence{{Line: 1, Lang: "go", Body: "func main() {}\n"}},
		},
		{
			name: "shorter backtick run does not close the fence",
			src:  "````text\n```\nstill inside\n````\n",
			want: []codeFence{{Line: 1, Lang: "text", Body: "```\nstill inside\n"}},
		},
		{
			name: "empty fence body",
			src:  "```yaml\n```\n",
			want: []codeFence{{Line: 1, Lang: "yaml", Body: ""}},
		},
		{
			name: "line with backtick in info string is not a fence",
			src:  "```foo`bar\ntext\n",
			want: nil,
		},
		{
			name: "four-space indent is a code block, not a fence",
			src:  "    ```yaml\n    foo: bar\n    ```\n",
			want: nil,
		},
		{
			name: "multiple fences keep independent line numbers",
			src:  "```yaml\na: 1\n```\n\nprose\n\n```json\n{}\n```\n",
			want: []codeFence{
				{Line: 1, Lang: "yaml", Body: "a: 1\n"},
				{Line: 7, Lang: "json", Body: "{}\n"},
			},
		},
		{
			name:    "unclosed fence at end of file is an error",
			src:     "prose\n\n```yaml\nfoo: bar\n",
			wantErr: "unclosed code fence",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := scanMarkdownFences("test.mdx", tc.src)
			if tc.wantErr != "" {
				if err == nil {
					t.Fatalf("expected error containing %q, got nil", tc.wantErr)
				}
				if !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("error %q does not contain %q", err.Error(), tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("got %d fences, want %d: %+v", len(got), len(tc.want), got)
			}
			for i, w := range tc.want {
				g := got[i]
				if g.Line != w.Line || g.Lang != w.Lang || g.Meta != w.Meta || g.Body != w.Body {
					t.Errorf("fence %d:\n  got  {Line:%d Lang:%q Meta:%q Body:%q}\n  want {Line:%d Lang:%q Meta:%q Body:%q}",
						i, g.Line, g.Lang, g.Meta, g.Body, w.Line, w.Lang, w.Meta, w.Body)
				}
			}
		})
	}
}
