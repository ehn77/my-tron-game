import * as THREE from 'three';

// --- Core Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111); // Dark grey background
const clock = new THREE.Clock();
const textureLoader = new THREE.TextureLoader();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true }); // Enable antialiasing
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- Lighting (Optional but good) ---
const ambientLight = new THREE.AmbientLight(0x404040); // Soft white light
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
directionalLight.position.set(1, 1, 1);
scene.add(directionalLight);

// --- Global Variables for Camera Control ---
let cameraYaw = 0;
let cameraPitch = Math.PI / 4; // Initial upward tilt (45 degrees)
const mouseSensitivity = 0.002;
const cameraDistance = 7;

// --- Player and Physics Variables ---
const frontTexture = textureLoader.load('imgs/tron_guy.png');
const backTexture = textureLoader.load('imgs/tron_guy_back.png');

const frontMaterial = new THREE.MeshBasicMaterial({
    map: frontTexture,
    transparent: true,
});

const backMaterial = new THREE.MeshBasicMaterial({
    map: backTexture,
    transparent: true,
});
const playerGeometry = new THREE.PlaneGeometry(2, 2);
const frontPlane = new THREE.Mesh(playerGeometry, frontMaterial);
const backPlane = new THREE.Mesh(playerGeometry, backMaterial);
const leftStepTexture = textureLoader.load('imgs/left_step.png');   // Left step image
const rightStepTexture = textureLoader.load('imgs/right_step.png');  // Right step image
const leftTexture = textureLoader.load('imgs/move_left.png');
const rightTexture = textureLoader.load('imgs/move_right.png');
const frontRightTexture = textureLoader.load('imgs/front_right_step.png');
const frontLeftTexture = textureLoader.load('imgs/front_left_step.png');

backPlane.rotation.y = Math.PI;
const player = new THREE.Object3D();
player.add(frontPlane);
player.add(backPlane);
player.position.y = 0; // Player's center at y=-0.5, so base is at y=-1
scene.add(player);

let playerVelocityY = 0;
const gravity = 0.003;
const jumpStrength = 0.1;
const groundLevel = 0; // Y position where player stands
let isJumping = false;

// --- Animation Variables (Add these!) ---
const stepDuration = 0.3; // Time (in seconds) for each step (adjust this speed)
let walkAnimationTimer = 0;
let isLeftStep = true; // Start with one step

// --- Ground Setup ---
const groundGeometry = new THREE.PlaneGeometry(20, 20); // Made it larger
const groundMaterial = new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.DoubleSide });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2; // Rotate flat
ground.position.y = -1;           // Place it below the player's base
scene.add(ground);

// --- Disc Setup ---
const discGeometry = new THREE.CircleGeometry(0.25, 20);
const discMaterial = new THREE.MeshBasicMaterial({ color: '#0BFEEE', side: THREE.DoubleSide});
const disc = new THREE.Mesh(discGeometry, discMaterial);
disc.rotation.y = -1;
disc.rotation.x = -0.5;
player.add(disc);
disc.position.set(-0.3, -0.2, 0);
let discState = 'held';
const discThrowSpeed = 0.35;
const discSpinSpeed = 0.5;
const maxThrowDistance = 30;


let discThrowDirection  = new THREE.Vector3();
let discThrowOrigin = new THREE.Vector3();

// --- Keyboard Input ---
const keysPressed = {};
document.addEventListener('keydown', (event) => {
    keysPressed[event.key.toLowerCase()] = true;
});
document.addEventListener('keyup', (event) => {
    keysPressed[event.key.toLowerCase()] = false;
});

// --- Pointer Lock and Mouse Move Setup ---
const instructions = document.getElementById('instructions');

function onMouseMove(event) {
    cameraYaw -= event.movementX * mouseSensitivity;
    cameraPitch -= event.movementY * mouseSensitivity;
    // Clamp the pitch (vertical look) to prevent flipping
    cameraPitch = Math.max(0.1, Math.min(Math.PI - 0.1, cameraPitch));
}

if (instructions) {
    document.addEventListener('click', () => {
        renderer.domElement.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === renderer.domElement) {
            instructions.style.display = 'none';
            document.addEventListener('mousemove', onMouseMove, false);
        } else {
            instructions.style.display = 'block';
            document.removeEventListener('mousemove', onMouseMove, false);
        }
    }, false);

    document.addEventListener('pointerlockerror', (error) => {
        console.error('Pointer Lock Error:', error);
        instructions.textContent = 'Pointer Lock Failed!';
    }, false);
} else {
    console.warn("Element with ID 'instructions' not found. Pointer lock UI may not work.");
     renderer.domElement.addEventListener('click', () => { // Fallback
        renderer.domElement.requestPointerLock();
    });
     document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === renderer.domElement) {
            document.addEventListener('mousemove', onMouseMove, false);
        } else {
            document.removeEventListener('mousemove', onMouseMove, false);
        }
    }, false);
}


