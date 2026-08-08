package harness

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"time"
)

// PostWhatsAppWebhook delivers one signed webhook payload to the booted
// service's front door — POST /webhook/whatsapp/{channelAppId} with the
// X-Hub-Signature-256 header Meta sends: "sha256=" + hex(HMAC-SHA256 over
// the exact raw body, keyed by the ChannelApp's app secret). The signature
// IS the authentication on this path (the route is permitAll), so a test
// that knows the plaintext secret it stored on the app walks the same door
// production traffic does.
//
// Returns the HTTP status code. The controller acks 200 BEFORE processing
// (a background executor owns it), so callers must poll durable state —
// the webhook event row, the outbound ledger — never assert right after
// the POST.
func PostWhatsAppWebhook(ctx context.Context, httpBaseURL, channelAppID,
	appSecret string, payload []byte) (int, error) {
	mac := hmac.New(sha256.New, []byte(appSecret))
	mac.Write(payload)
	signature := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	url := fmt.Sprintf("%s/webhook/whatsapp/%s", httpBaseURL, channelAppID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url,
		bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hub-Signature-256", signature)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode, nil
}

// WhatsAppStatusEvent describes one Meta statuses[] entry for
// WhatsAppStatusPayload — the receipt lane's front-door input (delivery
// receipts: sent/delivered/read/failed).
type WhatsAppStatusEvent struct {
	// PhoneNumberID routes the webhook (metadata.phone_number_id).
	PhoneNumberID string
	// WaID is the recipient (statuses[].recipient_id).
	WaID string
	// Wamid is the provider message id the receipt reports on
	// (statuses[].id) — for delivery receipts, the wamid Graph answered
	// at send time.
	Wamid string
	// CallbackToken is the echoed send-time correlation token
	// (biz_opaque_callback_data). Read it from the mock Graph's recorded
	// send body — never re-derive it: the token's wire format lives in
	// exactly one place (the cloud's ReceiptCorrelationToken).
	CallbackToken string
	// Status is Meta's verbatim value: "sent", "delivered", "read",
	// "failed".
	Status string
	// ErrorCode, when non-zero, adds an errors[] arm (errors[0].code) —
	// Meta ships one on failed statuses.
	ErrorCode int
	// ErrorDetail rides errors[0].error_data.details — the most specific
	// verdict slot, the one the receipt handler prefers.
	ErrorDetail string
}

// WhatsAppStatusPayload builds the minimal Meta webhook body the receipt
// lane routes: a messages-field change carrying one statuses[] entry.
// Note what delivery receipts DELIBERATELY lack: a type field — Meta sets
// statuses[].type only on payment events, and the absence IS the
// message_status discriminator the status-event store normalizes on.
func WhatsAppStatusPayload(e WhatsAppStatusEvent) []byte {
	errors := ""
	if e.ErrorCode != 0 {
		errors = fmt.Sprintf(
			`,"errors": [{"code": %d, "title": "Re-engagement message", "error_data": {"details": %q}}]`,
			e.ErrorCode, e.ErrorDetail)
	}
	return []byte(fmt.Sprintf(`{
	  "object": "whatsapp_business_account",
	  "entry": [{
	    "id": "WBA-INTEGRATION",
	    "changes": [{
	      "field": "messages",
	      "value": {
	        "messaging_product": "whatsapp",
	        "metadata": {"display_phone_number": "+1 555 025 3483", "phone_number_id": %q},
	        "statuses": [{
	          "id": %q,
	          "status": %q,
	          "timestamp": "1754476900",
	          "recipient_id": %q,
	          "biz_opaque_callback_data": %q%s
	        }]
	      }
	    }]
	  }]
	}`, e.PhoneNumberID, e.Wamid, e.Status, e.WaID, e.CallbackToken, errors))
}

// WhatsAppInboundTextPayload builds the minimal Meta webhook body the
// inbound pipeline routes: object + messages-field change +
// metadata.phone_number_id (the routing key) + one text message. The
// sender identity deliberately appears in BOTH messages[].from and
// contacts[].wa_id — messages[].from is the primary identity; contacts is
// the display-name carrier (the array-position trap is upstream's to
// avoid, not this builder's to reproduce).
func WhatsAppInboundTextPayload(phoneNumberID, waID, wamid, displayName,
	text string) []byte {
	return []byte(fmt.Sprintf(`{
	  "object": "whatsapp_business_account",
	  "entry": [{
	    "id": "WBA-INTEGRATION",
	    "changes": [{
	      "field": "messages",
	      "value": {
	        "messaging_product": "whatsapp",
	        "metadata": {"display_phone_number": "+1 555 025 3483", "phone_number_id": %q},
	        "contacts": [{"profile": {"name": %q}, "wa_id": %q}],
	        "messages": [{"from": %q, "id": %q, "timestamp": "1754476800", "type": "text", "text": {"body": %q}}]
	      }
	    }]
	  }]
	}`, phoneNumberID, displayName, waID, waID, wamid, text))
}
