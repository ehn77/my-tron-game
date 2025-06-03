import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.176.0/build/three.module.js';

// --- WebSocket Server Connection ---
const socket = new WebSocket('wss://my-tron-game.onrender.com');
socket.onopen = () => { 
    console.log('Successfully connected to the game server!'); 
    if (instructions.style.display === 'flex' && instructions.querySelector('p').textContent.includes("Connecting")) {
        instructions.innerHTML = "<h1>Disc Wars</h1><p>Click to Play!</p>";
    }
};
socket.onclose = () => {
    console.log('Disconnected from the game server.');
    const gameStatusElem = document.getElementById('gameStatus');
    if (gameStatusElem) gameStatusElem.textContent = "Status: Disconnected";
    // Show a generic game over/disconnected message
    if (gameOverScreenElem.style.display !== 'flex' && winningScreenElem.style.display !== 'flex') {
        showGameOverScreen("Disconnected from server. Refresh to try again.");
        // Disable play again buttons if disconnected
        if(playAgainButtonLose) playAgainButtonLose.style.display = 'none';
        if(playAgainButtonWin) playAgainButtonWin.style.display = 'none';
    }
};
socket.onerror = (error) => { console.error('WebSocket Error:', error); };

// --- Core Three.js Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const clock = new THREE.Clock();
const textureLoader = new THREE.TextureLoader();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 5;
document.body.appendChild(renderer.domElement);

// --- Arena Constants ---
const arenaSize = 20;
const wallHeight = 10;
const wallCenterY = -1 + wallHeight / 2;

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0x505080, 0.9);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
directionalLight.position.set(0, 20, 0);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 4096;
directionalLight.shadow.mapSize.height = 4096;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 50;
directionalLight.shadow.camera.left = -arenaSize;
directionalLight.shadow.camera.right = arenaSize;
directionalLight.shadow.camera.top = arenaSize;
directionalLight.shadow.camera.bottom = -arenaSize;
scene.add(directionalLight);
const pointLightCenter = new THREE.PointLight(0x00ffff, 0.9, 40, 1.8);
pointLightCenter.position.set(0, wallCenterY, 0);
scene.add(pointLightCenter);
const pointLightPlayerAccent = new THREE.PointLight(0xff00ff, 0.6, 30, 2);
scene.add(pointLightPlayerAccent);

// --- Global Variables for Camera Control ---
let cameraYaw = 0;
let cameraPitch = Math.PI / 4;
const mouseSensitivity = 0.002;
const cameraDistance = 9;

// --- Camera Collision Constants ---
const MIN_CAMERA_DISTANCE = 1.5;
const CAMERA_COLLISION_BUFFER = 0.3;
const cameraRaycaster = new THREE.Raycaster();
const cameraCollidables = [];

// --- Player Textures & Materials ---
const frontTexture = textureLoader.load('imgs/tron_guy.png');
const backTexture = textureLoader.load('imgs/tron_guy_back.png');
const leftStepTexture = textureLoader.load('imgs/left_step.png');
const rightStepTexture = textureLoader.load('imgs/right_step.png');
const leftTexture = textureLoader.load('imgs/move_left.png'); // Strafe left
const rightTexture = textureLoader.load('imgs/move_right.png'); // Strafe right
const frontRightTexture = textureLoader.load('imgs/front_right_step.png'); // Walk backward step
const frontLeftTexture = textureLoader.load('imgs/front_left_step.png'); // Walk backward step

const animationTextures = {
    'frontTexture': frontTexture,
    'backTexture': backTexture,
    'leftStepTexture': leftStepTexture,
    'rightStepTexture': rightStepTexture,
    'move_leftTexture': leftTexture,
    'move_rightTexture': rightTexture,
    'frontLeftTexture': frontLeftTexture,
    'frontRightTexture': frontRightTexture
};

