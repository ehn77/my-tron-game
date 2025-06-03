// server.js
const WebSocket = require('ws');
const http = require('http'); // <--- IMPORTANT: IMPORT THE HTTP MODULE

// IMPORTANT: Use process.env.PORT for Render deployment
// Render injects the port your application should listen on via the PORT environment variable.
// Your server MUST use this variable to bind correctly.
const PORT = process.env.PORT || 5173; // Use Render's PORT or a fallback for local development

// 1. Create a simple HTTP server
// This server will handle the initial HTTP request and the WebSocket upgrade handshake.
// It doesn't need to serve your client files, as your Static Site on Render handles that.
const server = http.createServer((req, res) => {
    // This response is for regular HTTP/HTTPS requests to your server's URL.
    // It will not be seen by WebSocket clients.
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket server is running. Connect via WebSocket client.');
});

// 2. Attach the WebSocket server to the HTTP server
// This is how the 'ws' library knows to handle WebSocket upgrade requests
// that come through the HTTP server.
const wss = new WebSocket.Server({ server: server }); // <--- ATTACH TO THE HTTP SERVER

// 3. Start the HTTP server listening on the assigned port
// This is the actual entry point for your server to start accepting connections.
server.listen(PORT, () => {
    console.log(`HTTP server and WebSocket server started on port ${PORT}...`);
});

const players = {};
const discs = {};
let nextPlayerId = 0;
let nextDiscId = 0;

// Game Constants
const TICK_RATE = 30;
const PLAYER_SPEED_FACTOR = 1;
const GRAVITY = 0.012;
const JUMP_STRENGTH = 0.25;
const GROUND_Y = 0;

const DISC_SPEED = 15;
const DISC_RETURN_SPEED = 18;
const DISC_GRAVITY = 0.010;
const ARENA_SIZE = 20;
const WALL_HEIGHT = 10;
const DISC_RADIUS = 0.25;
const MAX_THROW_DISTANCE = 25;
const CATCH_RADIUS = 1.0;

const MAX_PLAYERS = 2;
const INITIAL_PLAYER_HEALTH = 100;
const DISC_DAMAGE = 25;
const PLAYER_HIT_RADIUS = 0.5; // Approx player model radius for collision
const RESPAWN_DELAY = 5000; // 5 seconds
const GAME_OVER_DISPLAY_DURATION = 10000; // 10 seconds to show winner

let gameStatus = 'waiting'; // 'waiting', 'active', 'gameOver'
let winnerId = null;
let gameResetTimeout = null;


