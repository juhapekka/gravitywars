const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const DEBUG = true;
const app = express();
const fs = require("fs");
const https = require("https");

const keyPath = "./certs/localhost-key.pem";
const certPath = "./certs/localhost.pem";
let httpServer;
const useHttps = fs.existsSync(keyPath) && fs.existsSync(certPath);

if (useHttps) {
  try {
    const options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    httpServer = https.createServer(options, app);
    console.log("🔒 HTTPS enabled");
  } catch (err) {
    console.error("❌ Error reading SSL certificates:", err);
    process.exit(1); // Exit if HTTPS was expected but failed
  }
} else {
  console.warn("⚠️ No certificates found, falling back to HTTP");
  httpServer = http.createServer(app);
}

const wsServer = new WebSocket.Server({ server: httpServer }); // Attach WebSocket to HTTP server

const clientColors = {}; // Stores color codes for clients

// Disable caching for client.js
app.use((req, res, next) => {
  if (req.url.endsWith("client.js")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});

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
  
    // 1) Generate the official ID used by 'players'
    const id = Math.random().toString(36).substr(2, 9);
    players[id] = { x: 0, z: 0, angle: 0 };
  
    // 2) Send the client its ID
    ws.send(JSON.stringify({ myId: id }));
  
    // 3) Then handle incoming messages
    ws.on("message", message => {
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
      if (DEBUG) console.log(`${colorCode}[${clientId}] WebSocket connection closed.\x1b[0m`);
      delete players[id];
    });
  });

httpServer.listen(8081, (err) => {
  if (err) {
    console.error("Failed to start server on port 8081:", err);
    process.exit(1);
  }
  console.log(`🌍 Server running on ${httpServer instanceof https.Server ? "HTTPS" : "HTTP"} port 8081`);
});
