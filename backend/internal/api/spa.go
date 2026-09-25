package api

import (
	"io"
	"io/fs"
	"net/http"
	"strconv"
	"strings"
)

// WithUI wraps the API handler so non-API routes serve a single-page app
// from fsys (typically an embed of frontend/dist). API paths and /healthz
// stay on the API mux.
func (s *Server) WithUI(fsys fs.FS) http.Handler {
	if fsys == nil {
		return s
	}
	if _, err := fsys.Open("index.html"); err != nil {
		return s
	}
	fileServer := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/healthz" || strings.HasPrefix(path, "/api/") {
			s.ServeHTTP(w, r)
			return
		}
		// Prefer a real static file; fall back to index.html for client routes.
		name := strings.TrimPrefix(path, "/")
		if name == "" {
			name = "index.html"
		}
		if f, err := fsys.Open(name); err == nil {
			_ = f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		index, err := fsys.Open("index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer index.Close()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if stat, err := index.Stat(); err == nil {
			w.Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
		}
		_, _ = io.Copy(w, index)
	})
}
