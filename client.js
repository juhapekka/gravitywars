// --- START OF FILE client.js ---

import * as THREE from "./node_modules/three/build/three.module.js";

// ================================
// MOBILE / TOUCH PREVENTIONS
// ================================
// ... (same as before) ...
document.body.style.overflow = 'hidden';

// ================================
// CONSTANTS & CONFIG
// ================================
const BASE_CAMERA_HEIGHT = 20;
const MIN_VISIBLE_WORLD_WIDTH = 40;
// --- Double the ship size (adjust if needed) ---
const SHIP_BASE_WIDTH_TEXELS = 60; // <<< Doubled from 30
const SHIP_BASE_HEIGHT_TEXELS = 60; // <<< Doubled from 30
// ----------------------------------------------
const SHIP_COLLISION_RADIUS_TEX_PX = 10; // Collision radius in original texture pixels
const WALL_THRESHOLD = 10;

// ================================
// THREE BASICS
// ================================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, BASE_CAMERA_HEIGHT, 0);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById("gameCanvas") });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;

// ================================
// WEBSOCKET SETUP
// ================================
const protocol = window.location.protocol.includes("https") ? "wss" : "ws";
const socket = new WebSocket(`${protocol}://${window.location.hostname}:8081`);

// ================================
// GLOBAL STATES
// ================================
// localState now stores position relative to the ORIGINAL texture dimensions (e.g., 0-1024)
let localState = { x: 0, z: 0, angle: 0, velocityX: 0, velocityZ: 0 }; // <<< Interpretation change
let myId = null;
let serverPlayers = {}; // Stores data received from server (assumed relative to original texture)
const inputState = { up: false, left: false, right: false, downLeft: false, downRight: false };
const ships = {}; // Stores ship Meshes: { playerId: THREE.Mesh }
let shipTexture, cavernTexture;
let cavernPlane; // The background Mesh
let ORIGINAL_CAVERN_WIDTH, ORIGINAL_CAVERN_HEIGHT; // <<< Store original texture dimensions
let SCALED_CAVERN_WIDTH, SCALED_CAVERN_HEIGHT; // Size of the plane currently in world units
let shipGeometry; // Base ship geometry (size in texels)
let shipMaterial; // Ship material
let collisionCanvas = null, collisionContext = null, collisionImageData = null;
let textureNeedsUpdate = false;
let lastCalculatedCavernScale = 1.0; // Scale factor from original texels to world units

// ================================
// LOADINGMANAGER FOR TEXTURES
// ================================
const manager = new THREE.LoadingManager();
manager.onStart = (url, i, t) => console.log(`🟡 Loading: ${url} (${i}/${t})`);
manager.onLoad = () => { console.log("✅ Textures loaded!"); finalizeSetup(); };
manager.onError = (url) => console.error(`❌ Error loading ${url}`);
const textureLoader = new THREE.TextureLoader(manager);

// ================================
// INITIATE TEXTURE REQUESTS
// ================================
function requestTextures() {
  console.log("🟡 Requesting textures...");
  shipTexture = textureLoader.load("alus.png");
  cavernTexture = textureLoader.load("kenttä1.png", (texture) => {
    texture.image.crossOrigin = "Anonymous";
    // Store original dimensions <<< ADDED
    ORIGINAL_CAVERN_WIDTH = texture.image.width;
    ORIGINAL_CAVERN_HEIGHT = texture.image.height;
    console.log(`✅ Cavern image loaded (${ORIGINAL_CAVERN_WIDTH}x${ORIGINAL_CAVERN_HEIGHT})`);
  }, undefined, (err) => console.error("🚨 Error loading cavern texture:", err) );
}

// ================================
// FINALIZE AFTER TEXTURES LOADED
// ================================
function finalizeSetup() {
  if (!cavernTexture || !cavernTexture.image || !shipTexture || !ORIGINAL_CAVERN_WIDTH) { // Check original dimensions stored
      console.error("🚨 Finalize failed: Missing textures or original dimensions."); return;
  }
  shipTexture.encoding = THREE.sRGBEncoding;
  cavernTexture.encoding = THREE.sRGBEncoding;
  console.log(`Cavern original: ${ORIGINAL_CAVERN_WIDTH}x${ORIGINAL_CAVERN_HEIGHT}`);

  createShipBaseGeometryAndMaterial();
  createOrUpdateCavern(); // Calculates initial scale

  // Set initial local state position (e.g., center of original texture) <<< Optional
  localState.x = ORIGINAL_CAVERN_WIDTH / 2;
  localState.z = ORIGINAL_CAVERN_HEIGHT / 2;

  startGame();
}

