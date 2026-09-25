#!/usr/bin/env bash
# Build frontend, embed into the Go API, and cross-compile native binaries
# for npm / GitHub Releases. No Docker required to run the result.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ building frontend…"
(cd frontend && npm install --no-fund --no-audit && npm run build)

echo "→ embedding UI into backend/cmd/api/web…"
rm -rf backend/cmd/api/web
mkdir -p backend/cmd/api/web
cp -R frontend/dist/. backend/cmd/api/web/

mkdir -p bin/native
build_one() {
  local goos="$1" goarch="$2"
  local out="bin/native/palo-log-analyser-${goos}-${goarch}"
  if [[ "$goos" == "windows" ]]; then out="${out}.exe"; fi
  echo "→ $out"
  (cd backend && CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -trimpath -ldflags="-s -w" -o "../$out" ./cmd/api)
}

build_one darwin arm64
build_one darwin amd64
build_one linux amd64
build_one linux arm64
build_one windows amd64

# Restore a tiny placeholder so Docker/backend-only builds still compile.
# Native binaries already contain the real UI from this run.
cat > backend/cmd/api/web/index.html <<'EOF'
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>PAN TechSupport Analyzer</title></head>
  <body>
    <p>UI not bundled in this build. Rebuild with <code>npm run build:native</code>.</p>
  </body>
</html>
EOF
# remove hashed assets left from the embed copy so Docker context stays small
find backend/cmd/api/web -mindepth 1 ! -name index.html -exec rm -rf {} + 2>/dev/null || true

echo "✓ native binaries in bin/native/"
ls -lh bin/native/
