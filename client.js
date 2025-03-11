import * as THREE from "./node_modules/three/build/three.module.js";

document.documentElement.style.touchAction = 'none';
document.documentElement.style.userSelect = 'none';
document.body.style.userSelect = 'none';
document.body.style.webkitUserSelect = 'none';
document.body.style.msUserSelect = 'none';
document.body.style.mozUserSelect = 'none';
document.documentElement.style.userSelect = 'none'; // Prevent selection
document.documentElement.style.height = '100%';
document.documentElement.style.overflow = 'hidden';
document.body.style.height = '100%';
document.body.style.overflow = 'hidden';

window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });


const protocol = window.location.protocol === "https:" ? "wss" : "ws";
const socket = new WebSocket(`${protocol}://${window.location.hostname}:8081`);

// Paikallinen tila (oma x, z, kulma)
let localState = { x: 0, z: 0, angle: 0, velocityX: 0, velocityZ: 0 };
const inputState = { up: false, left: false, right: false };

// Kaikkiin pelaajiin liittyvät 3D-meshit (avaimena pelaajan id)
const ships = {};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 20, 0);
// suoraan yläpuolelle
camera.lookAt(0, 0, 0); // Kameran katse pisteeseen (0,0,0)

const renderer = new THREE.WebGLRenderer({ antialias: true, 
  canvas: document.getElementById("gameCanvas")
});
renderer.setSize(window.innerWidth, window.innerHeight);

// 3) Ladataan alus.png tekstuurina (ylhäältä katsottava sprite)
const textureLoader = new THREE.TextureLoader();
const shipTexture = textureLoader.load("alus.png", function(texture) {
  console.log("Tekstuuri ladattu onnistuneesti");
}, undefined, function(err) {
  console.error("Virhe tekstuurin latauksessa", err);
});

// Luodaan plane-geometry (2x2) -- säädä kokoa tarpeen mukaan
const playerGeometry = new THREE.PlaneGeometry(2, 2);

// Luodaan yksinkertainen MeshBasicMaterial, käytetään alus.png tekstuurina
// Oletetaan läpinäkyvyys, jos kuvassa on läpinäkyvä tausta.

const materials = [
  new THREE.MeshBasicMaterial({
    map: shipTexture,
    transparent: true,
    side: THREE.DoubleSide
  })
];



function addShip(playerId) {
  const shipMesh = new THREE.Mesh(playerGeometry, materials[0]);
  // Plane on pystyssä oletuksena, käännetään se vaakatasoon
  shipMesh.rotation.x = -Math.PI / 2;
  scene.add(shipMesh);
  ships[playerId] = shipMesh;
}

// 5) WebSocket-viestit: serveri lähettää kaikkien pelaajien tilat
socket.onmessage = event => {
  const serverPlayers = JSON.parse(event.data);

  // a) Luo/paivita jokainen serverin pelaaja sceneen
  Object.keys(serverPlayers).forEach(playerId => {
    const { x, z, angle } = serverPlayers[playerId];

    // Jos meillä ei ole vielä meshia tälle pelaajalle, luodaan
    if (!ships[playerId]) {
      addShip(playerId);
    }
    // Päivitetään aluksen sijainti/kulma
    ships[playerId].position.x = x - localState.x;
    ships[playerId].position.z = z - localState.z;
    ships[playerId].rotation.z = angle;
  });

  // b) Poistetaan scene:stä sellaiset alukset, joita serverillä ei enää ole
  Object.keys(ships).forEach(playerId => {
    if (!serverPlayers[playerId]) {
      scene.remove(ships[playerId]);
      delete ships[playerId];
    }
  });
};

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

  function updateMovement() {
    const acceleration = 0.02;
    const maxSpeed = 0.5;
    const friction = 0.98;
    const rotationSpeed = 0.1;
  
    if (inputState.up) {
      localState.velocityX -= Math.sin(localState.angle) * acceleration;
      localState.velocityZ -= Math.cos(localState.angle) * acceleration;
      
      const speed = Math.sqrt(localState.velocityX ** 2 + localState.velocityZ ** 2);
      if (speed > maxSpeed) {
        localState.velocityX *= maxSpeed / speed;
        localState.velocityZ *= maxSpeed / speed;
      }
    }
    if (inputState.left) {
      localState.angle += rotationSpeed;
    }
    if (inputState.right) {
      localState.angle -= rotationSpeed;
    }
    
    localState.x += localState.velocityX;
    localState.z += localState.velocityZ;
    
    localState.velocityX *= friction;
    localState.velocityZ *= friction;
    
    socket.send(JSON.stringify(localState));
  }




function isMobileDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints;
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
  touchContainer.style.gridTemplateAreas = "'left up right' 'downLeft down downRight'";
  touchContainer.style.gap = '5px';

  const controls = ['left', 'up', 'right', 'downLeft', 'downRight'];
  const areas = ['left', 'up', 'right', 'downLeft', 'downRight'];
  controls.forEach((control, index) => {
    if (!control) return;
    const button = document.createElement('div');
    button.style.background = 'grey';
    button.style.opacity = '0.5';
    button.style.touchAction = 'none';
    button.style.userSelect = 'none';
    button.dataset.control = control;
    button.style.gridArea = control;
    if (control === 'downLeft' || control === 'downRight') {
      button.style.width = '100%';
    }
    button.addEventListener('touchstart', () => inputState[control] = true);
    button.addEventListener('touchend', () => inputState[control] = false);
    touchContainer.appendChild(button);
  });

  document.body.appendChild(touchContainer);

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

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

setInterval(updateMovement, 50);

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .then(() => console.log("Service Worker Registered"))
      .catch(error => console.error("Service Worker Registration Failed", error));
}

animate();