const playerRenderSide = THREE.FrontSide;
const playerBaseColor = 0xffffff;
const frontMaterial = new THREE.MeshStandardMaterial({ map: frontTexture, color: playerBaseColor, transparent: true, roughness: 0.7, metalness: 0.2, side: playerRenderSide, alphaTest: 0.1 });
const backMaterial = new THREE.MeshStandardMaterial({ map: backTexture, color: playerBaseColor, transparent: true, roughness: 0.7, metalness: 0.2, side: playerRenderSide, alphaTest: 0.1 });

// --- Player Setup ---
const playerGeometry = new THREE.PlaneGeometry(2, 2);
const frontPlane = new THREE.Mesh(playerGeometry, frontMaterial);
const backPlane = new THREE.Mesh(playerGeometry, backMaterial);
backPlane.rotation.y = Math.PI;
const player = new THREE.Object3D(); // Local player's 3D object
player.add(frontPlane);
player.add(backPlane);
player.position.y = 0;
player.castShadow = true;
frontPlane.castShadow = true;
backPlane.castShadow = true;
scene.add(player);

// --- Animation Variables ---
const stepDuration = 0.3; // For client-side prediction
let walkAnimationTimer = 0; // For client-side prediction
let isLeftStep = true;      // For client-side prediction

// --- Map Materials, Ground & Arena Setup ---
const surfaceBaseColor = 0x000818;
const gridColorCenter = 0x00ffff;
const gridColorGrid = 0x00aaff;
const gridDivisions = arenaSize / 1;
const solidSurfaceMaterial = new THREE.MeshStandardMaterial({ color: surfaceBaseColor, side: THREE.DoubleSide, roughness: 0.7, metalness: 0.2, emissive: 0x001020, emissiveIntensity: 0.4 });
const wallSurfaceMaterial = new THREE.MeshStandardMaterial({ color: 0x00152F, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3, emissive: 0x001A3F, emissiveIntensity: 0.4 });

const groundPlaneMesh = new THREE.Mesh(new THREE.PlaneGeometry(arenaSize, arenaSize), solidSurfaceMaterial);
groundPlaneMesh.rotation.x = -Math.PI / 2;
groundPlaneMesh.position.y = -1;
groundPlaneMesh.receiveShadow = true;
scene.add(groundPlaneMesh);
cameraCollidables.push(groundPlaneMesh);
const groundGrid = new THREE.GridHelper(arenaSize, gridDivisions, gridColorCenter, gridColorGrid);
groundGrid.position.y = -1 + 0.01;
groundGrid.material.transparent = true;
groundGrid.material.opacity = 0.5;
scene.add(groundGrid);

const wallPlaneGeometry = new THREE.PlaneGeometry(arenaSize, wallHeight);
const sideWallPlaneGeometry = new THREE.PlaneGeometry(arenaSize, wallHeight);
const ceilingPlaneGeometry = new THREE.PlaneGeometry(arenaSize, arenaSize);

const wallDefs = [
    { pos: [0, wallCenterY, -arenaSize / 2], rotY: 0 },
    { pos: [0, wallCenterY, arenaSize / 2], rotY: Math.PI },
    { geo: sideWallPlaneGeometry, pos: [-arenaSize / 2, wallCenterY, 0], rotY: Math.PI / 2 },
    { geo: sideWallPlaneGeometry, pos: [arenaSize / 2, wallCenterY, 0], rotY: -Math.PI / 2 }
];
wallDefs.forEach(def => {
    const wall = new THREE.Mesh(def.geo || wallPlaneGeometry, wallSurfaceMaterial);
    wall.position.set(...def.pos);
    if (def.rotY !== undefined) wall.rotation.y = def.rotY;
    wall.castShadow = true; wall.receiveShadow = true;
    scene.add(wall);
    cameraCollidables.push(wall);
});
const ceilingPlane = new THREE.Mesh(ceilingPlaneGeometry, solidSurfaceMaterial);
ceilingPlane.position.set(0, groundPlaneMesh.position.y + wallHeight, 0);
ceilingPlane.rotation.x = Math.PI / 2;
scene.add(ceilingPlane);
ceilingPlane.receiveShadow = true;
cameraCollidables.push(ceilingPlane);
const ceilingGrid = new THREE.GridHelper(arenaSize, gridDivisions, gridColorCenter, gridColorGrid);
ceilingGrid.position.y = groundPlaneMesh.position.y + wallHeight - 0.01;
ceilingGrid.material.transparent = true;
ceilingGrid.material.opacity = 0.4;
scene.add(ceilingGrid);

