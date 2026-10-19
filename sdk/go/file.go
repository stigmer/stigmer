package stigmer

// Size-routed File uploads: the File kind's binding of the transfer lane
// skills already push over (skill.go). The transport caps a whole request
// at 10 MiB, so content at or below the skills' inline threshold travels in
// the upload request itself, and larger content is PUT to the short-lived
// URL createUploadUrl mints and then uploaded by its reference.
//
// Trade-offs: the content is an io.Reader with a known size, so a large
// file streams from its source and is never held in memory; only content
// small enough to travel inline is read whole, because the inline request
// carries the bytes. The PUT carries no Authorization header, since the URL
// is the credential, and for the same reason no error names the URL: a
// bucket's URL holds its signature in the query, the server's own lane its
// token in the path.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"go.stigmer.ai/sdk/internal/gen"
	filev1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/file/v1"
)

// fileUploadTransport is the slice of the generated client the upload
// routing needs, narrow so tests can fake exactly these two calls.
type fileUploadTransport interface {
	Upload(ctx context.Context, input *filev1.UploadFileInput) (*filev1.File, error)
	CreateUploadUrl(ctx context.Context, input *filev1.CreateFileUploadUrlInput) (*filev1.FileUploadUrl, error)
}

// FileClient wraps the generated file client with size-routed uploads.
//
// UploadFile takes the content as a reader and routes it by size: inline
// when it fits the transport's request cap, otherwise staged over HTTP via
// CreateUploadUrl and uploaded by reference. Upload routes the same way
// when a request built by hand carries inline data too large to travel.
//
// Every other method is the generated client's, promoted unchanged.
type FileClient struct {
	*gen.FileClient
	transport  fileUploadTransport
	httpClient *http.Client
}

func newFileClient(g *gen.FileClient) *FileClient {
	return &FileClient{
		FileClient: g,
		transport:  g,
		// No global timeout: a 500 MB file on a slow link legitimately
		// takes minutes. Cancellation rides the caller's ctx.
		httpClient: &http.Client{},
	}
}

// UploadFileParams names a File to upload and its content.
type UploadFileParams struct {
	// Org is the organization the File belongs to, by id or slug; with
	// SessionID, the conversation's organization.
	Org string
	// SessionID is the conversation to upload the File into. Empty uploads
	// a File of your own.
	SessionID string
	// Filename is the file's name: at most 255 characters, with no /, \ or
	// control characters.
	Filename string
	// MimeType is the media type ("image/png"). Empty takes it from the
	// filename's extension.
	MimeType string
	// Content is read once, exactly Size bytes of it. It is not closed.
	Content io.Reader
	// Size is the content's length in bytes. Zero, with a Content that can
	// Stat itself (an *os.File), takes the length from Stat, less the
	// offset already read when Content is also an io.Seeker.
	Size int64
}

// statter is what an *os.File offers to learn its own length.
type statter interface {
	Stat() (fs.FileInfo, error)
}

// UploadFile uploads a File, routing its content by size (see the type
// comment), and returns it.
func (f *FileClient) UploadFile(ctx context.Context, params UploadFileParams) (*filev1.File, error) {
	if params.Content == nil {
		return nil, errors.New("stigmer: UploadFileParams.Content is required")
	}
	size, err := contentSize(params)
	if err != nil {
		return nil, err
	}
	input := &filev1.UploadFileInput{
		Org:       params.Org,
		SessionId: params.SessionID,
		Filename:  params.Filename,
		MimeType:  params.MimeType,
	}
	if size > maxInlineArtifactBytes {
		return f.uploadStaged(ctx, input, params.Content, size)
	}
	data, err := io.ReadAll(io.LimitReader(params.Content, size+1))
	if err != nil {
		return nil, fmt.Errorf("stigmer: reading file content: %w", err)
	}
	if int64(len(data)) != size {
		return nil, fmt.Errorf("stigmer: file content does not match Size (%d bytes)", size)
	}
	input.Source = &filev1.UploadFileInput_Data{Data: data}
	return f.transport.Upload(ctx, input)
}

// Upload uploads a File from a built request. Inline data above the
// threshold is staged and uploaded by reference; any other request is
// sent as it is.
func (f *FileClient) Upload(ctx context.Context, input *filev1.UploadFileInput) (*filev1.File, error) {
	data := input.GetData()
	if len(data) <= maxInlineArtifactBytes {
		return f.transport.Upload(ctx, input)
	}
	target := &filev1.UploadFileInput{
		Org:       input.GetOrg(),
		SessionId: input.GetSessionId(),
		Filename:  input.GetFilename(),
		MimeType:  input.GetMimeType(),
	}
	return f.uploadStaged(ctx, target, bytes.NewReader(data), int64(len(data)))
}