// ================================
// CREATE SHIP BASE GEOMETRY & MATERIAL
// ================================
function createShipBaseGeometryAndMaterial() {
  // Geometry units correspond to ORIGINAL texture pixels
  shipGeometry = new THREE.PlaneGeometry(SHIP_BASE_WIDTH_TEXELS, SHIP_BASE_HEIGHT_TEXELS);
  shipTexture.minFilter = THREE.LinearFilter; shipTexture.magFilter = THREE.LinearFilter;
  shipMaterial = new THREE.MeshBasicMaterial({ map: shipTexture, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1 });
  console.log(`Ship base geometry created (${SHIP_BASE_WIDTH_TEXELS}x${SHIP_BASE_HEIGHT_TEXELS} texel units)`);
}

// ================================
// CREATE OR UPDATE CAVERN PLANE (Also updates ship scales)
// ================================
function createOrUpdateCavern() {
    if (!cavernTexture || !cavernTexture.image || !ORIGINAL_CAVERN_WIDTH) { console.error("Cannot create cavern, texture/dims not ready."); return; }
    const texWidth = ORIGINAL_CAVERN_WIDTH; // Use stored original dimensions
    const texHeight = ORIGINAL_CAVERN_HEIGHT;

    // Calculate required world dimensions to fill camera view
    const camHeight = camera.position.y; const vFOV = THREE.MathUtils.degToRad(camera.fov);
    const requiredWorldHeight = 2 * Math.tan(vFOV / 2) * camHeight;
    const requiredWorldWidth = requiredWorldHeight * camera.aspect;

    // Determine Scale Factors (Fill vs Min Width)
    const scaleToFill = Math.max(requiredWorldWidth / texWidth, requiredWorldHeight / texHeight);
    const scaleForMinWidth = MIN_VISIBLE_WORLD_WIDTH / texWidth;

    // Choose Final Scale: From Original Texels -> World Units
    const finalScale = Math.max(scaleToFill, scaleForMinWidth);
    lastCalculatedCavernScale = finalScale; // Store globally

    // Calculate the size of the plane in World Units
    const planeW = texWidth * finalScale;
    const planeH = texHeight * finalScale;
    SCALED_CAVERN_WIDTH = planeW; // World boundary width
    SCALED_CAVERN_HEIGHT = planeH; // World boundary height

    // console.log(`View: ${requiredWorldWidth.toFixed(1)}x${requiredWorldHeight.toFixed(1)}, Scale: ${finalScale.toFixed(4)}`);
    // console.log(`Cavern scaled to ${planeW.toFixed(1)}x${planeH.toFixed(1)} (World Units)`);

    if (!cavernPlane) { // Create cavern mesh
        console.log("👷 Creating initial cavern plane.");
        const cavernGeometry = new THREE.PlaneGeometry(planeW, planeH);
        cavernTexture.minFilter = THREE.LinearFilter; cavernTexture.magFilter = THREE.LinearFilter;
        const cavernMaterial = new THREE.MeshBasicMaterial({ map: cavernTexture, side: THREE.DoubleSide });
        cavernPlane = new THREE.Mesh(cavernGeometry, cavernMaterial);
        cavernPlane.rotation.x = -Math.PI / 2;
        scene.add(cavernPlane);
        // Collision Setup
        try {
            collisionCanvas = document.createElement('canvas'); collisionCanvas.width = texWidth; collisionCanvas.height = texHeight;
            collisionContext = collisionCanvas.getContext('2d', { willReadFrequently: true });
            collisionContext.drawImage(cavernTexture.image, 0, 0, texWidth, texHeight);
            collisionImageData = collisionContext.getImageData(0, 0, texWidth, texHeight);
            console.log("✅ Initialized collision canvas.");
        } catch (e) { console.error("🚨 Error setting collision canvas:", e); collisionCanvas = collisionContext = collisionImageData = null; }
    } else { // Update existing geometry
        if (cavernPlane.geometry) cavernPlane.geometry.dispose();
        cavernPlane.geometry = new THREE.PlaneGeometry(planeW, planeH);
    }
    cavernPlane.position.set(planeW / 2, 0, planeH / 2); // Reposition center

    // Update scale of existing ship meshes
    Object.values(ships).forEach(shipMesh => {
        // Scale the base geometry (defined in texels) by the texel->world scale factor
        shipMesh.scale.set(lastCalculatedCavernScale, lastCalculatedCavernScale, 1);
    });
}


