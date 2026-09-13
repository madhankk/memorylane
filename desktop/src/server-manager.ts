import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export type ServerState = "stopped" | "starting" | "running" | "stopping" | "error";

// Where the bundled node runtime + server files live - packaged builds get
// this from electron-forge's extraResource (process.resourcesPath, same API
// regardless of packaging tool); dev mode reads the folder
// `npm run prepare-runtime` produces alongside this package, so `npm run dev`
// exercises the exact same layout a real build ships.
function resolveRuntimeDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "runtime") : path.join(__dirname, "..", "runtime");
}

function nodeBinaryName(): string {
  return process.platform === "win32" ? "node-runtime.exe" : "node-runtime";
}

export class ServerManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private _state: ServerState = "stopped";
  private _port: number;
  private logBuffer: string[] = [];

  constructor(defaultPort: number) {
    super();
    this._port = defaultPort;
  }

  get state(): ServerState {
    return this._state;
  }

  get port(): number {
    return this._port;
  }

  get logs(): string[] {
    return this.logBuffer;
  }

  private setState(state: ServerState): void {
    this._state = state;
    this.emit("state", state);
  }

  private appendLog(line: string): void {
    this.logBuffer.push(line);
    if (this.logBuffer.length > 500) this.logBuffer.shift();
    this.emit("log", line);
  }

  start(port: number): void {
    if (this._state === "running" || this._state === "starting") return;
    this._port = port;
    this.setState("starting");

    const runtimeDir = resolveRuntimeDir();
    const nodeBin = path.join(runtimeDir, nodeBinaryName());
    const serverScript = path.join(runtimeDir, "dist", "server.js");

    if (!fs.existsSync(nodeBin) || !fs.existsSync(serverScript)) {
      this.appendLog(`Runtime not found at ${runtimeDir} - run "npm run prepare-runtime" first.`);
      this.setState("error");
      return;
    }

    this.child = spawn(nodeBin, [serverScript], {
      env: { ...process.env, MEMORYLANE_PORT: String(port), MEMORYLANE_NO_OPEN: "1" },
      windowsHide: true,
    });

    this.child.stdout?.on("data", (chunk: Buffer) => this.appendLog(chunk.toString()));
    this.child.stderr?.on("data", (chunk: Buffer) => this.appendLog(chunk.toString()));

    // "Server listening" is logged by server.ts once Fastify is actually
    // accepting connections - only then is it meaningfully "running" rather
    // than still applying migrations/starting up.
    const onListening = (chunk: Buffer) => {
      if (chunk.toString().includes("Server listening")) {
        this.setState("running");
        this.child?.stdout?.off("data", onListening);
      }
    };
    this.child.stdout?.on("data", onListening);

    this.child.on("exit", (code) => {
      this.appendLog(`Server process exited (code ${code ?? "unknown"})`);
      this.child = null;
      this.setState(code === 0 || code === null ? "stopped" : "error");
    });

    this.child.on("error", (err) => {
      this.appendLog(`Failed to start server: ${err.message}`);
      this.setState("error");
    });
  }

  stop(): void {
    if (!this.child || this._state === "stopped") return;
    this.setState("stopping");
    // Windows has no SIGTERM - `child.kill()` there maps to TerminateProcess,
    // which is abrupt but fine here: the server's own SQLite writes are
    // WAL-mode/synchronous=NORMAL and don't depend on a graceful shutdown hook.
    this.child.kill();
  }

  // Called when the tray app itself is quitting - never leave an orphaned
  // server process running after the tray icon disappears.
  stopSync(): void {
    this.child?.kill();
  }
}
