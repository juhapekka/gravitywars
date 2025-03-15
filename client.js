import * as THREE from "./node_modules/three/build/three.module.js";

// ================================
// MOBILE / TOUCH PREVENTIONS
// ================================
document.documentElement.style.touchAction = 'none';
document.documentElement.style.userSelect = 'none';
document.body.style.userSelect = 'none';
document.body.style.webkitUserSelect = 'none';
document.body.style.msUserSelect = 'none';
document.body.style.mozUserSelect = 'none';
document.documentElement.style.height = '100%';
document.documentElement.style.overflow = 'hidden';
document.body.style.height = '100%';
document.body.style.overflow = 'hidden';

// ================================
// THREE BASICS
// ================================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 20, 0);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas: document.getElementById("gameCanvas")
});
renderer.setSize(window.innerWidth, window.innerHeight);
// Ensure sRGB pipeline
renderer.outputEncoding = THREE.sRGBEncoding;

// On resize, adapt the camera + renderer
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});


function fitPlaneWidthPerspective(camera, planeWorldWidth) {
    // If the camera is overhead, the distance from the plane is about camera.position.y
    // (assuming plane is at y=0).
    const dist = camera.position.y;
  
    // Half of the plane's width
    const halfWidth = planeWorldWidth / 2;
  
    // For a perspective camera:
    // horizontalFov = 2 * atan( halfWidth / dist )
    // but the camera's .fov is verticalFov,
    // and horizontalFov = 2 * atan( tan(verticalFov/2) * aspect ).
    //
    // So we want:
    // tan(verticalFov/2) * aspect = (halfWidth / dist)
    // => verticalFov/2 = arctan((halfWidth / dist) / aspect)
    // => verticalFov = 2 * arctan((halfWidth / (dist * aspect)))
    
    const aspect = camera.aspect;
    const verticalFovRad = 2 * Math.atan( (halfWidth / (dist * aspect)) );
    const verticalFovDeg = THREE.MathUtils.radToDeg(verticalFovRad);
  
    camera.fov = verticalFovDeg;
    camera.updateProjectionMatrix();
  }
  
// ================================
// WEBSOCKET SETUP
// ================================
//const protocol = window.location.protocol === "https:" ? "wss" : "ws";
const protocol = window.location.protocol.includes("https") ? "wss" : "ws";
const socket = new WebSocket(`${protocol}://${window.location.hostname}:8081`);

// ================================
// GLOBAL STATES
// ================================
 // We'll track local input but rely on server coords for final camera
 let localState = { x: 0, z: 0, angle: 0, velocityX: 0, velocityZ: 0 };

 // We'll store the unique ID given by the server
 let myId = null;
 // We'll store serverPlayers globally so we can read them anywhere
 let serverPlayers = {};const inputState = { up: false, left: false, right: false };
const ships = {}; // Remote ship meshes

let shipTexture, cavernTexture;
let cavernPlane;
let CAVERN_WIDTH, CAVERN_HEIGHT;
let shipGeometry, shipMaterial;

// ================================
// LOADINGMANAGER FOR TEXTURES
// ================================
const manager = new THREE.LoadingManager();

manager.onStart = (url, itemsLoaded, itemsTotal) => {
  console.log(`🟡 Starting load: ${url} (${itemsLoaded}/${itemsTotal})`);
};
manager.onProgress = (url, itemsLoaded, itemsTotal) => {
  console.log(`⏳ Loading: ${url} (${itemsLoaded}/${itemsTotal})`);
};
manager.onLoad = () => {
  console.log("✅ All textures loaded!");
  finalizeSetup(); // We'll create geometry + call startGame() here
};
manager.onError = (url) => {
  console.error(`❌ Error loading ${url}`);
};

// The texture loader uses the manager
const textureLoader = new THREE.TextureLoader(manager);

// ================================
// INITIATE TEXTURE REQUESTS
// ================================
function requestTextures() {
  console.log("🟡 Requesting textures...");
  shipTexture = textureLoader.load("alus.png");
  cavernTexture = textureLoader.load("kenttä1.png");
}