// contentSize is the length UploadFile routes and sends by.
func contentSize(params UploadFileParams) (int64, error) {
	if params.Size < 0 {
		return 0, fmt.Errorf("stigmer: UploadFileParams.Size is %d; it must not be negative", params.Size)
	}
	if params.Size > 0 {
		return params.Size, nil
	}
	st, ok := params.Content.(statter)
	if !ok {
		return 0, nil
	}
	info, err := st.Stat()
	if err != nil {
		return 0, fmt.Errorf("stigmer: reading file size: %w", err)
	}
	size := info.Size()
	if seeker, ok := params.Content.(io.Seeker); ok {
		offset, err := seeker.Seek(0, io.SeekCurrent)
		if err != nil {
			return 0, fmt.Errorf("stigmer: reading file offset: %w", err)
		}
		size -= offset
	}
	if size < 0 {
		return 0, nil
	}
	return size, nil
}

// uploadStaged mints an upload URL, PUTs the content, then uploads by the
// returned reference. target carries every field but the source.
func (f *FileClient) uploadStaged(ctx context.Context, target *filev1.UploadFileInput, content io.Reader, size int64) (*filev1.File, error) {
	minted, err := f.transport.CreateUploadUrl(ctx, &filev1.CreateFileUploadUrlInput{
		Org:       target.GetOrg(),
		SessionId: target.GetSessionId(),
		SizeBytes: size,
	})
	if err != nil {
		return nil, err
	}
	if err := f.putContent(ctx, minted.GetUrl(), content, size); err != nil {
		return nil, err
	}
	// Content longer than Size would leave a File that silently lost its
	// tail; one more byte answers whether there was more.
	var probe [1]byte
	if n, _ := io.ReadFull(content, probe[:]); n > 0 {
		return nil, fmt.Errorf("stigmer: file content is longer than Size (%d bytes)", size)
	}
	target.Source = &filev1.UploadFileInput_UploadRef{UploadRef: minted.GetUploadRef()}
	return f.transport.Upload(ctx, target)
}

// putContent streams exactly size bytes to the upload URL, with no auth
// header; on a bucket the Content-Length is signed into the URL.
func (f *FileClient) putContent(ctx context.Context, uploadURL string, content io.Reader, size int64) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, io.LimitReader(content, size))
	if err != nil {
		// url.Parse errors quote the URL; report the failure without it.
		return errors.New("stigmer: file upload failed: the upload URL is malformed")
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.ContentLength = size

	resp, err := f.httpClient.Do(req)
	if err != nil {
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			// url.Error's message carries the whole URL; keep only its cause.
			err = urlErr.Err
		}
		return fmt.Errorf("stigmer: file upload failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		detail := redactURL(rejectionDetail(string(body)), uploadURL)
		if detail == "" {
			return fmt.Errorf("stigmer: file upload rejected with HTTP %d", resp.StatusCode)
		}
		return fmt.Errorf("stigmer: file upload rejected with HTTP %d: %s", resp.StatusCode, detail)
	}
	return nil
}

const maxRejectionDetail = 512

var (
	xmlCodeElement    = regexp.MustCompile(`<Code>([^<]*)</Code>`)
	xmlMessageElement = regexp.MustCompile(`<Message>([^<]*)</Message>`)
)

// rejectionDetail is the part of a rejection body worth showing. A bucket
// answers XML whose other elements can restate the signed request, so only
// its Code and Message are kept; the server's own lane answers plain text.
func rejectionDetail(body string) string {
	text := strings.TrimSpace(body)
	if !strings.HasPrefix(text, "<") {
		return truncate(text, maxRejectionDetail)
	}
	var parts []string
	for _, element := range []*regexp.Regexp{xmlCodeElement, xmlMessageElement} {
		if m := element.FindStringSubmatch(text); m != nil && strings.TrimSpace(m[1]) != "" {
			parts = append(parts, strings.TrimSpace(m[1]))
		}
	}
	return truncate(strings.Join(parts, ": "), maxRejectionDetail)
}

// redactURL removes the URL, and its query on its own, from text that
// echoes either.
func redactURL(text, uploadURL string) string {
	secrets := []string{uploadURL}
	if i := strings.IndexByte(uploadURL, '?'); i >= 0 && i+1 < len(uploadURL) {
		secrets = append(secrets, uploadURL[i+1:])
	}
	for _, secret := range secrets {
		text = strings.ReplaceAll(text, secret, "[redacted]")
	}
	return text
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
