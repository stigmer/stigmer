package stigmer

// Wire-shape tests for FileClient's size-routed upload, the File twin of
// skill_test.go: a fake transport captures the outgoing protos while an
// httptest server plays the upload URL. Pins: inline at or below the
// threshold, staged above it with the exact bytes and Content-Length and
// no Authorization header, the size read from an *os.File, a reader that
// is streamed rather than read whole, Upload itself routing large inline
// data, content that disagrees with Size refused, and a rejected PUT
// reported without the URL or its query.

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	filev1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/file/v1"
)

type fakeFileUploadTransport struct {
	uploads []*filev1.UploadFileInput
	mints   []*filev1.CreateFileUploadUrlInput
	mintURL string
}

func (f *fakeFileUploadTransport) Upload(_ context.Context, in *filev1.UploadFileInput) (*filev1.File, error) {
	f.uploads = append(f.uploads, in)
	return &filev1.File{}, nil
}

func (f *fakeFileUploadTransport) CreateUploadUrl(_ context.Context, in *filev1.CreateFileUploadUrlInput) (*filev1.FileUploadUrl, error) {
	f.mints = append(f.mints, in)
	return &filev1.FileUploadUrl{Url: f.mintURL, UploadRef: "fup_t", TtlSeconds: 900}, nil
}

type receivedPut struct {
	method        string
	requestURI    string
	contentLength int64
	authorization string
	body          []byte
}

// uploadServer plays the upload URL, answering status and body.
func uploadServer(t *testing.T, status int, body string, got *receivedPut) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method = r.Method
		got.requestURI = r.RequestURI
		got.contentLength = r.ContentLength
		got.authorization = r.Header.Get("Authorization")
		got.body, _ = io.ReadAll(r.Body)
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(server.Close)
	return server
}

func patterned(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i % 251)
	}
	return b
}

func TestUploadFile_AtThresholdStaysInline(t *testing.T) {
	fake := &fakeFileUploadTransport{}
	client := &FileClient{transport: fake, httpClient: http.DefaultClient}
	content := patterned(maxInlineArtifactBytes)

	_, err := client.UploadFile(context.Background(), UploadFileParams{
		Org: "acme", SessionID: "ses_1", Filename: "a.bin", MimeType: "image/png",
		Content: bytes.NewReader(content), Size: int64(len(content)),
	})
	if err != nil {
		t.Fatalf("UploadFile: %v", err)
	}

	if len(fake.mints) != 0 {
		t.Error("inline upload minted an upload URL")
	}
	sent := fake.uploads[0]
	if !bytes.Equal(sent.GetData(), content) {
		t.Error("inline upload did not carry the bytes")
	}
	if sent.GetOrg() != "acme" || sent.GetSessionId() != "ses_1" || sent.GetFilename() != "a.bin" || sent.GetMimeType() != "image/png" {
		t.Errorf("inline upload fields = %v", sent)
	}
}

func TestUploadFile_AboveThresholdStagesExactBytesWithoutAuth(t *testing.T) {
	var got receivedPut
	server := uploadServer(t, http.StatusOK, "", &got)
	fake := &fakeFileUploadTransport{mintURL: server.URL + "/v1/file-uploads/fup_t?sig=s3cret"}
	client := &FileClient{transport: fake, httpClient: server.Client()}
	content := patterned(maxInlineArtifactBytes + 1)

	_, err := client.UploadFile(context.Background(), UploadFileParams{
		Org: "acme", SessionID: "ses_1", Filename: "big.bin",
		Content: bytes.NewReader(content), Size: int64(len(content)),
	})
	if err != nil {
		t.Fatalf("UploadFile: %v", err)
	}

	if len(fake.mints) != 1 || fake.mints[0].GetSizeBytes() != int64(len(content)) ||
		fake.mints[0].GetOrg() != "acme" || fake.mints[0].GetSessionId() != "ses_1" {
		t.Fatalf("mints = %v", fake.mints)
	}
	if got.method != http.MethodPut || got.requestURI != "/v1/file-uploads/fup_t?sig=s3cret" {
		t.Errorf("PUT = %s %s", got.method, got.requestURI)
	}
	if got.contentLength != int64(len(content)) {
		t.Errorf("Content-Length = %d, want %d", got.contentLength, len(content))
	}
	if got.authorization != "" {
		t.Errorf("PUT carried Authorization %q", got.authorization)
	}
	if !bytes.Equal(got.body, content) {
		t.Error("staged bytes differ from the content")
	}
	sent := fake.uploads[0]
	if sent.GetUploadRef() != "fup_t" || len(sent.GetData()) != 0 {
		t.Errorf("upload source = %v, want the reference only", sent.GetSource())
	}
	if sent.GetFilename() != "big.bin" || sent.GetSessionId() != "ses_1" {
		t.Errorf("by-ref upload dropped fields: %v", sent)
	}
}