// --- Disc Setup ---
const discGeometry = new THREE.CircleGeometry(0.25, 32);
const discMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, side: THREE.DoubleSide, roughness: 0.1, metalness: 0.3, emissive: 0x00ffff, emissiveIntensity: 2.5 });
const localPlayerInitialDiscMesh = new THREE.Mesh(discGeometry, discMaterial);
localPlayerInitialDiscMesh.rotation.set(-0.5, -1, 0);
localPlayerInitialDiscMesh.castShadow = true;
player.add(localPlayerInitialDiscMesh);
localPlayerInitialDiscMesh.position.set(-0.3, -0.2, 0.01);

let localPlayerDiscIdFromServer = null;
let discState = 'held';

// --- Multiplayer State Variables ---
let localPlayerId = null;
const otherPlayers = new Map();
const allDiscsInScene = new Map();
let currentServerPlayersState = {}; // Cache for current player states from server

// --- UI Elements ---
const instructions = document.getElementById('instructions');
const hud = document.getElementById('hud');
const gameFullMessageElem = document.getElementById('gameFullMessage');
const gameOverScreenElem = document.getElementById('gameOverScreen');
const gameOverMessageElem = document.getElementById('gameOverMessage');
const winningScreenElem = document.getElementById('winningScreen');
const localHealthBarFill = document.getElementById('healthBarFill');
const localHealthNumerical = document.getElementById('healthNumerical');
const gameStatusElem = document.getElementById('gameStatus');
const scoreElem = document.getElementById('score');
const playAgainButtonWin = document.getElementById('playAgainButtonWin');
const playAgainButtonLose = document.getElementById('playAgainButtonLose');


// --- Keyboard Input & Pointer Lock ---
const keysPressed = {};
document.addEventListener('keydown', (event) => { keysPressed[event.key.toLowerCase()] = true; });
document.addEventListener('keyup', (event) => { keysPressed[event.key.toLowerCase()] = false; });

function onMouseMove(event) {
    if (document.pointerLockElement === renderer.domElement) {
        cameraYaw -= event.movementX * mouseSensitivity;
        cameraPitch -= event.movementY * mouseSensitivity;
        cameraPitch = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPitch));
    }
}
if (instructions) {
    instructions.addEventListener('click', () => {
        if (socket.readyState === WebSocket.OPEN) { 
             renderer.domElement.requestPointerLock();
        } else {
            instructions.innerHTML = "<h1>Disc Wars</h1><p>Connecting to server...</p>";
        }
    });
} else {
     renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
}
document.addEventListener('pointerlockchange', () => {
    const isGameOver = gameOverScreenElem.style.display === 'flex' || winningScreenElem.style.display === 'flex';
    if (document.pointerLockElement === renderer.domElement) {
        if(instructions) instructions.style.display = 'none';
        if(hud && !isGameOver) hud.style.display = 'block'; 
        document.addEventListener('mousemove', onMouseMove, false);
    } else {
        if (!isGameOver && gameFullMessageElem.style.display !== 'flex') {
            if(instructions) instructions.style.display = 'flex';
        }
        if(hud) hud.style.display = 'none'; 
        document.removeEventListener('mousemove', onMouseMove, false);
    }
}, false);
document.addEventListener('pointerlockerror', (error) => console.error('Pointer Lock Error:', error));