// --- Animation Loop ---
function animate() {
    const moveSpeed = 0.05;
    const deltaTime = clock.getDelta();

    // --- Player Movement (Relative to Camera) ---
    const forwardX = -Math.sin(cameraYaw);
    const forwardZ = -Math.cos(cameraYaw);
    const rightX = Math.cos(cameraYaw);
    const rightZ = -Math.sin(cameraYaw);

    let moveX = 0;
    let moveZ = 0;

    if (keysPressed['w']) { moveX += forwardX; moveZ += forwardZ; }
    if (keysPressed['s']) { moveX -= forwardX; moveZ -= forwardZ; }
    if (keysPressed['a']) { moveX -= rightX; moveZ -= rightZ; }
    if (keysPressed['d']) { moveX += rightX; moveZ += rightZ; }

    let isMovingForward = keysPressed['w'];
    let isMovingLeft = keysPressed['a'];
    let isMovingRight = keysPressed['d'];
    let isMovingBackward = keysPressed['s'];

    walkAnimationTimer += deltaTime;
    
    if (isMovingLeft) {

        backMaterial.map = leftTexture;

    } else if (isMovingRight) {

        backMaterial.map = rightTexture;

    } else if (isMovingForward) {
        if (walkAnimationTimer > stepDuration)  {
            walkAnimationTimer = 0;
            isLeftStep = !isLeftStep;

            if (isLeftStep) {
                backMaterial.map = leftStepTexture;
            } else {
                backMaterial.map = rightStepTexture;
            }
        }
    } else if (isMovingBackward) {
        if (walkAnimationTimer > stepDuration) {
            walkAnimationTimer = 0;
            isLeftStep = !isLeftStep;

            if (isLeftStep) {
                backMaterial.map = frontRightTexture;
            } else {
                backMaterial.map = frontLeftTexture;
            }
        }
    } else {
        // If NOT moving forward, show the idle texture (if it's not already shown)
        if (backMaterial.map !== backTexture) {
            backMaterial.map = backTexture;
            isLeftStep = true; // Reset step for next time
            walkAnimationTimer = 0; // Reset timer
        }
    }

    const moveVector = new THREE.Vector2(moveX, moveZ);
    if (moveVector.length() > 0) {
        moveVector.normalize();
        player.position.x += moveVector.x * moveSpeed;
        player.position.z += moveVector.y * moveSpeed;
    }

    // --- Jump Logic ---
    if ((keysPressed[' '] || keysPressed['space']) && !isJumping && player.position.y <= groundLevel) {
        playerVelocityY = jumpStrength;
        isJumping = true;
    }
    if (isJumping || player.position.y > groundLevel) {
        isJumping = true;
        playerVelocityY -= gravity;
        player.position.y += playerVelocityY;
    }
    if (player.position.y <= groundLevel) {
        player.position.y = groundLevel;
        playerVelocityY = 0;
        isJumping = false;
    }

     // --- Disc Throw Trigger (Add 'q' key check!) ---
    if (keysPressed['q'] && discState === 'held') {
        discState = 'throwing';

        // Store the starting position in world coordinates
        camera.getWorldPosition(discThrowOrigin);
        // Get the player's forward direction in world coordinates
        camera.getWorldDirection(discThrowDirection);

        // Get disc's current world position & rotation before detaching
        disc.getWorldPosition(disc.position);
        disc.getWorldQuaternion(disc.quaternion);

        // Detach from player and add to scene
        player.remove(disc);
        scene.add(disc);
    }
    
        // --- Disc Flight Logic ---
    if (discState === 'throwing') {
        // Move forward
        disc.position.add(discThrowDirection.clone().multiplyScalar(discThrowSpeed));
        // Spin (around its local Y axis - which is world Z if not rotated, but should work)
        disc.rotation.x += discSpinSpeed; // Adjust axis if needed (e.g., disc.rotation.z)

        // Check if it reached max distance
        if (disc.position.distanceTo(discThrowOrigin) > maxThrowDistance) {
            discState = 'returning';
        }
    } else if (discState === 'returning') {
        // Calculate direction back to player
        let returnDirection = player.position.clone().sub(disc.position).normalize();
        // Move towards player
        disc.position.add(returnDirection.clone().multiplyScalar(discThrowSpeed));
        // Keep spinning
        disc.rotation.x += discSpinSpeed;

        // Check if it's close enough to catch
        if (disc.position.distanceTo(player.position) < 0.6) { // Threshold for catching
            discState = 'held';
            scene.remove(disc);
            player.add(disc);
            // Reset local position and rotation
            disc.position.set(-0.3, -0.2, 0);
            disc.rotation.set(-0.5, -1, 0); // Use the stored original rotation
        }
    }

    if (discState === 'throwing') {
        if (disc.position.y <= ground.position.y + 0.1) {
            discThrowDirection.y = -discThrowDirection.y * 0.8;
            disc.position.y = ground.position.y + 0.1;
        }
    }


    // --- Mouse-based Camera Orbit Logic ---
    const offsetX = cameraDistance * Math.sin(cameraPitch) * Math.sin(cameraYaw);
    const offsetY = cameraDistance * Math.cos(cameraPitch);
    const offsetZ = cameraDistance * Math.sin(cameraPitch) * Math.cos(cameraYaw);

    camera.position.x = player.position.x + offsetX;
    camera.position.y = player.position.y + offsetY;
    camera.position.z = player.position.z + offsetZ;

    camera.lookAt(player.position);

    // --- Player Rotation ---
    player.rotation.y = cameraYaw + Math.PI;

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