func TestUploadFile_SizeFromOSFile(t *testing.T) {
	var got receivedPut
	server := uploadServer(t, http.StatusOK, "", &got)
	fake := &fakeFileUploadTransport{mintURL: server.URL + "/u"}
	client := &FileClient{transport: fake, httpClient: server.Client()}
	content := patterned(maxInlineArtifactBytes + 4096)
	path := filepath.Join(t.TempDir(), "ledger.xlsx")
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	if _, err := client.UploadFile(context.Background(), UploadFileParams{Org: "acme", Filename: "ledger.xlsx", Content: file}); err != nil {
		t.Fatalf("UploadFile: %v", err)
	}

	if fake.mints[0].GetSizeBytes() != int64(len(content)) || got.contentLength != int64(len(content)) {
		t.Errorf("size = %d, Content-Length = %d, want %d", fake.mints[0].GetSizeBytes(), got.contentLength, len(content))
	}
	if !bytes.Equal(got.body, content) {
		t.Error("staged bytes differ from the file")
	}
}

// gatedReader hands out its first half, then blocks until released: an
// uploader that read the content whole before sending would never release
// it, so the test fails on the timeout instead of hanging.
type gatedReader struct {
	data     []byte
	pos      int
	released chan struct{}
}

func (g *gatedReader) Read(p []byte) (int, error) {
	if g.pos >= len(g.data) {
		return 0, io.EOF
	}
	if g.pos >= len(g.data)/2 {
		select {
		case <-g.released:
		case <-time.After(10 * time.Second):
			return 0, errors.New("content read past its first half before any byte reached the server")
		}
	}
	limit := len(g.data)
	if g.pos < len(g.data)/2 {
		limit = len(g.data) / 2
	}
	n := copy(p, g.data[g.pos:limit])
	g.pos += n
	return n, nil
}

func TestUploadFile_StreamsTheReader(t *testing.T) {
	content := patterned(maxInlineArtifactBytes + 1)
	reader := &gatedReader{data: content, released: make(chan struct{})}
	var body []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		first := make([]byte, 1)
		if _, err := io.ReadFull(r.Body, first); err == nil {
			close(reader.released)
		}
		rest, _ := io.ReadAll(r.Body)
		body = append(first, rest...)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)
	fake := &fakeFileUploadTransport{mintURL: server.URL + "/u"}
	client := &FileClient{transport: fake, httpClient: server.Client()}

	_, err := client.UploadFile(context.Background(), UploadFileParams{
		Org: "acme", Filename: "big.bin", Content: reader, Size: int64(len(content)),
	})
	if err != nil {
		t.Fatalf("UploadFile: %v", err)
	}
	if !bytes.Equal(body, content) {
		t.Error("streamed bytes differ from the content")
	}
}

func TestUpload_LargeInlineDataIsStaged(t *testing.T) {
	var got receivedPut
	server := uploadServer(t, http.StatusOK, "", &got)
	fake := &fakeFileUploadTransport{mintURL: server.URL + "/u"}
	client := &FileClient{transport: fake, httpClient: server.Client()}
	data := patterned(maxInlineArtifactBytes + 1)

	_, err := client.Upload(context.Background(), &filev1.UploadFileInput{
		Org: "acme", Filename: "big.csv", MimeType: "text/csv",
		Source: &filev1.UploadFileInput_Data{Data: data},
	})
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	if !bytes.Equal(got.body, data) {
		t.Error("staged bytes differ from the inline data")
	}
	sent := fake.uploads[0]
	if sent.GetUploadRef() != "fup_t" || sent.GetMimeType() != "text/csv" || sent.GetFilename() != "big.csv" {
		t.Errorf("by-ref upload = %v", sent)
	}
}

