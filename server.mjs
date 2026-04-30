// Dumb relay server for Castle Hold. One global room, first two connections become
// players A and B. Any message from one player is forwarded to the other.
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8090);
const wss = new WebSocketServer({ port: PORT });

/** @type {{A: import('ws').WebSocket|null, B: import('ws').WebSocket|null}} */
const slots = { A: null, B: null };

function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch {}
}

function broadcastPresence() {
  const both = slots.A && slots.B;
  for (const pid of /** @type {const} */ (["A", "B"])) {
    const ws = slots[pid];
    if (ws && ws.readyState === ws.OPEN) {
      send(ws, { type: "presence", you: pid, opponentConnected: !!slots[pid === "A" ? "B" : "A"], ready: both });
    }
  }
}

wss.on("connection", (ws) => {
  let assigned = null;
  if (!slots.A)      { slots.A = ws; assigned = "A"; }
  else if (!slots.B) { slots.B = ws; assigned = "B"; }
  else {
    send(ws, { type: "full" });
    ws.close();
    return;
  }

  console.log(`[relay] player ${assigned} connected`);
  send(ws, { type: "assign", you: assigned });
  broadcastPresence();

  // If the newcomer is B, ask A to send its current state so B can sync.
  if (assigned === "B" && slots.A?.readyState === slots.A?.OPEN) {
    send(slots.A, { type: "request_state" });
  }

  ws.on("message", (raw) => {
    const other = slots[assigned === "A" ? "B" : "A"];
    if (!other || other.readyState !== other.OPEN) return;
    // Forward raw bytes — server is dumb.
    other.send(raw.toString());
  });

  ws.on("close", () => {
    console.log(`[relay] player ${assigned} disconnected`);
    slots[assigned] = null;
    broadcastPresence();
  });
});

console.log(`[relay] listening on ws://localhost:${PORT}`);