wss.on('connection', (wsClient) => {
    if (Object.keys(players).length >= MAX_PLAYERS && gameStatus !== 'waiting') { // Allow join if game is over and resetting
        const currentPlayersArray = Object.values(players);
        if (currentPlayersArray.length >= MAX_PLAYERS && !currentPlayersArray.some(p => !p.isActive)) { // isActive could be a better flag than !isDefeated for lobby
             console.log('Max players reached. Connection rejected.');
             wsClient.send(JSON.stringify({ type: 'gameFull' }));
             wsClient.terminate();
             return;
        }
    }


    nextPlayerId++; // This could lead to non-unique IDs if players leave and IDs are not reused carefully.
                    // For a simple 2-player game, it's less of an issue if server restarts often.
                    // A better ID system would be UUIDs or careful reuse.
    const playerId = `Player${nextPlayerId}`; // Using a simpler ID for now
    nextDiscId++;
    const discId = `Disc${nextDiscId}`;
    console.log(`Client ${playerId} connected, assigned Disc ${discId}.`);

    players[playerId] = {
        id: playerId, x: (Math.random() - 0.5) * (ARENA_SIZE - 4), y: GROUND_Y, z: (Math.random() - 0.5) * (ARENA_SIZE - 4),
        rotationY: 0, velocityY: 0, isJumping: false, keys: {}, yaw: 0, pitch: 0,
        heldDiscId: discId,
        health: INITIAL_PLAYER_HEALTH,
        maxHealth: INITIAL_PLAYER_HEALTH,
        isDefeated: false,
        defeatTimestamp: 0,
        score: 0,
        isActive: true, // Player is actively in the game session
    };

    discs[discId] = {
        id: discId, ownerId: playerId, state: 'held',
        x: 0, y: 0, z: 0, velX: 0, velY: 0, velZ: 0,
        rotX: 0, rotY: 0, rotZ: 0,
        throwOriginX: 0, throwOriginY: 0, throwOriginZ: 0,
        distanceTraveled: 0,
        returnToPlayerId: playerId,
    };

    wsClient.send(JSON.stringify({ type: 'assignId', id: playerId, initialDiscId: discId }));

    if (Object.keys(players).length === MAX_PLAYERS && gameStatus === 'waiting') {
        startGame();
    }


    wsClient.on('message', (messageString) => {
        try {
            const message = JSON.parse(messageString);
            const playerState = players[playerId];
            if (!playerState || !playerState.isActive) return; // Ignore input from inactive/disconnected players

            if (message.type === 'playerInput') {
                if (playerState.isDefeated && gameStatus === 'active') return; // No input if defeated during active game

                playerState.keys = message.keys;
                playerState.yaw = message.yaw;
                playerState.pitch = message.pitch;
            } else if (message.type === 'requestThrowDisc') {
                if (playerState.isDefeated && gameStatus === 'active') return; // Cannot throw if defeated

                const discIdToThrow = message.discId;
                const throwData = message.throwData;

                if (playerState.heldDiscId === discIdToThrow && discs[discIdToThrow]) {
                    const disc = discs[discIdToThrow];
                    if (disc.ownerId === playerId && disc.state === 'held') {
                        disc.state = 'thrown';
                        disc.ownerId = null;
                        disc.x = throwData.origin.x; disc.y = throwData.origin.y; disc.z = throwData.origin.z;
                        disc.throwOriginX = disc.x; disc.throwOriginY = disc.y; disc.throwOriginZ = disc.z;
                        disc.distanceTraveled = 0;
                        disc.velX = throwData.direction.x * DISC_SPEED;
                        disc.velY = throwData.direction.y * DISC_SPEED;
                        disc.velZ = throwData.direction.z * DISC_SPEED;
                        playerState.heldDiscId = null;
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing message from ${playerId}:`, error, messageString);
        }
    });

    wsClient.on('close', () => {
        console.log(`Client ${playerId} disconnected.`);
        const disconnectingPlayer = players[playerId];
        if (disconnectingPlayer) {
            if (disconnectingPlayer.heldDiscId) {
                const discIdToRemove = disconnectingPlayer.heldDiscId;
                if (discs[discIdToRemove]) delete discs[discIdToRemove];
            }
            // Remove discs thrown by this player that are free-floating
            for (const dId in discs) {
                if (discs[dId].returnToPlayerId === playerId && discs[dId].ownerId === null) {
                    delete discs[dId];
                }
            }
            delete players[playerId]; // Remove player on disconnect
            broadcastPlayerLeft(playerId);

            // If a player leaves, game might go back to waiting
            if (Object.keys(players).length < MAX_PLAYERS && gameStatus === 'active') {
                console.log("A player left, game returning to waiting state.");
                gameStatus = 'waiting';
                winnerId = null;
                if (gameResetTimeout) clearTimeout(gameResetTimeout);
                 // Other players might need stats reset or notified
                for(const pId in players) {
                    players[pId].score = 0; // Reset scores
                    players[pId].health = INITIAL_PLAYER_HEALTH;
                    players[pId].isDefeated = false;
                }
            } else if (Object.keys(players).length === 0) {
                console.log("All players left. Server is idle.");
                gameStatus = 'waiting'; // Reset game state
                winnerId = null;
                if (gameResetTimeout) clearTimeout(gameResetTimeout);
            }
        }
    });
});

function broadcastPlayerLeft(leftPlayerId) {
    const message = JSON.stringify({ type: 'playerLeft', id: leftPlayerId });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(message);
    });
}

function startGame() {
    console.log("Max players reached. Starting game!");
    gameStatus = 'active';
    winnerId = null;
    for (const playerId in players) {
        players[playerId].health = INITIAL_PLAYER_HEALTH;
        players[playerId].isDefeated = false;
        players[playerId].score = 0;
        players[playerId].x = (Math.random() - 0.5) * (ARENA_SIZE * 0.8); // Spawn within 80% of arena
        players[playerId].z = (Math.random() - 0.5) * (ARENA_SIZE * 0.8);
        players[playerId].y = GROUND_Y;

        // Ensure player has their disc back if they somehow lost it before game start
        let foundDisc = false;
        for(const dId in discs) {
            if(discs[dId].returnToPlayerId === playerId) {
                players[playerId].heldDiscId = dId;
                discs[dId].ownerId = playerId;
                discs[dId].state = 'held';
                foundDisc = true;
                break;
            }
        }
        if (!foundDisc) { // Should not happen if logic is correct, but as a fallback
            nextDiscId++;
            const newDiscId = `Disc${nextDiscId}`;
            players[playerId].heldDiscId = newDiscId;
            discs[newDiscId] = {
                id: newDiscId, ownerId: playerId, state: 'held',
                x:0,y:0,z:0,velX:0,velY:0,velZ:0,rotX:0,rotY:0,rotZ:0,
                throwOriginX:0,throwOriginY:0,throwOriginZ:0,distanceTraveled:0,
                returnToPlayerId: playerId
            };
        }
    }
}


function gameLoop() {
    const tickInterval = 1 / TICK_RATE;

    if (gameStatus === 'waiting' && Object.keys(players).length === MAX_PLAYERS) {
        startGame();
    }

    // Player Updates
    for (const playerId in players) {
        const player = players[playerId];
        if (!player.isActive) continue;

        if (player.isDefeated && gameStatus === 'active') {
            if (Date.now() - player.defeatTimestamp > RESPAWN_DELAY) {
                // Check if game is over before respawning
                const alivePlayersCount = Object.values(players).filter(p => p.isActive && !p.isDefeated).length;
                if (alivePlayersCount < MAX_PLAYERS && Object.keys(players).length === MAX_PLAYERS) { // Only respawn if game is ongoing
                    console.log(`Respawning player ${playerId}`);
                    player.isDefeated = false;
                    player.health = INITIAL_PLAYER_HEALTH;
                    player.x = (Math.random() - 0.5) * (ARENA_SIZE * 0.8);
                    player.z = (Math.random() - 0.5) * (ARENA_SIZE * 0.8);
                    player.y = GROUND_Y;
                    player.velocityY = 0;
                    player.isJumping = false;
                     // Ensure player gets their disc back (it should be returning or held)
                    if (!player.heldDiscId) {
                        for(const dId in discs) {
                            if(discs[dId].returnToPlayerId === playerId) {
                                player.heldDiscId = dId;
                                discs[dId].ownerId = playerId;
                                discs[dId].state = 'held';
                                break;
                            }
                        }
                    }
                }
            }
            continue; // No movement or actions if defeated and waiting for respawn
        }


        const input = player.keys;
        const playerServerYaw = player.yaw;
        const forwardX = -Math.sin(playerServerYaw);
        const forwardZ = -Math.cos(playerServerYaw);
        const rightX = Math.cos(playerServerYaw);
        const rightZ = -Math.sin(playerServerYaw);
        let deltaX = 0, deltaZ = 0;

        if (input.w) { deltaX += forwardX; deltaZ += forwardZ; }
        if (input.s) { deltaX -= forwardX; deltaZ -= forwardZ; }
        if (input.a) { deltaX -= rightX;   deltaZ -= rightZ;   }
        if (input.d) { deltaX += rightX;   deltaZ += rightZ;   }

        const moveMagnitude = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
        if (moveMagnitude > 0) {
            player.x += (deltaX / moveMagnitude) * PLAYER_SPEED_FACTOR;
            player.z += (deltaZ / moveMagnitude) * PLAYER_SPEED_FACTOR;
        }

        // Arena bounds collision for players
        const playerEffectiveRadius = PLAYER_HIT_RADIUS * 0.8; // Slightly smaller for movement to feel less stuck
        const bounds = ARENA_SIZE / 2;
        if (player.x + playerEffectiveRadius > bounds) player.x = bounds - playerEffectiveRadius;
        if (player.x - playerEffectiveRadius < -bounds) player.x = -bounds + playerEffectiveRadius;
        if (player.z + playerEffectiveRadius > bounds) player.z = bounds - playerEffectiveRadius;
        if (player.z - playerEffectiveRadius < -bounds) player.z = -bounds + playerEffectiveRadius;


        if (input.space && !player.isJumping && player.y <= GROUND_Y) {
            player.velocityY = JUMP_STRENGTH; player.isJumping = true;
        }
        if (player.isJumping || player.y > GROUND_Y) {
            player.velocityY -= GRAVITY; player.y += player.velocityY;
            if (player.y <= GROUND_Y) {
                player.y = GROUND_Y; player.isJumping = false; player.velocityY = 0;
            }
        }
        player.rotationY = playerServerYaw + Math.PI;
    }

    // Disc Updates
    for (const discId in discs) {
        const disc = discs[discId];
        if (disc.state === 'thrown' || disc.state === 'returning') {
            disc.rotY = (disc.rotY + 0.2) % (Math.PI * 2);
        }

        if (disc.state === 'thrown') {
            const prevX = disc.x, prevY = disc.y, prevZ = disc.z;
            disc.velY -= DISC_GRAVITY;
            disc.x += disc.velX * tickInterval;
            disc.y += disc.velY * tickInterval;
            disc.z += disc.velZ * tickInterval;

            const dTravelX = disc.x - prevX, dTravelY = disc.y - prevY, dTravelZ = disc.z - prevZ;
            disc.distanceTraveled += Math.sqrt(dTravelX*dTravelX + dTravelY*dTravelY + dTravelZ*dTravelZ);

            if (disc.distanceTraveled >= MAX_THROW_DISTANCE) {
                disc.state = 'returning';
            }

            // Disc-Player Collision Check (only if game is active)
            if (gameStatus === 'active') {
                for (const targetPlayerId in players) {
                    const targetPlayer = players[targetPlayerId];
                    if (!targetPlayer.isActive || targetPlayer.isDefeated) continue;
                    if (targetPlayerId === disc.returnToPlayerId) continue; // No friendly fire with own thrown disc

                    const dx = disc.x - targetPlayer.x;
                    const dy = disc.y - (targetPlayer.y); // Target player's center
                    const dz = disc.z - targetPlayer.z;
                    const collisionDistance = Math.sqrt(dx*dx + dy*dy + dz*dz);

                    if (collisionDistance < PLAYER_HIT_RADIUS + DISC_RADIUS) {
                        console.log(`Disc ${disc.id} (from ${disc.returnToPlayerId}) hit player ${targetPlayerId}!`);
                        targetPlayer.health -= DISC_DAMAGE;
                        if (players[disc.returnToPlayerId]) { // Check if thrower still exists
                            players[disc.returnToPlayerId].score += 10; // Award points
                        }

                        if (targetPlayer.health <= 0) {
                            targetPlayer.health = 0;
                            targetPlayer.isDefeated = true;
                            targetPlayer.defeatTimestamp = Date.now();
                            console.log(`Player ${targetPlayerId} defeated by ${disc.returnToPlayerId}!`);
                            if (players[disc.returnToPlayerId]) players[disc.returnToPlayerId].score += 50; // Bonus for defeat
                        }
                        disc.state = 'returning'; // Disc returns after a hit
                        break; 
                    }
                }
            }

        } else if (disc.state === 'returning') {
            const targetPlayer = players[disc.returnToPlayerId]; // The one it should return to
            if (targetPlayer && targetPlayer.isActive) {
                const targetPos = { x: targetPlayer.x, y: targetPlayer.y, z: targetPlayer.z };
                const dirX = targetPos.x - disc.x;
                const dirY = targetPos.y - disc.y;
                const dirZ = targetPos.z - disc.z;
                const distToTarget = Math.sqrt(dirX*dirX + dirY*dirY + dirZ*dirZ);

                if (distToTarget < CATCH_RADIUS && targetPlayer.heldDiscId === null && !targetPlayer.isDefeated) {
                    disc.state = 'held';
                    disc.ownerId = disc.returnToPlayerId;
                    targetPlayer.heldDiscId = disc.id;
                    disc.velX = 0; disc.velY = 0; disc.velZ = 0;
                    disc.distanceTraveled = 0;
                } else if (distToTarget > 0.1) {
                    const normFactor = 1 / distToTarget;
                    disc.velX = dirX * normFactor * DISC_RETURN_SPEED;
                    disc.velY = dirY * normFactor * DISC_RETURN_SPEED;
                    disc.velZ = dirZ * normFactor * DISC_RETURN_SPEED;
                    disc.x += disc.velX * tickInterval; // <-- Typo here: tickaInterval
                    disc.y += disc.velY * tickInterval;
                    disc.z += disc.velZ * tickInterval;
                } else if (targetPlayer.heldDiscId !== null || targetPlayer.isDefeated) { // Can't catch or target defeated
                     // Disc is at target but cannot be caught. Make it hover or fall.
                    disc.velX *= 0.1; disc.velZ *= 0.1; // Slow horizontal
                    if(!targetPlayer.isDefeated) disc.velY = 0; // Hover if target is alive but busy
                    else disc.velY -= DISC_GRAVITY; // Fall if target is defeated

                    disc.x += disc.velX * tickInterval;
                    disc.y += disc.velY * tickInterval;
                    disc.z += disc.velZ * tickInterval;
                }
            } else { // Target player disconnected or inactive, or disc has no target
                disc.state = 'thrown'; // Becomes a 'dead' disc, will fall
                disc.velX *= 0.1; disc.velZ *= 0.1;
                // Gravity will apply in next 'thrown' state update
            }
        }

        // Disc Boundary Collisions
        if (disc.state === 'thrown' || disc.state === 'returning') {
            const halfArena = ARENA_SIZE / 2;
            const discFloorY = GROUND_Y + DISC_RADIUS;
            const discCeilingY = GROUND_Y + WALL_HEIGHT - DISC_RADIUS;

            if (disc.x + DISC_RADIUS > halfArena)      { disc.x = halfArena - DISC_RADIUS;      disc.velX *= -0.7; }
            else if (disc.x - DISC_RADIUS < -halfArena){ disc.x = -halfArena + DISC_RADIUS;     disc.velX *= -0.7; }
            if (disc.z + DISC_RADIUS > halfArena)      { disc.z = halfArena - DISC_RADIUS;      disc.velZ *= -0.7; }
            else if (disc.z - DISC_RADIUS < -halfArena){ disc.z = -halfArena + DISC_RADIUS;     disc.velZ *= -0.7; }
            
            if (disc.y < discFloorY) {
                disc.y = discFloorY; disc.velY *= -0.5;
                if (Math.abs(disc.velY) < 0.1) disc.velY = 0;
                disc.velX *= 0.9; disc.velZ *= 0.9;
            }
            if (disc.y > discCeilingY) {
                disc.y = discCeilingY; disc.velY *= -0.5;
            }
        }
    }

    // Check Game Over Condition
    if (gameStatus === 'active') {
        const activePlayers = Object.values(players).filter(p => p.isActive && !p.isDefeated);
        if (Object.keys(players).length >= 1 && activePlayers.length <= 1) { // Game needs at least 1 player to be "over" for a winner/draw
            if (Object.keys(players).length === MAX_PLAYERS || (Object.keys(players).length === 1 && activePlayers.length === 0) ) { // Only declare game over if max players were in, or if last player is defeated
                gameStatus = 'gameOver';
                winnerId = activePlayers.length === 1 ? activePlayers[0].id : null; // null for a draw
                console.log(`Game Over! Winner: ${winnerId ? winnerId : 'Draw/None'}.`);
                if (gameResetTimeout) clearTimeout(gameResetTimeout);
                gameResetTimeout = setTimeout(() => {
                    console.log("Resetting game to waiting state...");
                    gameStatus = 'waiting';
                    winnerId = null;
                    // Players who are still connected will be reset when a new game starts
                    // Or we can explicitly reset them here.
                     for (const pId in players) {
                        players[pId].isDefeated = true; // Mark as defeated to allow re-initialization
                        players[pId].defeatTimestamp = Date.now() - RESPAWN_DELAY + 1000; // Allow quick "respawn" into new game
                        players[pId].score = 0; // Reset score for next game
                    }
                     // If not enough players for a new game, they'll just wait.
                    if(Object.keys(players).length === MAX_PLAYERS){
                        startGame();
                    }

                }, GAME_OVER_DISPLAY_DURATION);
            }
        }
    }


    // Prepare and broadcast game state
    const worldState = {
        type: 'worldUpdate',
        players: players, // Includes health, score, isDefeated
        discs: discs,
        gameInfo: {
            status: gameStatus,
            winner: winnerId,
        }
    };
    const worldStateString = JSON.stringify(worldState);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(worldStateString);
        }
    });
}

setInterval(gameLoop, 1000 / TICK_RATE);