func TestUploadFile_ContentDisagreeingWithSizeIsRefused(t *testing.T) {
	var got receivedPut
	server := uploadServer(t, http.StatusOK, "", &got)
	cases := map[string]struct {
		content []byte
		size    int64
	}{
		"inline, longer":  {patterned(10), 5},
		"inline, shorter": {patterned(5), 10},
		"staged, longer":  {patterned(maxInlineArtifactBytes + 2), maxInlineArtifactBytes + 1},
		"staged, shorter": {patterned(maxInlineArtifactBytes + 1), maxInlineArtifactBytes + 2},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			fake := &fakeFileUploadTransport{mintURL: server.URL + "/u"}
			client := &FileClient{transport: fake, httpClient: server.Client()}
			_, err := client.UploadFile(context.Background(), UploadFileParams{
				Org: "acme", Filename: "x.bin", Content: bytes.NewReader(tc.content), Size: tc.size,
			})
			if err == nil {
				t.Fatal("UploadFile accepted content that disagrees with Size")
			}
			if len(fake.uploads) != 0 {
				t.Error("upload proceeded")
			}
		})
	}
}

func TestUploadFile_RejectedPutNamesNeitherURLNorQuery(t *testing.T) {
	const xmlBody = "<Error><Code>SignatureDoesNotMatch</Code><Message>The signature does not match.</Message>" +
		"<CanonicalRequest>PUT /b/k X-Amz-Credential=AKIDEXAMPLE&amp;X-Amz-Signature=s3cret</CanonicalRequest></Error>"
	var got receivedPut
	server := uploadServer(t, http.StatusForbidden, xmlBody, &got)
	fake := &fakeFileUploadTransport{mintURL: server.URL + "/b/k?X-Amz-Credential=AKIDEXAMPLE&X-Amz-Signature=s3cret"}
	client := &FileClient{transport: fake, httpClient: server.Client()}
	content := patterned(maxInlineArtifactBytes + 1)

	_, err := client.UploadFile(context.Background(), UploadFileParams{
		Org: "acme", Filename: "big.bin", Content: bytes.NewReader(content), Size: int64(len(content)),
	})

	want := "stigmer: file upload rejected with HTTP 403: SignatureDoesNotMatch: The signature does not match."
	if err == nil || err.Error() != want {
		t.Errorf("err = %v, want %q", err, want)
	}
	if len(fake.uploads) != 0 {
		t.Error("upload proceeded after a rejected PUT")
	}
}

func TestUploadFile_PlainRejectionEchoingTheURLIsRedacted(t *testing.T) {
	echo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		http.Error(w, "no slot at http://"+r.Host+r.RequestURI+"; query token=s3cret", http.StatusNotFound)
	}))
	t.Cleanup(echo.Close)
	mintURL := echo.URL + "/u/fup_t?token=s3cret"
	fake := &fakeFileUploadTransport{mintURL: mintURL}
	client := &FileClient{transport: fake, httpClient: echo.Client()}
	content := patterned(maxInlineArtifactBytes + 1)

	_, err := client.UploadFile(context.Background(), UploadFileParams{
		Org: "acme", Filename: "big.bin", Content: bytes.NewReader(content), Size: int64(len(content)),
	})

	if err == nil || !strings.HasPrefix(err.Error(), "stigmer: file upload rejected with HTTP 404: ") {
		t.Fatalf("err = %v", err)
	}
	if strings.Contains(err.Error(), "s3cret") || strings.Contains(err.Error(), echo.URL) {
		t.Errorf("error echoes the URL: %v", err)
	}
}

func TestUploadFile_UnreachableURLIsNotNamed(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	unreachable := server.URL + "/u?sig=s3cret"
	server.Close()
	fake := &fakeFileUploadTransport{mintURL: unreachable}
	client := &FileClient{transport: fake, httpClient: http.DefaultClient}
	content := patterned(maxInlineArtifactBytes + 1)

	_, err := client.UploadFile(context.Background(), UploadFileParams{
		Org: "acme", Filename: "big.bin", Content: bytes.NewReader(content), Size: int64(len(content)),
	})

	if err == nil {
		t.Fatal("UploadFile succeeded against a closed server")
	}
	if strings.Contains(err.Error(), "s3cret") || strings.Contains(err.Error(), "/u") {
		t.Errorf("error names the URL: %v", err)
	}
	if len(fake.uploads) != 0 {
		t.Error("upload proceeded after a failed PUT")
	}
}
