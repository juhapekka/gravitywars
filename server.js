// --- START OF FILE server.js ---

const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const https = require("https"); // Added for potential HTTPS
const crypto = require("crypto");
const fs = require("fs"); // Added for checking certificate files

const DEBUG = true; // Set to false to reduce console logging
const app = express();

// --- HTTPS Configuration ---
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
    console.log("🔒 HTTPS enabled using local certificates.");
  } catch (err) {
    console.error("❌ Error reading SSL certificates:", err);
    console.warn("⚠️ Falling back to HTTP due to certificate error.");
    httpServer = http.createServer(app); // Fallback to HTTP
  }
} else {
  console.warn("⚠️ No certificates found at ./certs/, using HTTP.");
  httpServer = http.createServer(app);
}
// --------------------------

// Attach WebSocket Server to the chosen HTTP/HTTPS server
const wsServer = new WebSocket.Server({ server: httpServer });

// Stores client IDs for logging purposes (optional)
const clientColors = {};

// Disable caching for specific files during development (optional)
app.use((req, res, next) => {
  if (req.url.endsWith("client.js") || req.url.endsWith("server.js")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});

// Log HTTP requests (optional)
app.use((req, res, next) => {
  if (DEBUG) {
    const logClientId = req.headers['x-forwarded-for'] || req.socket.remoteAddress; // Basic identification
    const colorCode = `\x1b[3${Math.floor(Math.random() * 6) + 1}m`; // Assign random color for log visibility
    console.log(`${colorCode}[HTTP ${logClientId}] ${req.method} ${req.url}\x1b[0m`);
  }
  next();
});

// Serve static files from the root directory (__dirname)
app.use(express.static(__dirname));

// =======================================
// GAME STATE & LOGIC
// =======================================

// Store player data
// Coordinates (x, z) are assumed to be relative to the ORIGINAL background texture dimensions
// (e.g., if texture is 1024x768, x is 0-1024, z is 0-768)
let players = {}; // { playerId: { x: number, z: number, angle: number }, ... }

// Example: Assume a default texture size if needed for initial spawn logic
const DEFAULT_TEXTURE_WIDTH = 1024;
const DEFAULT_TEXTURE_HEIGHT = 1024; // Adjust if you know your texture dimensions

// Broadcast the current state of ALL players to ALL connected clients
const BROADCAST_INTERVAL = 50; // milliseconds (50ms = 20 Hz)
setInterval(() => {
  if (Object.keys(players).length > 0 || wsServer.clients.size > 0) { // Only broadcast if needed
      const data = JSON.stringify(players);
      // Optional: Log broadcast data only if debugging is needed
      // if (DEBUG && Object.keys(players).length > 0) {
      //    console.log(`Broadcasting (${wsServer.clients.size} clients): ${data.length > 100 ? data.substring(0, 100) + '...' : data}`);
      // }
      wsServer.clients.forEach(client => {
        // Check if the client's connection is open before sending
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
  }
}, BROADCAST_INTERVAL);

// Handle new WebSocket connections
wsServer.on("connection", (ws, req) => {
    // Generate a unique ID for logging this specific connection instance
    const connectionId = crypto.randomBytes(3).toString("hex");
    const remoteAddress = req.socket.remoteAddress;
    const colorCode = `\x1b[3${Math.floor(Math.random() * 6) + 1}m`; // Assign color for log visibility
    clientColors[connectionId] = colorCode; // Store color if needed elsewhere

    if (DEBUG) console.log(`${colorCode}[WS ${connectionId}] Connection opened from ${remoteAddress}\x1b[0m`);

    // 1. Generate the official Player ID used in the game state ('players' object)
    const playerId = Math.random().toString(36).substring(2, 11); // Longer ID

    // 2. Determine Initial Player State
    //    Spawn in the center of the assumed original texture dimensions
    const initialX = DEFAULT_TEXTURE_WIDTH / 2;
    const initialZ = DEFAULT_TEXTURE_HEIGHT / 2;
    players[playerId] = {
        x: initialX,
        z: initialZ,
        angle: 0 // Start facing default direction (e.g., positive Z)
    };
    if (DEBUG) console.log(`${colorCode}[WS ${connectionId}] Assigned Player ID: ${playerId}, Spawned at (${initialX}, ${initialZ})\x1b[0m`);

    // 3. Send the client its unique Player ID
    //    (Could also send initial state here if client needs it immediately)
    ws.send(JSON.stringify({ myId: playerId }));

    // 4. Handle incoming messages from this specific client
    ws.on("message", message => {
      try {
        // Attempt to parse the message as JSON
        const receivedData = JSON.parse(message);

        // Basic validation: Ensure required fields exist and have correct types
        if (
            players[playerId] && // Check if player still exists (wasn't disconnected)
            typeof receivedData.x === 'number' &&
            typeof receivedData.z === 'number' &&
            typeof receivedData.angle === 'number'
        ) {
          // Update the player's state in the main 'players' object
          // Coordinates are stored as received (relative to original texture)
          players[playerId].x = receivedData.x;
          players[playerId].z = receivedData.z;
          players[playerId].angle = receivedData.angle;

          // Optional: Log received updates for debugging
           // if (DEBUG) {
           //     console.log(`${colorCode}[WS ${connectionId}] Update from ${playerId}: x=${receivedData.x.toFixed(1)}, z=${receivedData.z.toFixed(1)}, angle=${receivedData.angle.toFixed(2)}\x1b[0m`);
           // }

        } else if (!players[playerId]) {
             console.warn(`${colorCode}[WS ${connectionId}] Received message for non-existent player ID: ${playerId}\x1b[0m`);
        } else {
             console.warn(`${colorCode}[WS ${connectionId}] Received invalid message format from ${playerId}: ${message.toString()}\x1b[0m`);
        }
      } catch (err) {
        // Handle JSON parsing errors or other processing errors
        console.error(`${colorCode}[WS ${connectionId}] Error processing message from ${playerId}:`, err, `Raw message: ${message.toString()}\x1b[0m`);
      }
    });

    // 5. Handle client disconnection
    ws.on("close", (code, reason) => {
      if (DEBUG) console.log(`${colorCode}[WS ${connectionId}] Connection closed for Player ID ${playerId}. Code: ${code}, Reason: ${reason || 'N/A'}\x1b[0m`);
      // Remove the player's data from the game state
      delete players[playerId];
      // Clean up logging color map (optional)
      delete clientColors[connectionId];
    });

    // 6. Handle potential errors on the WebSocket connection
    ws.on("error", (error) => {
        console.error(`${colorCode}[WS ${connectionId}] WebSocket error for Player ID ${playerId}:`, error, `\x1b[0m`);
        // Connection likely closes automatically after error, 'close' event will handle cleanup.
    });
});

// =======================================
// START SERVER
// =======================================
const PORT = 8081;
httpServer.listen(PORT, (err) => {
  if (err) {
    console.error(`❌ Failed to start server on port ${PORT}:`, err);
    process.exit(1); // Exit if server cannot start
  }
  // Log whether HTTP or HTTPS is being used
  const serverType = httpServer instanceof https.Server ? "HTTPS" : "HTTP";
  console.log(`✅ ${serverType} Server running and listening on port ${PORT}`);
  console.log(`🌍 Game accessible at ${serverType.toLowerCase()}://${useHttps ? 'localhost' : 'localhost'}:${PORT}`); // Adjust 'localhost' if needed
});

console.log("⚙️ Server setup complete. Waiting for connections...");

// --- END OF FILE server.js ---