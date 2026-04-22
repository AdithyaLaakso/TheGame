#!/usr/bin/env node
// Boots the WebSocket relay and the Vite dev server together.
// Piping output through this wrapper so Ctrl-C kills both children cleanly.
import { spawn } from "node:child_process";

const children = [];

function run(label, cmd, args, color) {
  const child = spawn(cmd, args, { stdio: ["inherit", "pipe", "pipe"], shell: false });
  children.push(child);

  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  const pipe = (stream, out) => {
    stream.setEncoding("utf8");
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) out.write(prefix + line + "\n");
    });
    stream.on("end", () => { if (buf) out.write(prefix + buf + "\n"); });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    console.log(`${prefix}exited (code=${code}, signal=${signal})`);
    shutdown(code ?? 0);
  });
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed) c.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT",  () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("relay", process.execPath, ["server.mjs"], "36");
run("vite",  "npx",            ["vite", "dev"], "35");
