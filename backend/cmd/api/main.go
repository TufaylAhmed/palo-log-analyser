package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"

	"pan-ts-analyzer/internal/api"
	"pan-ts-analyzer/internal/store"
)

// Populated at release/npm build time from frontend/dist. Docker backend
// builds keep only the placeholder so the image stays API-only (nginx serves UI).
//
//go:embed all:web
var embeddedWeb embed.FS

func main() {
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}
	uploadDir := os.Getenv("UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "./data/uploads"
	}
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		log.Fatalf("create upload dir: %v", err)
	}

	// Phase 1: in-memory registry. Phase 2 swaps this for Postgres.
	st := store.NewMemory()
	srv := api.NewServer(st, uploadDir)

	var handler http.Handler = srv
	if sub, err := fs.Sub(embeddedWeb, "web"); err == nil {
		handler = srv.WithUI(sub)
	}

	log.Printf("palo-log-analyser listening on http://127.0.0.1:%s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal(err)
	}
}