// ================================
// WINDOW RESIZE HANDLER
// ================================
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    createOrUpdateCavern(); // Recalculate scales and update meshes
    console.log("🔄 Window resized processed.");
});

// ================================
// ADD SHIP HELPER
// ================================
function addShip(playerId) {
    if (!shipGeometry || !shipMaterial || ships[playerId]) return;
    console.log(`➕ Adding ship mesh ${playerId}`);
    const shipMesh = new THREE.Mesh(shipGeometry, shipMaterial);
    shipMesh.rotation.x = -Math.PI / 2;
    shipMesh.position.y = 0.1; // Slightly above ground
    // Set initial scale based on current cavern scale
    shipMesh.scale.set(lastCalculatedCavernScale, lastCalculatedCavernScale, 1);
    scene.add(shipMesh);
    ships[playerId] = shipMesh;
}


// ================================
// USER INPUTS (KEYBOARD)
// ================================
// ... (no changes needed) ...
window.addEventListener("keydown", event => { if (event.key === "ArrowUp") inputState.up = true; else if (event.key === "ArrowLeft") inputState.left = true; else if (event.key === "ArrowRight") inputState.right = true; });
window.addEventListener("keyup", event => { if (event.key === "ArrowUp") inputState.up = false; else if (event.key === "ArrowLeft") inputState.left = false; else if (event.key === "ArrowRight") inputState.right = false; });


// ================================
// UPDATE LOCAL MOVEMENT <<< MODIFIED: Physics use original texel coordinates
// ================================
function updateMovement() {
  // Constants for acceleration/speed can be relative to the original texel space
  const acceleration = 0.4; // Adjusted - trial and error needed
  const maxSpeed = 10.0;    // Adjusted - trial and error needed
  const friction = 0.98;
  const rotationSpeed = 0.05;

  // Ensure original dimensions are available
  if (!ORIGINAL_CAVERN_WIDTH || !ORIGINAL_CAVERN_HEIGHT) return;

  // --- Physics calculations are done in the ORIGINAL_CAVERN coordinate space ---
  if (inputState.up) {
    localState.velocityX += Math.sin(localState.angle) * acceleration;
    localState.velocityZ += Math.cos(localState.angle) * acceleration;
    const speed = Math.sqrt(localState.velocityX ** 2 + localState.velocityZ ** 2);
    if (speed > maxSpeed) {
      localState.velocityX = (localState.velocityX / speed) * maxSpeed;
      localState.velocityZ = (localState.velocityZ / speed) * maxSpeed;
    }
  }
  if (inputState.left) localState.angle += rotationSpeed;
  if (inputState.right) localState.angle -= rotationSpeed;

  // Apply velocity (in original texel units)
  localState.x += localState.velocityX;
  localState.z += localState.velocityZ;

  // Apply friction
  localState.velocityX *= friction;
  localState.velocityZ *= friction;

  // Clamp position within ORIGINAL texture boundaries
  localState.x = Math.max(0, Math.min(ORIGINAL_CAVERN_WIDTH, localState.x));
  localState.z = Math.max(0, Math.min(ORIGINAL_CAVERN_HEIGHT, localState.z));
  // ---

  // Send state (already relative to original texture) to server
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
        x: localState.x,
        z: localState.z,
        angle: localState.angle
    }));
  }
}

// ================================
// START THE GAME
// ================================
function startGame() { console.log("🚀 Starting game..."); setInterval(updateMovement, 1000 / 60); animate(); }