// --- Helper Functions for UI ---
function showWinningScreen() {
    if(winningScreenElem) winningScreenElem.style.display = 'flex';
    if(playAgainButtonWin) playAgainButtonWin.style.display = 'inline-block'; // Show button
    if(gameOverScreenElem) gameOverScreenElem.style.display = 'none';
    if(hud) hud.style.display = 'none';
    if(instructions) instructions.style.display = 'none';
    if(document.pointerLockElement) document.exitPointerLock();
}

function showGameOverScreen(message = "Better luck next time!") {
    if(gameOverMessageElem) gameOverMessageElem.textContent = message;
    if(gameOverScreenElem) gameOverScreenElem.style.display = 'flex';
    if(playAgainButtonLose) playAgainButtonLose.style.display = 'inline-block'; // Show button
    if(winningScreenElem) winningScreenElem.style.display = 'none';
    if(hud) hud.style.display = 'none';
    if(instructions) instructions.style.display = 'none';
    if(document.pointerLockElement) document.exitPointerLock();
}

function hideEndScreensAndPrepareForNewGame() {
    if(winningScreenElem) winningScreenElem.style.display = 'none';
    if(gameOverScreenElem) gameOverScreenElem.style.display = 'none';
    
    if(instructions) {
        instructions.innerHTML = "<h1>Disc Wars</h1><p>Waiting for next round...</p>";
        instructions.style.display = 'flex';
    }
    if(hud) hud.style.display = 'none';
}

if(playAgainButtonWin) {
    playAgainButtonWin.addEventListener('click', () => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'requestPlayAgain' }));
        }
        hideEndScreensAndPrepareForNewGame();
    });
}

if(playAgainButtonLose) {
    playAgainButtonLose.addEventListener('click', () => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'requestPlayAgain' }));
        }
        hideEndScreensAndPrepareForNewGame();
    });
}


// --- Helper Function for Other Players ---
function createOtherPlayerModel() {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const opFrontMaterial = new THREE.MeshStandardMaterial({ map: frontTexture, color: playerBaseColor, transparent: true, roughness: 0.7, metalness: 0.1, side: playerRenderSide, alphaTest: 0.1 });
    const opBackMaterial = new THREE.MeshStandardMaterial({ map: backTexture, color: playerBaseColor, transparent: true, roughness: 0.7, metalness: 0.1, side: playerRenderSide, alphaTest: 0.1 });
    const opFrontPlane = new THREE.Mesh(geometry, opFrontMaterial);
    const opBackPlane = new THREE.Mesh(geometry, opBackMaterial);
    opBackPlane.rotation.y = Math.PI;
    opFrontPlane.castShadow = true; opBackPlane.castShadow = true;
    const otherPlayerObject = new THREE.Object3D();
    otherPlayerObject.add(opFrontPlane); otherPlayerObject.add(opBackPlane);
    otherPlayerObject.castShadow = true;
    return { mesh: otherPlayerObject, frontMaterial: opFrontMaterial, backMaterial: opBackMaterial };
}

