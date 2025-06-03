import * as THREE from 'https://unpkg.com/three@0.176.0/build/three.module.js';

// --- WebSocket Server Connection ---
const socket = new WebSocket('wss://my-tron-game.onrender.com');

socket.onopen = () => {
    console.log('Successfully connected to the game server!');
};
socket.onclose = () => {
    console.log('Disconnected from the game server.');
};
socket.onerror = (error) => {
    console.error('WebSocket Error:', error);
};

// --- Core Three.js Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);
const clock = new THREE.Clock();
const textureLoader = new THREE.TextureLoader();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 15, 5);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
scene.add(directionalLight);

// --- Global Variables for Camera Control ---
let cameraYaw = 0;
let cameraPitch = Math.PI / 4;
const mouseSensitivity = 0.002;
const cameraDistance = 7;

// --- Player Textures & Materials ---
const frontTexture = textureLoader.load('public/imgs/tron_guy.png');
const backTexture = textureLoader.load('public/imgs/tron_guy_back.png'); // Idle back
const leftStepTexture = textureLoader.load('public/imgs/left_step.png');
const rightStepTexture = textureLoader.load('public/imgs/right_step.png');
const leftTexture = textureLoader.load('public/imgs/move_left.png');
const rightTexture = textureLoader.load('public/imgs/move_right.png');
const frontRightTexture = textureLoader.load('public/imgs/front_right_step.png');
const frontLeftTexture = textureLoader.load('public/imgs/front_left_step.png');

const frontMaterial = new THREE.MeshBasicMaterial({ map: frontTexture, transparent: true });
const backMaterial = new THREE.MeshBasicMaterial({ map: backTexture, transparent: true });

// --- Player Setup (Local Player) ---
const playerGeometry = new THREE.PlaneGeometry(2, 2);
const frontPlane = new THREE.Mesh(playerGeometry, frontMaterial);
const backPlane = new THREE.Mesh(playerGeometry, backMaterial);
backPlane.rotation.y = Math.PI;
const player = new THREE.Object3D(); // This is YOUR player object
player.add(frontPlane);
player.add(backPlane);
player.position.y = 0;
player.castShadow = true;
frontPlane.castShadow = true;
backPlane.castShadow = true;
scene.add(player);

// --- Player State (mostly managed by server now) ---
const groundLevel = 0;
let isJumping = false; // Will be updated by server

// --- Animation Variables (For local player's immediate visual feedback) ---
const stepDuration = 0.3;
let walkAnimationTimer = 0;
let isLeftStep = true;

// --- Ground Setup ---
const groundGeometry = new THREE.PlaneGeometry(20, 20);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x808080, side: THREE.DoubleSide, roughness: 0.9 });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1;
ground.receiveShadow = true;
scene.add(ground);

// --- Disc Setup (Visual only initially, state managed by server) ---
const discGeometry = new THREE.CircleGeometry(0.25, 20);
const discMaterial = new THREE.MeshBasicMaterial({ color: 0x0BFEEE, side: THREE.DoubleSide }); // Fixed color
const disc = new THREE.Mesh(discGeometry, discMaterial); // This is the local player's disc model
disc.rotation.y = -1;
disc.rotation.x = -0.5;
disc.castShadow = true;
player.add(disc); // Starts attached to the local player
disc.position.set(-0.3, -0.2, 0.06); // Adjusted Z for potential BoxPlayer later, or just good offset
let localPlayerDiscId = null; // Will be set by server
let discState = 'held'; // Local player's disc state, primarily updated by server

// --- Multiplayer State Variables ---
let localPlayerId = null;
const otherPlayers = {};  // { playerId: { mesh, frontMaterial, backMaterial } }
const allDiscs = {};      // { discId: threeJsMesh } - Stores ALL disc meshes client knows about

// --- Keyboard Input ---
const keysPressed = {};
document.addEventListener('keydown', (event) => { keysPressed[event.key.toLowerCase()] = true; });
document.addEventListener('keyup', (event) => { keysPressed[event.key.toLowerCase()] = false; });

