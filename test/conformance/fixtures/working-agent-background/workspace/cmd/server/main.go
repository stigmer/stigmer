// Command server serves the service's HTTP API on 127.0.0.1:8765.
//
// GET /minutes?d=<duration> answers the whole minutes in d, as the service's
// configuration reads it, or 400 with the reason it cannot.
package main

import (
	"fmt"
	"log"
	"net/http"

	"example.com/orders-sync/duration"
)

const addr = "127.0.0.1:8765"

func main() {
	http.HandleFunc("/minutes", func(w http.ResponseWriter, r *http.Request) {
		minutes, err := duration.ParseMinutes(r.URL.Query().Get("d"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		fmt.Fprintln(w, minutes)
	})
	log.Printf("listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
