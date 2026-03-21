import { createServer } from "http";
import next from "next";
import type { WebSocket } from "ws";

import { attachCliWebSocketHandlers, createCliWebSocketServer } from "./src/server/ws-ingest";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

const app = next({
  dev,
  dir: process.cwd(),
  hostname,
  port,
});

const handle = app.getRequestHandler();
const webSocketServer = createCliWebSocketServer();
attachCliWebSocketHandlers(webSocketServer);

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    void handle(req, res);
  });

  const upgradeHandler = app.getUpgradeHandler();

  httpServer.on("upgrade", (req, socket, head) => {
    if ((req.url ?? "").startsWith("/ws")) {
      webSocketServer.handleUpgrade(req, socket, head, (websocket: WebSocket) => {
        webSocketServer.emit("connection", websocket, req);
      });
      return;
    }

    void upgradeHandler(req, socket, head);
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> Server listening at http://${hostname}:${port} (${dev ? "dev" : "prod"})`);
  });
});