// --- Pointer Lock and Mouse Move Setup ---
const instructions = document.getElementById('instructions');
function onMouseMove(event) {
    cameraYaw -= event.movementX * mouseSensitivity;
    cameraPitch -= event.movementY * mouseSensitivity;
    cameraPitch = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPitch));
}
if (instructions) {
    instructions.addEventListener('click', () => renderer.domElement.requestPointerLock());
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === renderer.domElement) {
            instructions.style.display = 'none';
            document.addEventListener('mousemove', onMouseMove, false);
        } else {
            instructions.style.display = 'block';
            document.removeEventListener('mousemove', onMouseMove, false);
        }
    }, false);
    document.addEventListener('pointerlockerror', (error) => console.error('Pointer Lock Error:', error));
} else {
    console.warn("Element with ID 'instructions' not found.");
    renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === renderer.domElement) {
            document.addEventListener('mousemove', onMouseMove, false);
        } else {
            document.removeEventListener('mousemove', onMouseMove, false);
        }
    }, false);
}

// --- Helper Function to Create Models for Other Players ---
function createOtherPlayerModel() {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const opFrontMaterial = new THREE.MeshBasicMaterial({ map: frontTexture, transparent: true });
    const opBackMaterial = new THREE.MeshBasicMaterial({ map: backTexture, transparent: true }); // Start with idle back
    const opFrontPlane = new THREE.Mesh(geometry, opFrontMaterial);
    const opBackPlane = new THREE.Mesh(geometry, opBackMaterial);
    opBackPlane.rotation.y = Math.PI;
    opFrontPlane.castShadow = true;
    opBackPlane.castShadow = true;
    const otherPlayerObject = new THREE.Object3D();
    otherPlayerObject.add(opFrontPlane);
    otherPlayerObject.add(opBackPlane);
    otherPlayerObject.castShadow = true;
    return { mesh: otherPlayerObject, frontMaterial: opFrontMaterial, backMaterial: opBackMaterial };
}