// ================================
// FINALIZE AFTER TEXTURES LOADED
// ================================
function finalizeSetup() {
  // Confirm both textures exist
  if (!cavernTexture || !shipTexture) {
    console.error("🚨 Missing one or more textures.");
    return;
  }

  // sRGB for each texture
  shipTexture.encoding = THREE.sRGBEncoding;
  cavernTexture.encoding = THREE.sRGBEncoding;

  // Dimensions for the cavern
  CAVERN_WIDTH = cavernTexture.image.width;
  CAVERN_HEIGHT = cavernTexture.image.height;

  console.log(`Cavern texture: ${CAVERN_WIDTH}x${CAVERN_HEIGHT}`);

  createCavern(CAVERN_WIDTH, CAVERN_HEIGHT);
  createShipGeometry();

  // Now we can start the game logic
  startGame();
}

// ================================
// CREATE CAVERN PLANE
// ================================
function createCavern(w, h) {
    const SCALE_FACTOR = 0.025;
    const planeW = w * SCALE_FACTOR;
    const planeH = h * SCALE_FACTOR;
  
    const cavernGeometry = new THREE.PlaneGeometry(planeW, planeH);
    const cavernMaterial = new THREE.MeshBasicMaterial({
      map: cavernTexture,
      side: THREE.DoubleSide
    });
  
    cavernPlane = new THREE.Mesh(cavernGeometry, cavernMaterial);
    cavernPlane.rotation.x = -Math.PI / 2;
  
    // Position the plane so its center is at half of the *scaled* size
    cavernPlane.position.set(planeW / 2, 0, planeH / 2);
    scene.add(cavernPlane);
  }

// ================================
// CREATE SHIP GEOMETRY + MATERIAL
// ================================
function createShipGeometry() {
  shipGeometry = new THREE.PlaneGeometry(2, 2);

  // Optional filtering
  shipTexture.minFilter = THREE.LinearFilter;
  shipTexture.magFilter = THREE.LinearFilter;

  shipMaterial = new THREE.MeshBasicMaterial({
    map: shipTexture,
    transparent: true,
    side: THREE.DoubleSide
  });
}

// ================================
// USER INPUTS
// ================================
window.addEventListener("keydown", event => {
  if (event.key === "ArrowUp") {
    inputState.up = true;
  } else if (event.key === "ArrowLeft") {
    inputState.left = true;
  } else if (event.key === "ArrowRight") {
    inputState.right = true;
  }
});
window.addEventListener("keyup", event => {
  if (event.key === "ArrowUp") {
    inputState.up = false;
  } else if (event.key === "ArrowLeft") {
    inputState.left = false;
  } else if (event.key === "ArrowRight") {
    inputState.right = false;
  }
});

// ================================
// UPDATE MOVEMENT
// ================================
function updateMovement() {
  const acceleration = 0.02;
  const maxSpeed = 1.5;//0.5;
  const friction = 0.98;
  const rotationSpeed = 0.1;

  if (!CAVERN_WIDTH || !CAVERN_HEIGHT) return; // Prevent errors

  // Forward
  if (inputState.up) {
    localState.velocityX += Math.sin(localState.angle) * acceleration;
    localState.velocityZ += Math.cos(localState.angle) * acceleration;
    const speed = Math.sqrt(localState.velocityX ** 2 + localState.velocityZ ** 2);
    if (speed > maxSpeed) {
      localState.velocityX *= maxSpeed / speed;
      localState.velocityZ *= maxSpeed / speed;
    }
  }
  // Turn
  if (inputState.left) {
    localState.angle += rotationSpeed;
  }
  if (inputState.right) {
    localState.angle -= rotationSpeed;
  }

  // Position + friction
  localState.x += localState.velocityX;
  localState.z += localState.velocityZ;

  localState.velocityX *= friction;
  localState.velocityZ *= friction;

  // Clamp within cavern
  localState.x = Math.max(0, Math.min(CAVERN_WIDTH, localState.x));
  localState.z = Math.max(0, Math.min(CAVERN_HEIGHT, localState.z));

  // Send data to server
  socket.send(JSON.stringify(localState));
}

// ================================
// START THE GAME
// ================================
function startGame() {
  console.log("🚀 Starting the game...");
  setInterval(updateMovement, 50);
  animate();
}