// ================================
// ANIMATION LOOP <<< MODIFIED: Scale positions for display
// ================================
function animate() {
    requestAnimationFrame(animate);

    // --- Collision Check & Texture Update ---
    // Need to convert ship's ORIGINAL coords to WORLD coords for check
    if (myId && serverPlayers[myId] && collisionContext && collisionImageData && lastCalculatedCavernScale) {
        const localOriginalPos = serverPlayers[myId]; // Position relative to original texture
        const shipWorldX = localOriginalPos.x * lastCalculatedCavernScale; // Convert to world units
        const shipWorldZ = localOriginalPos.z * lastCalculatedCavernScale; // Convert to world units
        checkCollisionAndModifyTexture(shipWorldX, shipWorldZ); // Check using world units
        if (textureNeedsUpdate) { collisionContext.putImageData(collisionImageData, 0, 0); cavernTexture.needsUpdate = true; textureNeedsUpdate = false; }
    }

    // --- Update Ship Meshes ---
    Object.keys(serverPlayers).forEach(playerId => {
        const playerData = serverPlayers[playerId]; // Data is relative to ORIGINAL texture
        if (ships[playerId]) {
            // Scale the position for display in the world
            ships[playerId].position.x = playerData.x * lastCalculatedCavernScale;
            ships[playerId].position.z = playerData.z * lastCalculatedCavernScale;
            // Rotation and scale are handled separately
            ships[playerId].rotation.z = playerData.angle + Math.PI;
            // Scale is set in createOrUpdateCavern and addShip
            // ships[playerId].scale.set(lastCalculatedCavernScale, lastCalculatedCavernScale, 1); // Redundant if done correctly elsewhere

            // Log position data for debugging multiplayer
             //if (playerId !== myId) { // Log other players only
             //    console.log(`Other [${playerId}]: Server Original (${playerData.x.toFixed(1)}, ${playerData.z.toFixed(1)}), Display World (${ships[playerId].position.x.toFixed(1)}, ${ships[playerId].position.z.toFixed(1)})`);
             //}

        } else if (shipGeometry && shipMaterial) {
            addShip(playerId); // Add mesh if missing
        }
    });

    // --- Update Camera Position ---
    if (myId && serverPlayers[myId] && SCALED_CAVERN_WIDTH && SCALED_CAVERN_HEIGHT && lastCalculatedCavernScale) {
        const localOriginalPos = serverPlayers[myId]; // Player pos relative to original tex
        // Target camera center in WORLD units
        const targetCamX = localOriginalPos.x * lastCalculatedCavernScale;
        const targetCamZ = localOriginalPos.z * lastCalculatedCavernScale;

        // Calculate view boundaries in WORLD units
        const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
        const camHeight = camera.position.y;
        const viewHalfHeight = Math.tan(halfFov) * camHeight;
        const viewHalfWidth = viewHalfHeight * camera.aspect;

        // Clamp camera center in WORLD units
        const camX = Math.max(viewHalfWidth, Math.min(SCALED_CAVERN_WIDTH - viewHalfWidth, targetCamX));
        const camZ = Math.max(viewHalfHeight, Math.min(SCALED_CAVERN_HEIGHT - viewHalfHeight, targetCamZ));

        camera.position.x = camX;
        camera.position.z = camZ;
        camera.lookAt(camX, 0, camZ);
    }

    // Render
    renderer.render(scene, camera);
}

// ================================
// COLLISION DETECTION & TEXTURE MODIFICATION <<< MODIFIED: Input is world coords
// ================================
function checkCollisionAndModifyTexture(shipWorldX, shipWorldZ) { // Takes WORLD coords
    if (!collisionContext || !collisionImageData || !ORIGINAL_CAVERN_WIDTH || !lastCalculatedCavernScale) return;
    const textureW = ORIGINAL_CAVERN_WIDTH; const textureH = ORIGINAL_CAVERN_HEIGHT;

    // Convert WORLD coords back to ORIGINAL texel coords for pixel manipulation
    const texX = Math.round(shipWorldX / lastCalculatedCavernScale);
    const texY = Math.round(shipWorldZ / lastCalculatedCavernScale);

    const data = collisionImageData.data; let modified = false;
    // Use the fixed pixel radius for collision check
    const radius = SHIP_COLLISION_RADIUS_TEX_PX;
    const startX = Math.max(0, texX - radius); const endX = Math.min(textureW, texX + radius);
    const startY = Math.max(0, texY - radius); const endY = Math.min(textureH, texY + radius);

    for (let y = startY; y < endY; y++) { for (let x = startX; x < endX; x++) {
            // Optional: Circular collision check in texel space
            // const distSq = (x - texX)**2 + (y - texY)**2;
            // if (distSq > radius**2) continue;
            const index = (y * textureW + x) * 4;
            if (data[index+3] > 0 && (data[index] > WALL_THRESHOLD || data[index+1] > WALL_THRESHOLD || data[index+2] > WALL_THRESHOLD)) { data[index + 3] = 0; modified = true; }
    } }
    if (modified) textureNeedsUpdate = true;
}