// --- Network Message Handling ---
socket.onmessage = (event) => {
    try {
        const message = JSON.parse(event.data);

        if (message.type === 'assignId') {
            localPlayerId = message.id;
            localPlayerDiscId = message.initialDiscId; // Server should send ID of player's initial disc
            if (localPlayerDiscId) {
                allDiscs[localPlayerDiscId] = disc; // Register local player's disc with its server ID
            }
            console.log('My Player ID:', localPlayerId, 'My Disc ID:', localPlayerDiscId);
        } else if (message.type === 'worldUpdate') {
            const serverPlayers = message.players || {};
            const serverDiscs = message.discs || {};
            const receivedPlayerIds = new Set();
            const receivedDiscIds = new Set();

            // --- Update Players ---
            for (const playerId in serverPlayers) {
                receivedPlayerIds.add(playerId);
                const playerData = serverPlayers[playerId];

                if (playerId === localPlayerId) {
                    player.position.set(playerData.x, playerData.y, playerData.z);
                    player.rotation.y = playerData.rotationY;
                    isJumping = playerData.isJumping || false;
                    // Local player's discState also needs to be updated if they are holding a disc
                    if (playerData.heldDiscId && playerData.heldDiscId === localPlayerDiscId) {
                        discState = 'held';
                    } else if (!playerData.heldDiscId && discState === 'held' && localPlayerDiscId) {
                        // Implies local player threw their disc, but server will handle actual detaching via disc updates
                    }

                } else {
                    if (!otherPlayers[playerId]) {
                        console.log('New player joined:', playerId);
                        const newPlayerModel = createOtherPlayerModel();
                        scene.add(newPlayerModel.mesh);
                        otherPlayers[playerId] = newPlayerModel;
                    }
                    otherPlayers[playerId].mesh.position.set(playerData.x, playerData.y, playerData.z);
                    otherPlayers[playerId].mesh.rotation.y = playerData.rotationY;

                    if (playerData.animation && otherPlayers[playerId].backMaterial) {
                        switch (playerData.animation.currentMap) {
                            case 'leftStep': otherPlayers[playerId].backMaterial.map = leftStepTexture; break;
                            case 'rightStep': otherPlayers[playerId].backMaterial.map = rightStepTexture; break;
                            case 'leftStrafe': otherPlayers[playerId].backMaterial.map = leftTexture; break;
                            case 'rightStrafe': otherPlayers[playerId].backMaterial.map = rightTexture; break;
                            case 'backStepLeft': otherPlayers[playerId].backMaterial.map = frontLeftTexture; break;
                            case 'backStepRight': otherPlayers[playerId].backMaterial.map = frontRightTexture; break;
                            default: otherPlayers[playerId].backMaterial.map = backTexture;
                        }
                    }
                }
            }
            // Handle Disconnected Players
            for (const existingPlayerId in otherPlayers) {
                if (!receivedPlayerIds.has(existingPlayerId)) {
                    console.log('Player left:', existingPlayerId);
                    if (otherPlayers[existingPlayerId].mesh) scene.remove(otherPlayers[existingPlayerId].mesh);
                    delete otherPlayers[existingPlayerId];
                }
            }

            // --- Update Discs (Comprehensive) ---
            for (const discId in serverDiscs) {
                receivedDiscIds.add(discId);
                const discData = serverDiscs[discId];
                let discMesh = allDiscs[discId];

                if (!discMesh) { // Disc is new to this client (could be another player's disc)
                    console.log('Creating new visual for disc:', discId);
                    discMesh = new THREE.Mesh(discGeometry, discMaterial); // Use shared geometry/material
                    discMesh.castShadow = true;
                    allDiscs[discId] = discMesh;
                    // Parenting is handled below
                }

                if (discData.ownerId) { // Disc is HELD by a player
                    const ownerPlayerObject = (discData.ownerId === localPlayerId) ? player : (otherPlayers[discData.ownerId] ? otherPlayers[discData.ownerId].mesh : null);
                    if (ownerPlayerObject) {
                        if (discMesh.parent !== ownerPlayerObject) {
                            if (discMesh.parent) discMesh.parent.remove(discMesh); // Remove from scene or old parent
                            ownerPlayerObject.add(discMesh);
                        }
                        discMesh.position.set(-0.3, -0.2, 0.06); // Reset local "held" position
                        discMesh.rotation.set(-0.5, -1, 0);   // Reset local "held" rotation

                        if (discData.ownerId === localPlayerId) {
                            discState = 'held'; // Local player is holding this disc
                        }
                    } else { // Owner not found on client, disc is effectively in limbo (should ideally be in scene)
                        if (discMesh.parent) discMesh.parent.remove(discMesh);
                        scene.add(discMesh); // Add to scene, position it based on world data
                        discMesh.position.set(discData.x, discData.y, discData.z);
                        discMesh.rotation.set(discData.rotX, discData.rotY, discData.rotZ);
                    }
                } else { // Disc is IN THE WORLD (state: 'throwing' or 'returning')
                    if (discMesh.parent !== scene) {
                        if (discMesh.parent) discMesh.parent.remove(discMesh); // Detach from any player
                        scene.add(discMesh);
                    }
                    discMesh.position.set(discData.x, discData.y, discData.z);
                    discMesh.rotation.set(discData.rotX, discData.rotY, discData.rotZ); // Or use quaternion from server
                }
            }

            // Cleanup disc meshes that are no longer in the server state
            for (const existingDiscId in allDiscs) {
                if (!receivedDiscIds.has(existingDiscId)) {
                    console.log('Removing disc no longer in server state:', existingDiscId);
                    if (allDiscs[existingDiscId].parent) {
                        allDiscs[existingDiscId].parent.remove(allDiscs[existingDiscId]);
                    }
                    // TODO: Dispose geometry/material if uniquely created
                    delete allDiscs[existingDiscId];
                }
            }

        } else if (message.type === 'playerLeft') {
            const leftPlayerId = message.id;
            if (otherPlayers[leftPlayerId] && otherPlayers[leftPlayerId].mesh) {
                console.log('Player left (notified by server):', leftPlayerId);
                scene.remove(otherPlayers[leftPlayerId].mesh);
                delete otherPlayers[leftPlayerId];
            }
        }
    } catch (error) {
        console.error('Error processing message from server:', event.data, error);
    }
};