// --- Network Message Handling ---
socket.onmessage = (event) => {
    try {
        const message = JSON.parse(event.data);

        if (message.type === 'gameFull') {
            if (gameFullMessageElem) gameFullMessageElem.style.display = 'flex';
            if (instructions) {
                instructions.innerHTML = "<h1>Game is Full!</h1><p>Please try again later.</p>";
                instructions.style.display = 'flex'; 
            }
            if(hud) hud.style.display = 'none';
            socket.close();
            return;
        }

        if (message.type === 'assignId') {
            localPlayerId = message.id;
            if (message.initialDiscId) {
                localPlayerDiscIdFromServer = message.initialDiscId;
                allDiscsInScene.set(localPlayerDiscIdFromServer, localPlayerInitialDiscMesh);
            }
            console.log('My Player ID:', localPlayerId, 'My Disc ID:', localPlayerDiscIdFromServer);
            if (gameFullMessageElem) gameFullMessageElem.style.display = 'none';
             if(instructions && instructions.style.display === 'flex') {
                instructions.innerHTML = "<h1>Disc Wars</h1><p>Click to Play!</p>";
            }
            // HUD visibility is handled by pointerlock

        } else if (message.type === 'worldUpdate') {
            currentServerPlayersState = message.players || {}; 
            const serverDiscs = message.discs || {};
            const gameInfo = message.gameInfo || { status: 'waiting', winner: null };
            const receivedPlayerIds = new Set();
            const receivedDiscIds = new Set();

            if (localPlayerId && currentServerPlayersState[localPlayerId]) {
                const lpData = currentServerPlayersState[localPlayerId];
                if (localHealthNumerical) localHealthNumerical.textContent = `HP: ${lpData.health}/${lpData.maxHealth}`;
                if (localHealthBarFill) {
                    const healthPercentage = (lpData.health / lpData.maxHealth) * 100;
                    localHealthBarFill.style.width = `${healthPercentage}%`;
                    if (healthPercentage <= 25) localHealthBarFill.style.backgroundColor = '#ff0000'; 
                    else if (healthPercentage <= 50) localHealthBarFill.style.backgroundColor = '#ffff00'; 
                    else localHealthBarFill.style.backgroundColor = '#00ff00'; 
                }
                if (scoreElem) scoreElem.textContent = `Score: ${lpData.score}`;
            } else if (localPlayerId && !currentServerPlayersState[localPlayerId]) { 
                if (localHealthNumerical) localHealthNumerical.textContent = `HP: --/--`;
                if (localHealthBarFill) localHealthBarFill.style.width = `0%`;
                if (scoreElem) scoreElem.textContent = `Score: N/A`;
            }
            
            if (gameStatusElem) {
                let statusText = `Status: ${gameInfo.status}`;
                if (gameInfo.status !== 'gameOver') { 
                    gameStatusElem.textContent = statusText;
                } else {
                     gameStatusElem.textContent = `Status: Game Over`; // Simple status on HUD for game over
                }
            }

            if (gameInfo.status === 'gameOver') {
                if (gameOverScreenElem.style.display !== 'flex' && winningScreenElem.style.display !== 'flex') { // Only trigger if not already shown
                    if (gameInfo.winner === localPlayerId) {
                        showWinningScreen();
                    } else if (gameInfo.winner && gameInfo.winner !== localPlayerId) {
                        const winnerName = currentServerPlayersState[gameInfo.winner]?.id || "Opponent"; // Fallback name
                        showGameOverScreen(`You have been derezzed by ${winnerName}!`);
                    } else { 
                        showGameOverScreen("The cycle ends in a draw!");
                    }
                }
            } else { // Game is 'waiting' or 'active'
                 // If instructions are showing "Waiting for next round..." and game becomes active, hide instructions
                if (instructions.style.display === 'flex' && instructions.querySelector('p').textContent.includes("Waiting for next round")) {
                    if (gameInfo.status === 'active' || (gameInfo.status === 'waiting' && Object.keys(currentServerPlayersState).length < 2)) {
                         instructions.innerHTML = "<h1>Disc Wars</h1><p>Click to Play!</p>"; // Reset for new game start
                         // Pointer lock will handle hiding it and showing HUD
                    }
                }
                // Ensure end screens are hidden if game is not over
                if (winningScreenElem.style.display === 'flex' || gameOverScreenElem.style.display === 'flex') {
                    hideEndScreensAndPrepareForNewGame(); // This will show "Waiting for next round..."
                }
            }


            // Update Players
            for (const playerId in currentServerPlayersState) {
                receivedPlayerIds.add(playerId);
                const playerData = currentServerPlayersState[playerId];
                if (!playerData) continue;

                let playerObjectToUpdate, playerFrontMatToUpdate, playerBackMatToUpdate;

                if (playerId === localPlayerId) {
                    playerObjectToUpdate = player;
                    playerFrontMatToUpdate = frontMaterial; 
                    playerBackMatToUpdate = backMaterial;

                    let newX = playerData.x; let newY = playerData.y; let newZ = playerData.z;
                    const playerRadius = playerGeometry.parameters.width / 2;
                    const bounds = arenaSize / 2;
                    const clampBuffer = 0.5; 
                    if (newX + playerRadius + clampBuffer > bounds) newX = bounds - playerRadius - clampBuffer;
                    else if (newX - playerRadius - clampBuffer < -bounds) newX = -bounds + playerRadius + clampBuffer;
                    if (newZ + playerRadius + clampBuffer > bounds) newZ = bounds - playerRadius - clampBuffer;
                    else if (newZ - playerRadius - clampBuffer < -bounds) newZ = -bounds + playerRadius + clampBuffer;
                    
                    if (!playerData.isDefeated) {
                        playerObjectToUpdate.position.set(newX, newY, newZ);
                    }
                    playerObjectToUpdate.rotation.y = playerData.rotationY;
                    playerObjectToUpdate.visible = !playerData.isDefeated;


                    if (playerData.heldDiscId && playerData.heldDiscId === localPlayerDiscIdFromServer) {
                        discState = 'held';
                    }
                } else { // Opponent players
                    let otherP = otherPlayers.get(playerId);
                    if (!otherP) {
                        otherP = createOtherPlayerModel();
                        scene.add(otherP.mesh);
                        otherPlayers.set(playerId, otherP);
                    }
                    playerObjectToUpdate = otherP.mesh;
                    playerFrontMatToUpdate = otherP.frontMaterial;
                    playerBackMatToUpdate = otherP.backMaterial;

                    if (!playerData.isDefeated) {
                        playerObjectToUpdate.position.set(playerData.x, playerData.y, playerData.z);
                    }
                    playerObjectToUpdate.rotation.y = playerData.rotationY;
                    playerObjectToUpdate.visible = !playerData.isDefeated;
                }

                if (playerData.animation && playerFrontMatToUpdate && playerBackMatToUpdate) {
                    const texFrontName = playerData.animation.textureNameForFront;
                    const texBackName = playerData.animation.textureNameForBack;
                    
                    const texFront = animationTextures[texFrontName];
                    const texBack = animationTextures[texBackName];

                    if (texFront && playerFrontMatToUpdate.map !== texFront) {
                        playerFrontMatToUpdate.map = texFront;
                    }
                    if (texBack && playerBackMatToUpdate.map !== texBack) {
                        playerBackMatToUpdate.map = texBack;
                    }
                }
            }
            for (const existingPlayerId of otherPlayers.keys()) {
                if (!receivedPlayerIds.has(existingPlayerId)) {
                    const pToRemove = otherPlayers.get(existingPlayerId);
                    if (pToRemove && pToRemove.mesh) scene.remove(pToRemove.mesh);
                    otherPlayers.delete(existingPlayerId);
                }
            }

            // Update Discs
            for (const discId in serverDiscs) {
                receivedDiscIds.add(discId);
                const discData = serverDiscs[discId];
                if (!discData) continue;

                let discMesh = allDiscsInScene.get(discId);
                if (!discMesh) {
                    discMesh = new THREE.Mesh(discGeometry, discMaterial.clone());
                    discMesh.castShadow = true;
                    allDiscsInScene.set(discId, discMesh);
                }
                
                let ownerIsDefeated = false;
                let ownerIsActive = true; 
                if (discData.ownerId) {
                    const ownerData = currentServerPlayersState[discData.ownerId]; 
                    if(ownerData) {
                        ownerIsDefeated = ownerData.isDefeated;
                        ownerIsActive = ownerData.isActive;
                    } else {
                         ownerIsActive = false; 
                    }
                }
                discMesh.visible = !discData.ownerId || (ownerIsActive && !ownerIsDefeated);


                if (discData.ownerId) {
                    const ownerObject = (discData.ownerId === localPlayerId) ? player : (otherPlayers.get(discData.ownerId)?.mesh);
                    if (ownerObject && ownerIsActive && !ownerIsDefeated) { 
                        if (discMesh.parent !== ownerObject) {
                            discMesh.parent?.remove(discMesh);
                            ownerObject.add(discMesh);
                        }
                        discMesh.position.set(-0.3, -0.2, 0.01);
                        discMesh.rotation.set(-0.5, -1, 0);
                        if (discId === localPlayerDiscIdFromServer) discState = 'held';
                    } else { 
                        discMesh.parent?.remove(discMesh);
                        if (discMesh.visible) scene.add(discMesh); 
                        discMesh.position.set(discData.x, discData.y, discData.z);
                        discMesh.rotation.set(discData.rotX, discData.rotY, discData.rotZ);
                    }
                } else { 
                    discMesh.parent?.remove(discMesh);
                    if (discMesh.visible) scene.add(discMesh);
                    discMesh.position.set(discData.x, discData.y, discData.z);
                    discMesh.rotation.set(discData.rotX, discData.rotY, discData.rotZ);
                    if (discId === localPlayerDiscIdFromServer && discState === 'held') {
                        discState = 'thrown_or_returning';
                    }
                }
            }
            for (const existingDiscId of allDiscsInScene.keys()) {
                if (!receivedDiscIds.has(existingDiscId)) {
                    const dToRemove = allDiscsInScene.get(existingDiscId);
                    dToRemove?.parent?.remove(dToRemove);
                    allDiscsInScene.delete(existingDiscId);
                }
            }

        } else if (message.type === 'playerLeft') {
            const leftPlayerId = message.id;
            const pToRemove = otherPlayers.get(leftPlayerId);
            if (pToRemove && pToRemove.mesh) scene.remove(pToRemove.mesh);
            otherPlayers.delete(leftPlayerId);
        }
    } catch (error) { console.error('Error processing message:', event.data, error); }
};

