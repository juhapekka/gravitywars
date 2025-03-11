const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const DEBUG = true;
const app = express();
//const httpServer = http.createServer(app);
const fs = require("fs");
const https = require("https");

const options = {
  key: fs.readFileSync("./certs/localhost-key.pem"),
  cert: fs.readFileSync("./certs/localhost.pem")
};

const httpServer = https.createServer(options, app);

const wsServer = new WebSocket.Server({ server: httpServer }); // Attach WebSocket to HTTP server

const clientColors = {}; // Stores color codes for clients

// Log HTTP requests
app.use((req, res, next) => {
  const clientId = crypto.randomBytes(3).toString("hex");
  const colorCode = `\x1b[3${Math.floor(Math.random() * 7) + 1}m`;
  clientColors[clientId] = colorCode;
  if (DEBUG) console.log(`${colorCode}[${clientId}] HTTP request: ${req.method} ${req.url} from ${req.ip}\x1b[0m`);
  next();
});

app.use(express.static(__dirname));

// Store player data
let players = {};

// Broadcast player state 20 times per second
setInterval(() => {
  const data = JSON.stringify(players);
  wsServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}, 50);

// Handle WebSocket connections
wsServer.on("connection", ws => {
  const clientId = crypto.randomBytes(3).toString("hex");
  const colorCode = `\x1b[3${Math.floor(Math.random() * 7) + 1}m`;
  clientColors[clientId] = colorCode;

  if (DEBUG) console.log(`${colorCode}[${clientId}] New WebSocket connection opened.\x1b[0m`);

  const id = Math.random().toString(36).substr(2, 9);
  players[id] = { x: 0, z: 0, angle: 0 };

  ws.on("message", message => {
//    if (DEBUG) console.log(`${clientColors[clientId]}[${clientId}] Received message:\x1b[0m`, message);
    try {
      const { x, z, angle } = JSON.parse(message);
      if (players[id]) {
        players[id].x = x;
        players[id].z = z;
        players[id].angle = angle;
      }
    } catch (err) {
      console.log("Error processing message:", err);
    }
  });

  ws.on("close", () => {
    if (DEBUG) console.log(`${clientColors[clientId]}[${clientId}] WebSocket connection closed.\x1b[0m`);
    delete players[id];
  });
});

// Start HTTP and WebSocket server on port 8081
httpServer.listen(8081, (err) => {
    if (err) {
      console.error("Failed to start server on port 8081:", err);
      process.exit(1);
    }
    console.log("HTTP and WebSocket server running on port 8081");
  });