// --- Animation Loop ---
function animate() {
    const deltaTime = clock.getDelta();

    // --- Send Input to Server ---
    if (socket && socket.readyState === WebSocket.OPEN) {
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

    // --- Disc Throw Request (Client initiates based on input) ---
    if (keysPressed['q'] && discState === 'held' && localPlayerId && localPlayerDiscId && socket.readyState === WebSocket.OPEN) {
        const throwOrigin = new THREE.Vector3();
        const throwDirection = new THREE.Vector3();

        player.getWorldPosition(throwOrigin); // Get player's current world position
        throwOrigin.y += 0.2; // Adjust starting height (e.g., from shoulder)

        camera.getWorldDirection(throwDirection); // Get camera's looking direction

        // Offset the actual disc origin slightly in front of the player along the throw direction
        throwOrigin.add(throwDirection.clone().multiplyScalar(0.5));

        socket.send(JSON.stringify({
            type: 'requestThrowDisc',
            discId: localPlayerDiscId, // Send the ID of the disc being thrown
            throwData: {
                origin: { x: throwOrigin.x, y: throwOrigin.y, z: throwOrigin.z },
                direction: { x: throwDirection.x, y: throwDirection.y, z: throwDirection.z }
            }
        }));
        discState = 'requestingThrow'; // Prevent spamming Q, server will confirm actual throw
    }


    // --- Local Player Animation Logic (for immediate visual feedback) ---
    walkAnimationTimer += deltaTime;
    let currentLocalAnimMap = backTexture;
    if (keysPressed['a']) { currentLocalAnimMap = leftTexture; walkAnimationTimer = 0; isLeftStep = true; }
    else if (keysPressed['d']) { currentLocalAnimMap = rightTexture; walkAnimationTimer = 0; isLeftStep = true; }
    else if (keysPressed['w']) {
        if (walkAnimationTimer > stepDuration) { walkAnimationTimer = 0; isLeftStep = !isLeftStep; }
        currentLocalAnimMap = isLeftStep ? leftStepTexture : rightStepTexture;
    } else if (keysPressed['s']) {
        if (walkAnimationTimer > stepDuration) { walkAnimationTimer = 0; isLeftStep = !isLeftStep; }
        currentLocalAnimMap = isLeftStep ? frontRightTexture : frontLeftTexture;
    }
    if (backMaterial.map !== currentLocalAnimMap) {
        backMaterial.map = currentLocalAnimMap;
    }

    // CLIENT-SIDE PHYSICS AND DIRECT MOVEMENT ARE REMOVED
    // JUMP LOGIC IS REMOVED (server handles Y position and isJumping state)
    // DISC FLIGHT/RETURN/CATCH LOGIC IS REMOVED (server handles positions and states)

    // --- Camera Logic ---
    const offsetX = cameraDistance * Math.sin(cameraPitch) * Math.sin(cameraYaw);
    const offsetY = cameraDistance * Math.cos(cameraPitch);
    const offsetZ = cameraDistance * Math.sin(cameraPitch) * Math.cos(cameraYaw);
    if (player) { // Ensure player object exists (it should, once ID is assigned)
        camera.position.x = player.position.x + offsetX;
        camera.position.y = player.position.y + offsetY;
        camera.position.z = player.position.z + offsetZ;
        camera.lookAt(player.position);
    }

    // Player model rotation is now set by server in onmessage for player.rotation.y

    // --- Render ---
    renderer.render(scene, camera);
}

// --- Start Animation Loop ---
renderer.setAnimationLoop(animate);

// --- Handle Window Resize ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});