// --- Animation Loop ---
function animate() {
    const deltaTime = clock.getDelta();
    const isEndScreenVisible = gameOverScreenElem.style.display === 'flex' || winningScreenElem.style.display === 'flex';

    if (socket.readyState === WebSocket.OPEN && !isEndScreenVisible) { // Only send input if game is potentially active
        const inputPayload = {
            type: 'playerInput',
            keys: { 
                w: keysPressed['w'] || false, a: keysPressed['a'] || false,
                s: keysPressed['s'] || false, d: keysPressed['d'] || false,
                space: keysPressed[' '] || false, q: keysPressed['q'] || false,
            },
            yaw: cameraYaw, pitch: cameraPitch,
        };
        socket.send(JSON.stringify(inputPayload));
    }

    const localPlayerServerData = localPlayerId ? currentServerPlayersState[localPlayerId] : null;
    const amIDefeated = localPlayerServerData ? localPlayerServerData.isDefeated : false;


    if (keysPressed['q'] && discState === 'held' && localPlayerId && localPlayerDiscIdFromServer && 
        socket.readyState === WebSocket.OPEN && !amIDefeated && !isEndScreenVisible) {
        const throwOrigin = new THREE.Vector3();
        const throwDirection = new THREE.Vector3();
        player.getWorldPosition(throwOrigin);
        throwOrigin.y += 0.5; 
        camera.getWorldDirection(throwDirection);
        throwOrigin.add(throwDirection.clone().multiplyScalar(0.5));

        socket.send(JSON.stringify({
            type: 'requestThrowDisc',
            discId: localPlayerDiscIdFromServer,
            throwData: {
                origin: { x: throwOrigin.x, y: throwOrigin.y, z: throwOrigin.z },
                direction: { x: throwDirection.x, y: throwDirection.y, z: throwDirection.z }
            }
        }));
        discState = 'requestingThrow';
    }

    if (!amIDefeated && !isEndScreenVisible) { 
        walkAnimationTimer += deltaTime;
        let newFrontTexture = frontMaterial.map; 
        let newBackTexture = backMaterial.map;
        let isMoving = false;

        if (keysPressed['w']) { 
            isMoving = true;
            if (walkAnimationTimer > stepDuration) {
                walkAnimationTimer = 0;
                isLeftStep = !isLeftStep;
            }
            newBackTexture = isLeftStep ? leftStepTexture : rightStepTexture;
            newFrontTexture = frontTexture; 
        } else if (keysPressed['s']) { 
            isMoving = true;
            if (walkAnimationTimer > stepDuration) {
                walkAnimationTimer = 0;
                isLeftStep = !isLeftStep;
            }
            newFrontTexture = isLeftStep ? frontLeftTexture : frontRightTexture; 
            newBackTexture = backTexture;   
        } else if (keysPressed['a']) { 
            isMoving = true;
            newBackTexture = leftTexture;   
            newFrontTexture = frontTexture; 
            walkAnimationTimer = 0;         
            isLeftStep = true;          
        } else if (keysPressed['d']) { 
            isMoving = true;
            newBackTexture = rightTexture; 
            newFrontTexture = frontTexture; 
            walkAnimationTimer = 0;         
            isLeftStep = true;          
        }

        if (!isMoving) { 
            newFrontTexture = frontTexture; 
            newBackTexture = backTexture;   
        }

        if (frontMaterial.map !== newFrontTexture) {
            frontMaterial.map = newFrontTexture;
        }
        if (backMaterial.map !== newBackTexture) {
            backMaterial.map = newBackTexture;
        }
    }

    if(player && pointLightPlayerAccent && player.visible) {
        pointLightPlayerAccent.position.set(player.position.x, player.position.y + 3, player.position.z + 2);
    } else if (pointLightPlayerAccent) {
        pointLightPlayerAccent.position.y = -1000; 
    }

    if (player && player.position && player.visible && !isEndScreenVisible) { 
        const cameraLookAtTarget = player.position.clone();
        const idealGlobalOffsetX = cameraDistance * Math.sin(cameraPitch) * Math.sin(cameraYaw);
        const idealGlobalOffsetY = cameraDistance * Math.cos(cameraPitch);
        const idealGlobalOffsetZ = cameraDistance * Math.sin(cameraPitch) * Math.cos(cameraYaw);
        const idealCameraPosition = new THREE.Vector3(cameraLookAtTarget.x + idealGlobalOffsetX, cameraLookAtTarget.y + idealGlobalOffsetY, cameraLookAtTarget.z + idealGlobalOffsetZ);
        const rayStartPoint = cameraLookAtTarget.clone();
        const rayDirection = new THREE.Vector3().subVectors(idealCameraPosition, rayStartPoint).normalize();
        cameraRaycaster.set(rayStartPoint, rayDirection);
        cameraRaycaster.near = 0.1; cameraRaycaster.far = cameraDistance;
        let actualCollisionAdjustedDistance = cameraDistance;
        if (cameraCollidables.length > 0) {
            const intersections = cameraRaycaster.intersectObjects(cameraCollidables, false);
            if (intersections.length > 0) {
                actualCollisionAdjustedDistance = intersections[0].distance - CAMERA_COLLISION_BUFFER;
                actualCollisionAdjustedDistance = Math.max(MIN_CAMERA_DISTANCE, actualCollisionAdjustedDistance);
            }
        }
        camera.position.copy(rayStartPoint).addScaledVector(rayDirection, actualCollisionAdjustedDistance);
        camera.lookAt(cameraLookAtTarget);
    } else if ((player && !player.visible) || isEndScreenVisible) { 
       const arenaCenter = new THREE.Vector3(0, wallHeight / 4, 0); 
       camera.position.set(0, arenaSize * 0.6, arenaSize * 0.6); 
       camera.lookAt(arenaCenter);
    }

    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initial UI state setup
if(instructions) instructions.style.display = 'flex';
if(hud) hud.style.display = 'none';
if(gameFullMessageElem) gameFullMessageElem.style.display = 'none';
if(gameOverScreenElem) gameOverScreenElem.style.display = 'none';
if(winningScreenElem) winningScreenElem.style.display = 'none';