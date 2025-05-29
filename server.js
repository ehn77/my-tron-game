// server.js
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 5173 });
console.log('Barebones WebSocket server started on port 5173...');

const players = {}; // Stores state for connected players { playerId: {id, x,y,z, rotationY, velocityY, isJumping, keys, pitch, yaw} }
let nextPlayerId = 0; // Simple ID assignment

const TICK_RATE = 30; // Updates per second
const PLAYER_SPEED_FACTOR = 1; // Factor to apply to movement
const GRAVITY = 0.012;
const JUMP_STRENGTH = 0.25;
const GROUND_Y = 0; // Where player's center Y is when on ground

wss.on('connection', (wsClient) => {
    nextPlayerId++;
    const playerId = `Player ${nextPlayerId}`;
    console.log(`Client ${playerId} connected.`);

    // Initialize player state
    players[playerId] = {
        id: playerId,
        x: 0, y: GROUND_Y, z: 0, // Initial position
        rotationY: 0,          // Initial rotation (will be set by client's yaw)
        velocityY: 0,
        isJumping: false,
        keys: {},              // Last known keys from this player
        yaw: 0,                // Last known yaw
        pitch: 0,              // Last known pitch
        // Add other necessary states like animation, disc, etc. later
    };

    // Send the new player their ID
    wsClient.send(JSON.stringify({ type: 'assignId', id: playerId, initialDiscId: players[playerId].heldDiscId }));

    wsClient.on('message', (messageString) => {
        try {
            const message = JSON.parse(messageString);
            const playerState = players[playerId];

            if (!playerState) return;

            if (message.type === 'playerInput') {
                playerState.keys = message.keys;
                playerState.yaw = message.yaw;
                playerState.pitch = message.pitch;
                // We'll use these stored inputs in the gameLoop
            }
            // Later, handle 'requestThrowDisc' messages
        } catch (error) {
            console.error(`Error processing message from ${playerId}:`, error);
        }
    });

    wsClient.on('close', () => {
        console.log(`Client ${playerId} disconnected.`);
        delete players[playerId]; // Remove player on disconnect
        // Broadcast playerLeft message if needed (for other clients to remove the mesh)
        broadcastPlayerLeft(playerId);
    });
});

function broadcastPlayerLeft(leftPlayerId) {
    const message = JSON.stringify({ type: 'playerLeft', id: leftPlayerId });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Server-side Game Loop
function gameLoop() {
    // 1. Update player states based on their last known inputs
    for (const playerId in players) {
        const player = players[playerId];
        const input = player.keys;
        const playerServerYaw = player.yaw; // Use the yaw sent by client for orientation

        // Calculate movement direction (similar to client, but using server's playerYaw)
        const forwardX = -Math.sin(playerServerYaw);
        const forwardZ = -Math.cos(playerServerYaw);

        // This "right" is to the right of the camera's (and player's) looking direction
        const rightX = Math.cos(playerServerYaw);
        const rightZ = -Math.sin(playerServerYaw);

        let deltaX = 0;
        let deltaZ = 0;

        // --- CORRECTED Input Application ---
        if (input.w) { // Move Forward
            deltaX += forwardX;
            deltaZ += forwardZ;
        }
        if (input.s) { // Move Backward
            deltaX -= forwardX; // Subtract forward vector
            deltaZ -= forwardZ;
        }
        if (input.a) { // Strafe Left
            deltaX -= rightX;   // Subtract right vector to go left
            deltaZ -= rightZ;
        }
        if (input.d) { // Strafe Right
            deltaX += rightX;   // Add right vector to go right
            deltaZ += rightZ;
        }

        // Normalize diagonal movement (this part of your code was okay)
        const moveMagnitude = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
        if (moveMagnitude > 0) {
            player.x += (deltaX / moveMagnitude) * PLAYER_SPEED_FACTOR;
            player.z += (deltaZ / moveMagnitude) * PLAYER_SPEED_FACTOR;
        }

        // Server-side Jump Logic
        if (input.space && !player.isJumping && player.y <= GROUND_Y) {
            player.velocityY = JUMP_STRENGTH;
            player.isJumping = true;
        }
        if (player.isJumping || player.y > GROUND_Y) { // Apply gravity if jumping or above ground
            player.velocityY -= GRAVITY;
            player.y += player.velocityY;
            if (player.y <= GROUND_Y) {
                player.y = GROUND_Y;
                player.isJumping = false;
                player.velocityY = 0;
            }
        }
        // Server dictates player's model rotation based on their view yaw
        player.rotationY = playerServerYaw + Math.PI;
    }

    // 2. Prepare game state to send to clients
    const gameState = {
        type: 'worldUpdate',
        players: players, // Send the whole players object
        // discs: {} // Add disc states later
    };

    // 3. Broadcast game state to all clients
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(gameState));
        }
    });
}

setInterval(gameLoop, 1000 / TICK_RATE);