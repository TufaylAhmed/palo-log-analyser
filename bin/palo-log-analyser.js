#!/usr/bin/env node
/**
 * CLI for palo-log-analyser — thin wrapper around Docker Compose.
 *
 *   npx palo-log-analyser start
 *   npx palo-log-analyser stop
 *   npx palo-log-analyser status
 *   npx palo-log-analyser open
 */

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENV_EXAMPLE = join(ROOT, ".env.example");
const ENV_FILE = join(ROOT, ".env");

const UI = "http://localhost:8080";
const API = "http://localhost:8081/healthz";

const HELP = `
palo-log-analyser — Palo Alto tech-support & GlobalProtect log analyser

Usage:
  palo-log-analyser <command>

Commands:
  start     Build and start the stack (Docker Compose)
  stop      Stop the stack
  restart   Stop then start
  status    Show compose service status
  logs      Tail compose logs (Ctrl+C to exit)
  open      Open the UI in your browser
  doctor    Check Docker / Compose availability
  help      Show this help

After start:
  UI  → ${UI}
  API → ${API}

Requires Docker Desktop (or Docker Engine + Compose v2).
Default stack is api + frontend only (in-memory store). Optional
Postgres/Redis/worker: docker compose --profile full up
`.trim();

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function ensureEnv() {
  if (!existsSync(ENV_FILE) && existsSync(ENV_EXAMPLE)) {
    copyFileSync(ENV_EXAMPLE, ENV_FILE);
    console.log("Created .env from .env.example");
  }
}

function findCompose() {
  const docker = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  });
  if (docker.status === 0) return { cmd: "docker", argsPrefix: ["compose"] };

  const legacy = spawnSync("docker-compose", ["version"], { encoding: "utf8" });
  if (legacy.status === 0) return { cmd: "docker-compose", argsPrefix: [] };

  return null;
}

function runCompose(extraArgs, { inherit = true } = {}) {
  const compose = findCompose();
  if (!compose) {
    die(
      "Docker Compose not found. Install Docker Desktop, then retry.\n" +
        "https://docs.docker.com/get-docker/"
    );
  }
  const args = [...compose.argsPrefix, ...extraArgs];
  const opts = {
    cwd: ROOT,
    stdio: inherit ? "inherit" : "pipe",
    shell: process.platform === "win32",
  };
  const r = spawnSync(compose.cmd, args, opts);
  if (r.error) die(`Failed to run ${compose.cmd}: ${r.error.message}`);
  if (typeof r.status === "number" && r.status !== 0) process.exit(r.status);
  return r;
}

function doctor() {
  console.log("Checking environment…\n");
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
  });
  if (docker.status !== 0) {
    die("✗ Docker daemon not reachable. Start Docker Desktop and retry.");
  }
  console.log(`✓ Docker ${docker.stdout.trim() || "(ok)"}`);

  const compose = findCompose();
  if (!compose) die("✗ Docker Compose not found.");
  console.log(`✓ Compose via \`${compose.cmd} ${compose.argsPrefix.join(" ")}\``.trim());
  console.log(`✓ Package root: ${ROOT}`);
  console.log("\nReady. Run: palo-log-analyser start");
}

function openUi() {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
      ? "start"
      : "xdg-open";
  spawn(opener, [UI], {
    stdio: "ignore",
    shell: process.platform === "win32",
    detached: true,
  }).unref();
  console.log(`Opening ${UI}`);
}

const cmd = (process.argv[2] || "help").toLowerCase();

switch (cmd) {
  case "help":
  case "-h":
  case "--help":
    console.log(HELP);
    break;
  case "doctor":
    doctor();
    break;
  case "start":
  case "up":
    ensureEnv();
    console.log("Starting Palo Log Analyser…");
    runCompose(["up", "--build", "-d"]);
    console.log(`\n✓ Stack is up\n  UI  ${UI}\n  API ${API}\n`);
    break;
  case "stop":
  case "down":
    runCompose(["down"]);
    console.log("✓ Stack stopped");
    break;
  case "restart":
    ensureEnv();
    runCompose(["down"]);
    runCompose(["up", "--build", "-d"]);
    console.log(`\n✓ Restarted\n  UI  ${UI}\n`);
    break;
  case "status":
  case "ps":
    runCompose(["ps"]);
    break;
  case "logs":
    runCompose(["logs", "-f", "--tail", "200"]);
    break;
  case "open":
    openUi();
    break;
  default:
    die(`Unknown command: ${cmd}\n\n${HELP}`);
}
