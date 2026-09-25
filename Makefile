.PHONY: dev test build up down native

test:
	cd backend && go vet ./... && go test ./...

build:
	cd backend && go build ./...
	cd frontend && npm install && npm run build

native:
	bash scripts/build-native.sh

up:
	docker compose up --build -d

down:
	docker compose down

dev-api:
	cd backend && go run ./cmd/api

dev-frontend:
	cd frontend && npm run dev