// ================================
// WEBSOCKET HANDLERS
// ================================
socket.onmessage = (event) => { try {
    const data = JSON.parse(event.data);
    if (data.myId) { // ID Assignment
        if (!myId) myId = data.myId; console.log("🔑 ID:", myId);
        // Set initial local state if received from server (optional)
        // if (data.initialState) {
        //    localState.x = data.initialState.x;
        //    localState.z = data.initialState.z;
        //    localState.angle = data.initialState.angle;
        // }
        return;
    }
    // Full state update
    serverPlayers = data; // Store the latest state {playerId: {x, z, angle}} (coords relative to original texture)
     //console.log("Received serverPlayers:", serverPlayers); // Debug log
    Object.keys(ships).forEach(playerId => { // Clean up disconnected players
        if (!serverPlayers[playerId]) {
            console.log(`➖ Removing ${playerId}`);
            if (ships[playerId]) scene.remove(ships[playerId]);
            delete ships[playerId];
        }
    });
    // Adding new players and updating positions happens in `animate` loop
} catch (error) { console.error("🚨 WS Message Error:", error, "Data:", event.data); } };
// ... (onerror, onclose, onopen remain the same) ...
socket.onerror = (error) => console.error("🔌 WS Error:", error); socket.onclose = (event) => { console.log("🔌 WS Closed:", event.code); Object.keys(ships).forEach(id => { if (ships[id]) scene.remove(ships[id]); }); ships = {}; serverPlayers = {}; myId = null; }; socket.onopen = () => console.log("🔌 WS Opened");


// ================================
// TOUCH CONTROLS
// ================================
// ... (no changes needed) ...
function isMobileDevice() { return ('ontouchstart' in window || navigator.maxTouchPoints > 0); } function createTouchControls() { if (!isMobileDevice()) return; console.log("📱 Touch controls"); const tc = document.createElement('div'); tc.id = 'touchControls'; Object.assign(tc.style, { position: 'absolute', bottom: '10px', left: '10px', right: '10px', height: '20vh', display: 'grid', gridTemplateRows: '1fr', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateAreas: "'left up right'", gap: '10px', zIndex: '10' }); const cmap = { 'left': 'left', 'up': 'up', 'right': 'right' }; Object.keys(cmap).forEach(cName => { const btn = document.createElement('div'); Object.assign(btn.style, { background: 'rgba(128,128,128,0.5)', borderRadius: '10px', touchAction: 'none', userSelect: 'none', webkitUserSelect: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '20px', color: 'white', gridArea: cmap[cName] }); btn.dataset.control = cName; btn.addEventListener('touchstart', (e) => { e.preventDefault(); inputState[cName] = true; btn.style.background = 'rgba(100,100,100,0.7)'; }, { passive: false }); const endT = (e) => { if(inputState[cName]){ e.preventDefault(); inputState[cName] = false; btn.style.background = 'rgba(128,128,128,0.5)'; } }; btn.addEventListener('touchend', endT, { passive: false }); btn.addEventListener('touchcancel', endT, { passive: false }); btn.addEventListener('touchmove', (e) => { e.preventDefault(); const t = e.touches[0]; const el = document.elementFromPoint(t.clientX, t.clientY); if (el !== btn && inputState[cName]) { inputState[cName] = false; btn.style.background = 'rgba(128,128,128,0.5)'; } else if (el === btn && !inputState[cName]) { inputState[cName] = true; btn.style.background = 'rgba(100,100,100,0.7)'; } }, { passive: false }); tc.appendChild(btn); }); document.body.appendChild(tc); function reqFS() { if (!document.fullscreenElement) { const el = document.documentElement; el.requestFullscreen?.().catch(err => console.warn(`FS fail: ${err.message}`)) || el.mozRequestFullScreen?.().catch(err => console.warn(`FS fail: ${err.message}`)) || el.webkitRequestFullscreen?.().catch(err => console.warn(`FS fail: ${err.message}`)) || el.msRequestFullscreen?.().catch(err => console.warn(`FS fail: ${err.message}`)); } } document.body.addEventListener('pointerdown', reqFS, { once: true }); }
createTouchControls();

// ================================
// REGISTER SERVICE WORKER FOR PWA
// ================================
// ... (no changes needed) ...
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/service-worker.js').then(reg => { console.log("🔧 SW Registered:", reg.scope); reg.addEventListener('updatefound', () => console.log("🔧 New SW found")); }).catch(err => console.error("🚨 SW Reg Failed:", err)); navigator.serviceWorker.addEventListener('controllerchange', () => console.log("🔧 New SW controlling page.")); }

// ================================
// LAUNCH TEXTURE LOADING
// ================================
requestTextures();

// --- END OF FILE client.js ---