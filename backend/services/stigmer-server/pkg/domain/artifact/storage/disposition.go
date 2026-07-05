package storage

import (
	"fmt"
	"strings"
)

// LocalDownloadQueryParam is the query-string key the local storage backend
// uses to carry a desired download filename, read by the artifact file server
// to set Content-Disposition. The R2 backend signs the disposition directly
// into the presigned URL and does not use this.
const LocalDownloadQueryParam = "download"

// ContentDispositionAttachment builds a Content-Disposition header value that
// instructs a browser to save the response as a download named filename.
//
// It emits both a plain `filename="..."` (an ASCII-sanitized fallback for
// older clients) and, when the name contains non-ASCII bytes, an RFC 5987
// `filename*=UTF-8”...` parameter that modern browsers prefer. The fallback
// is always quoted with embedded quotes and backslashes escaped, so a crafted
// name can never break out of the header value.
func ContentDispositionAttachment(filename string) string {
	ascii := sanitizeASCIIFilename(filename)
	disposition := fmt.Sprintf("attachment; filename=%q", ascii)
	if ascii != filename {
		disposition += "; filename*=UTF-8''" + rfc5987Encode(filename)
	}
	return disposition
}

// sanitizeASCIIFilename replaces bytes outside the printable ASCII range (and
// control characters) with '_', yielding a value safe for the quoted
// `filename="..."` form. Quotes and backslashes are preserved here and escaped
// by the caller's %q formatting.
func sanitizeASCIIFilename(filename string) string {
	var b strings.Builder
	b.Grow(len(filename))
	for _, r := range filename {
		if r < 0x20 || r > 0x7e {
			b.WriteByte('_')
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// rfc5987Encode percent-encodes filename per RFC 5987's ext-value grammar,
// leaving the small set of attr-char bytes unescaped.
func rfc5987Encode(filename string) string {
	const upperhex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(filename); i++ {
		c := filename[i]
		if isRFC5987AttrChar(c) {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(upperhex[c>>4])
		b.WriteByte(upperhex[c&0x0f])
	}
	return b.String()
}

// isRFC5987AttrChar reports whether c is an attr-char (RFC 5987 §3.2.1) that
// may appear unescaped in an ext-value.
func isRFC5987AttrChar(c byte) bool {
	switch {
	case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		return true
	}
	switch c {
	case '!', '#', '$', '&', '+', '-', '.', '^', '_', '`', '|', '~':
		return true
	}
	return false
}
