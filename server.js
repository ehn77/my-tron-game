// server.js
const WebSocket = require('ws');

// IMPORTANT: Use process.env.PORT for Render deployment
const PORT = process.env.PORT || 5173; // Use Render's PORT or a fallback for local development
const wss = new WebSocket.Server({ port: PORT });

console.log(`Barebones WebSocket server started on port ${PORT}...`);

const players = {}; // Stores state for connected players
let nextPlayerId = 0; // Simple ID assignment

const TICK_RATE = 30; // Updates per second
const PLAYER_SPEED_FACTOR = 1;
const GRAVITY = 0.012;
const JUMP_STRENGTH = 0.25;
const GROUND_Y = 0; // Y-position when on the ground

wss.on('connection', (wsClient) => {
  nextPlayerId++;
  const playerId = `Player ${nextPlayerId}`;
  console.log(`Client ${playerId} connected.`);

  // Initialize player state
  players[playerId] = {
    id: playerId,
    x: 0, y: GROUND_Y, z: 0,
    rotationY: 0,
    velocityY: 0,
    isJumping: false,
    keys: {},
    yaw: 0,
    pitch: 0,
  };

  // Send the new player their ID
  wsClient.send(JSON.stringify({
    type: 'assignId',
    id: playerId,
    initialDiscId: players[playerId].heldDiscId // Optional, if defined later
  }));

  // Handle messages from the client
  wsClient.on('message', (messageString) => {
    try {
      const message = JSON.parse(messageString);
      const playerState = players[playerId];
      if (!playerState) return;

      if (message.type === 'playerInput') {
        playerState.keys = message.keys;
        playerState.yaw = message.yaw;
        playerState.pitch = message.pitch;
      }

      // Handle other message types later (e.g. 'requestThrowDisc')
    } catch (error) {
      console.error(`Error processing message from ${playerId}:`, error);
    }
  });

  // Handle client disconnect
  wsClient.on('close', () => {
    console.log(`Client ${playerId} disconnected.`);
    delete players[playerId];
    broadcastPlayerLeft(playerId);
  });
});

// Inform all clients that a player has left
function broadcastPlayerLeft(leftPlayerId) {
  const message = JSON.stringify({ type: 'playerLeft', id: leftPlayerId });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Server-side game loop
function gameLoop() {
  for (const playerId in players) {
    const player = players[playerId];
    const input = player.keys;
    const yaw = player.yaw;

    // Calculate movement direction
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    let deltaX = 0;
    let deltaZ = 0;

    if (input.w) {
      deltaX += forwardX;
      deltaZ += forwardZ;
    }
    if (input.s) {
      deltaX -= forwardX;
      deltaZ -= forwardZ;
    }
    if (input.a) {
      deltaX -= rightX;
      deltaZ -= rightZ;
    }
    if (input.d) {
      deltaX += rightX;
      deltaZ += rightZ;
    }

    const moveMagnitude = Math.sqrt(deltaX ** 2 + deltaZ ** 2);
    if (moveMagnitude > 0) {
      player.x += (deltaX / moveMagnitude) * PLAYER_SPEED_FACTOR;
      player.z += (deltaZ / moveMagnitude) * PLAYER_SPEED_FACTOR;
    }

    // Jumping & gravity
    if (input.space && !player.isJumping && player.y <= GROUND_Y) {
      player.velocityY = JUMP_STRENGTH;
      player.isJumping = true;
    }

    if (player.isJumping || player.y > GROUND_Y) {
      player.velocityY -= GRAVITY;
      player.y += player.velocityY;

      if (player.y <= GROUND_Y) {
        player.y = GROUND_Y;
        player.isJumping = false;
        player.velocityY = 0;
      }
    }

    // Sync server-side rotation to match yaw
    player.rotationY = yaw + Math.PI;
  }

  // Send world state to clients
  const gameState = {
    type: 'worldUpdate',
    players: players
  };

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(gameState));
    }
  });
}

// Run the game loop
setInterval(gameLoop, 1000 / TICK_RATE);