// ================================
// ANIMATION LOOP
// ================================
function animate() {
  // We'll reposition the camera based on server coords for local player
  if (myId && serverPlayers[myId]) {
    const localServerPos = serverPlayers[myId];

    const SCREEN_SIZE = 20;
    const halfScreen = SCREEN_SIZE / 2;
    const camX = Math.max(halfScreen, Math.min(CAVERN_WIDTH - halfScreen, localServerPos.x));
    const camZ = Math.max(halfScreen, Math.min(CAVERN_HEIGHT - halfScreen, localServerPos.z));

    camera.position.x = camX;
    camera.position.z = camZ;
    camera.lookAt(camX, 0, camZ);
  }


  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

// ================================
// WEBSOCKET ONMESSAGE
// ================================
socket.onmessage = (event) => {
    // Step A: parse the data
    const data = JSON.parse(event.data);
  
    // Step B: if there's an ID, store it in myId
    if (data.myId) {
      myId = data.myId;
      console.log("🔑 Received localId from server:", myId);
      return;
    }
  
    // Step C: otherwise, 'data' is the dictionary of all players
    serverPlayers = data;
  
    // Step D: same logic as before for creating/updating ships...
    Object.keys(serverPlayers).forEach(playerId => {
      const { x, z, angle } = serverPlayers[playerId];
      if (!ships[playerId]) {
        addShip(playerId);
      }
      ships[playerId].position.x = x;
      ships[playerId].position.z = z;
      ships[playerId].rotation.z = angle;
    });
  
    // remove any ships no longer on the server
    Object.keys(ships).forEach(playerId => {
      if (!serverPlayers[playerId]) {
        scene.remove(ships[playerId]);
        delete ships[playerId];
      }
    });
  };

// ================================
// ADD SHIP HELPERS
// ================================
function addShip(playerId) {
  // Use shipGeometry + shipMaterial created once textures loaded
  const shipMesh = new THREE.Mesh(shipGeometry, shipMaterial);
  shipMesh.rotation.x = -Math.PI / 2;
  shipMesh.position.y = 0.1;
  scene.add(shipMesh);
  ships[playerId] = shipMesh;
}

// ================================
// TOUCH CONTROLS
// ================================
function isMobileDevice() {
  return ('ontouchstart' in window || navigator.maxTouchPoints);
}

function createTouchControls() {
  if (!isMobileDevice()) return;

  const touchContainer = document.createElement('div');
  touchContainer.style.position = 'absolute';
  touchContainer.style.bottom = '0';
  touchContainer.style.width = '100%';
  touchContainer.style.height = '25%';
  touchContainer.style.display = 'grid';
  touchContainer.style.gridTemplateRows = '2fr 1fr';
  touchContainer.style.gridTemplateColumns = '1fr 1fr 1fr';
  // Original layout
  touchContainer.style.gridTemplateAreas = "'left up right' 'downLeft downRight downRight'";
  touchContainer.style.gap = '5px';

  const controls = ['left', 'up', 'right', 'downLeft', 'downRight'];
  controls.forEach(control => {
    if (!control) return;
    const button = document.createElement('div');
    button.style.background = 'grey';
    button.style.opacity = '0.5';
    button.style.touchAction = 'none';
    button.style.userSelect = 'none';
    button.dataset.control = control;
    button.style.gridArea = control;
    button.addEventListener('touchstart', () => inputState[control] = true);
    button.addEventListener('touchend', () => inputState[control] = false);
    touchContainer.appendChild(button);
  });

  document.body.appendChild(touchContainer);

  // Request fullscreen on first tap
  function requestFullScreen() {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    } else if (document.documentElement.mozRequestFullScreen) {
      document.documentElement.mozRequestFullScreen();
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen();
    } else if (document.documentElement.msRequestFullscreen) {
      document.documentElement.msRequestFullscreen();
    }
  }
  document.addEventListener('click', () => {
    if (isMobileDevice()) requestFullScreen();
  }, { once: true });
}

createTouchControls();

// ================================
// REGISTER SERVICE WORKER FOR PWA
// ================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js')
    .then(() => console.log("Service Worker Registered"))
    .catch(error => console.error("Service Worker Registration Failed", error));
}

// ================================
// LAUNCH TEXTURE LOADING
// ================================
requestTextures();
// The finalizeSetup() will be called automatically by manager.onLoad when done