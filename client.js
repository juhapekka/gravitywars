import * as THREE from "./node_modules/three/build/three.module.js";

//const socket = new WebSocket("ws://localhost:8081");
const socket = new WebSocket(`ws://${window.location.hostname}:8081`);

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




function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
setInterval(updateMovement, 50);
animate();