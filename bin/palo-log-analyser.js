#!/usr/bin/env node
/**
 * CLI for palo-log-analyser.
 *
 * Default: native single binary (API + UI) — no Docker.
 * Optional: palo-log-analyser start --docker
 */

import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENV_EXAMPLE = join(ROOT, ".env.example");
const ENV_FILE = join(ROOT, ".env");
const DATA_DIR = join(homedir(), ".palo-log-analyser");
const UPLOAD_DIR = join(DATA_DIR, "uploads");
const PID_FILE = join(DATA_DIR, "server.pid");
const LOG_FILE = join(DATA_DIR, "server.log");

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function platformKey() {
  const goos =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
      ? "windows"
      : process.platform === "linux"
      ? "linux"
      : null;
  const goarch =
    process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null;
  if (!goos || !goarch) die(`Unsupported platform: ${process.platform}/${process.arch}`);
  const ext = goos === "windows" ? ".exe" : "";
  return { goos, goarch, name: `palo-log-analyser-${goos}-${goarch}${ext}` };
}

function nativeBinaryPath() {
  return join(ROOT, "bin", "native", platformKey().name);
}

function ensureDirs() {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

function ensureEnv() {
  if (!existsSync(ENV_FILE) && existsSync(ENV_EXAMPLE)) {
    copyFileSync(ENV_EXAMPLE, ENV_FILE);
    console.log("Created .env from .env.example");
  }
}

function readPid() {
  try {
    const pid = Number(readFileSync(PID_FILE, "utf8").trim());
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearPid() {
  try {
    unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

function findCompose() {
  const docker = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  if (docker.status === 0) return { cmd: "docker", argsPrefix: ["compose"] };
  const legacy = spawnSync("docker-compose", ["version"], { encoding: "utf8" });
  if (legacy.status === 0) return { cmd: "docker-compose", argsPrefix: [] };
  return null;
}

function runCompose(extraArgs) {
  const compose = findCompose();
  if (!compose) {
    die(
      "Docker Compose not found. Install Docker Desktop, or run without --docker.\n" +
        "https://docs.docker.com/get-docker/"
    );
  }
  const r = spawnSync(compose.cmd, [...compose.argsPrefix, ...extraArgs], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.error) die(`Failed to run ${compose.cmd}: ${r.error.message}`);
  if (typeof r.status === "number" && r.status !== 0) process.exit(r.status);
}

function buildNativeIfNeeded() {
  const bin = nativeBinaryPath();
  if (existsSync(bin)) return bin;

  console.log("Native binary not found — building with local Go + frontend…");
  const go = spawnSync("go", ["version"], { encoding: "utf8" });
  if (go.status !== 0) {
    die(
      "No prebuilt binary for this platform and Go is not installed.\n" +
        "Install Go (https://go.dev/dl/) and retry, or use: palo-log-analyser start --docker"
    );
  }
  const script = join(ROOT, "scripts", "build-native.sh");
  const build = spawnSync("bash", [script], { cwd: ROOT, stdio: "inherit" });
  if (build.status !== 0 || !existsSync(bin)) die("Native build failed.");
  return bin;
}

async function waitHealthy(url, ms = 30000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        if (text.includes('"status"') && text.includes("ok")) return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startNative(port) {
  const ui = `http://127.0.0.1:${port}`;
  const health = `${ui}/healthz`;
  ensureDirs();
  const existing = readPid();
  if (isAlive(existing)) {
    console.log(`Already running (pid ${existing})\n  UI  ${ui}`);
    return;
  }
  clearPid();

  const bin = buildNativeIfNeeded();
  const fd = openSync(LOG_FILE, "a");
  const child = spawn(bin, [], {
    env: { ...process.env, API_PORT: String(port), UPLOAD_DIR },
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));

  const ok = await waitHealthy(health);
  if (!ok) {
    clearPid();
    die(`Server failed to become healthy. See log: ${LOG_FILE}`);
  }
  console.log(
    `\n✓ Running (no Docker)\n  UI/API  ${ui}\n  data    ${UPLOAD_DIR}\n  log     ${LOG_FILE}\n`
  );
}

function stopNative() {
  const pid = readPid();
  if (!isAlive(pid)) {
    clearPid();
    console.log("Not running");
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* ignore */
  }
  clearPid();
  console.log("✓ Stopped");
}

function doctor() {
  console.log("Checking environment…\n");
  const bin = nativeBinaryPath();
  console.log(existsSync(bin) ? `✓ Native binary ${bin}` : `· Native binary missing (${bin})`);
  const go = spawnSync("go", ["version"], { encoding: "utf8" });
  console.log(
    go.status === 0 ? `✓ ${go.stdout.trim()}` : "· Go not installed (only needed to build binary)"
  );
  const compose = findCompose();
  console.log(
    compose
      ? `✓ Docker Compose available (\`${compose.cmd}\`) — optional`
      : "· Docker Compose not available (optional)"
  );
  console.log(`✓ Data dir: ${DATA_DIR}`);
  console.log("\nReady. Run: palo-log-analyser start");
}

function openUi(url) {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(opener, [url], {
    stdio: "ignore",
    shell: process.platform === "win32",
    detached: true,
  }).unref();
  console.log(`Opening ${url}`);
}

function parseArgs(argv) {
  const args = argv.slice(3);
  const opts = {
    docker: false,
    port: process.env.PALO_PORT || process.env.API_PORT || "8080",
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--docker") opts.docker = true;
    else if (args[i] === "--port") opts.port = args[++i] || opts.port;
    else if (args[i].startsWith("--port=")) opts.port = args[i].slice(7);
  }
  return opts;
}

const HELP = `
palo-log-analyser — Palo Alto tech-support & GlobalProtect log analyser

Usage:
  palo-log-analyser <command> [options]

Commands:
  start [--docker] [--port N]   Start locally (default) or via Docker Compose
  stop [--docker]               Stop the local or Docker server
  restart                       Stop then start
  status                        Show whether the server is running
  open                          Open the UI in your browser
  doctor                        Check native binary / Go / Docker
  help                          Show this help

Default mode needs no Docker: one native binary serves UI + API.
  UI/API → http://127.0.0.1:8080

Docker (optional):
  palo-log-analyser start --docker
`.trim();

const cmd = (process.argv[2] || "help").toLowerCase();
const opts = parseArgs(process.argv);

async function main() {
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
      if (opts.docker) {
        console.log("Starting via Docker Compose…");
        runCompose(["up", "--build", "-d"]);
        console.log(
          `\n✓ Docker stack up\n  UI  http://localhost:8080\n  API http://localhost:18081/healthz\n`
        );
      } else {
        await startNative(opts.port);
      }
      break;
    case "stop":
    case "down":
      if (opts.docker) {
        runCompose(["down"]);
        console.log("✓ Docker stack stopped");
      } else {
        stopNative();
      }
      break;
    case "restart":
      if (opts.docker) {
        runCompose(["down"]);
        runCompose(["up", "--build", "-d"]);
        console.log("\n✓ Docker restarted\n");
      } else {
        stopNative();
        await startNative(opts.port);
      }
      break;
    case "status":
    case "ps":
      if (opts.docker) runCompose(["ps"]);
      else {
        const pid = readPid();
        const ui = `http://127.0.0.1:${opts.port}`;
        if (isAlive(pid)) console.log(`running pid=${pid}  ${ui}`);
        else console.log("stopped");
      }
      break;
    case "logs":
      if (opts.docker) runCompose(["logs", "-f", "--tail", "200"]);
      else {
        if (!existsSync(LOG_FILE)) die(`No log file at ${LOG_FILE}`);
        spawnSync("tail", ["-f", LOG_FILE], { stdio: "inherit" });
      }
      break;
    case "open":
      openUi(opts.docker ? "http://localhost:8080" : `http://127.0.0.1:${opts.port}`);
      break;
    default:
      die(`Unknown command: ${cmd}\n\n${HELP}`);
  }
}

main().catch((err) => die(err?.stack || String(err)));
