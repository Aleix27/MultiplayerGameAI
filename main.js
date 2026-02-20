const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let width, height;
function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const gameState = {
    started: false,
    gameOver: false,
    camera: { x: 0, y: 0, zoom: 0.8 },
    keys: { left: false, right: false, up: false },
    mouse: { x: 0, y: 0 },
    screenShake: 0,
    playerId: Math.random().toString(36).substring(7),
    isHost: false,
    color: '#00ffff',
    name: 'Convidat',
    scores: {},
    matchTimeRemaining: 120,
    matchDuration: 120,
    matchTimerInterval: null
};
gameState.scores[gameState.playerId] = 0;

const roomIdDisplay = document.getElementById('roomIdDisplay');
const netStatus = document.getElementById('netStatus');
const scoreboardDiv = document.getElementById('pvpScoreboard');
const timerDisplay = document.getElementById('timerDisplay');
const playerListContainer = document.getElementById('playerListContainer');

let selectedColor = '#00ffff';
document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        selectedColor = e.target.getAttribute('data-color');
    });
});

function applyProfile() {
    let nameInput = document.getElementById('nicknameInput').value.trim();
    if (nameInput) gameState.name = nameInput;
    gameState.color = selectedColor;
    player = new Player(gameState.color);
}

let peer = null;
let connections = [];
let remotePlayers = {};
let lobbyPlayers = [];
let ufos = [];

function initPeer(isHosting, presetId = null) {
    applyProfile();
    netStatus.innerText = "Connectant...";
    peer = new Peer(presetId);

    peer.on('open', (id) => {
        document.getElementById('introScreen').classList.add('hidden');
        document.getElementById('lobbyRoom').classList.remove('hidden');
        lobbyPlayers.push({ id: gameState.playerId, name: gameState.name, color: gameState.color });
        updateLobbyUI();

        if (isHosting) {
            gameState.isHost = true;
            roomIdDisplay.innerText = id;
            document.querySelectorAll('.hidden-guest').forEach(el => el.classList.remove('hidden-guest'));
            netStatus.innerText = "";
        } else {
            document.querySelectorAll('.hidden-host').forEach(el => el.classList.remove('hidden-host'));
            roomIdDisplay.innerText = presetId;
            netStatus.innerText = "";
        }
    });

    peer.on('connection', (conn) => {
        connections.push(conn);
        setupConnection(conn);
    });
}

function connectToPeer(targetId) {
    applyProfile();
    roomIdDisplay.innerText = targetId;
    let conn = peer.connect(targetId);
    connections.push(conn);
    setupConnection(conn);
}

function setupConnection(conn) {
    conn.on('open', () => {
        conn.send({ type: 'init', id: gameState.playerId, name: gameState.name, color: gameState.color });
    });

    conn.on('data', (data) => {
        if (data.type === 'init') {
            remotePlayers[data.id] = { name: data.name, color: data.color, x: -9999, y: -9999, targetX: -9999, targetY: -9999, hp: 100, facing: { x: 1, y: 0 } };
            gameState.scores[data.id] = 0;
            if (!lobbyPlayers.find(p => p.id === data.id)) {
                lobbyPlayers.push({ id: data.id, name: data.name, color: data.color });
                updateLobbyUI();
            }
            if (gameState.isHost) {
                broadcast({ type: 'lobby_sync', list: lobbyPlayers });
                let timeVal = parseInt(document.getElementById('timeSelectInput').value);
                broadcast({ type: 'settings', time: timeVal });
                if (gameState.started) conn.send({ type: 'start', time: gameState.matchTimeRemaining });
            }
        }
        else if (data.type === 'lobby_sync') {
            lobbyPlayers = data.list;
            updateLobbyUI();
        }
        else if (data.type === 'settings') {
            gameState.matchDuration = data.time;
            gameState.matchTimeRemaining = data.time;
        }
        else if (data.type === 'start') {
            if (data.time) gameState.matchTimeRemaining = data.time;
            startGame();
        }
        else if (data.type === 'timer') {
            gameState.matchTimeRemaining = data.time;
            updateTimerUI();
            if (data.time <= 0) endGame();
        }
        else if (data.type === 'sync') {
            if (!gameState.started || gameState.gameOver) return;
            if (!remotePlayers[data.id]) return;

            // Interpolation Setup (Smooth Online Play)
            remotePlayers[data.id].targetX = data.x;
            remotePlayers[data.id].targetY = data.y;

            // If first packet or super far away, snap to target
            if (Math.hypot(remotePlayers[data.id].x - data.x, remotePlayers[data.id].y - data.y) > 1000) {
                remotePlayers[data.id].x = data.x;
                remotePlayers[data.id].y = data.y;
            }

            remotePlayers[data.id].hp = data.hp;
            remotePlayers[data.id].facing = data.facing;
            if (data.score !== undefined) {
                gameState.scores[data.id] = data.score;
                updateScoreboard();
            }
        }
        else if (data.type === 'shoot') {
            if (gameState.gameOver) return;
            bullets.push(new Laser(data.x, data.y, data.vx, data.vy, data.color, data.id));
            playSound(data.id === 'ufo' ? 'ufo' : 'shoot');
        }
        else if (data.type === 'ufo_sync') {
            ufos = data.list.map(u => {
                let existing = ufos.find(eu => eu.id === u.id);
                if (existing) {
                    existing.x = u.x; existing.y = u.y; existing.hp = u.hp; return existing;
                }
                return new UFO(u.id, u.x, u.y);
            });
        }
        else if (data.type === 'kill') {
            if (gameState.gameOver) return;
            if (data.killerId === gameState.playerId) {
                gameState.scores[gameState.playerId] += data.pts || 1;
                updateScoreboard();
                showLore((data.deadId === 'ufo') ? "Has abatut l'OVNI! (+2)" : "Has destruït a un enemic!", 2000);
            }
            if (data.deadId === gameState.playerId) {
                die();
            } else if (data.deadId === 'ufo') {
                let u = ufos.find(u => u.id === data.ufoId);
                if (u) {
                    spawnExplosion(u.x, u.y, '#ff00ff', 60, 10);
                    spawnShockwave(u.x, u.y, '#ff00ff');
                    playSound('explosion');
                }
            } else {
                let rp = remotePlayers[data.deadId];
                if (rp) {
                    spawnExplosion(rp.x, rp.y, rp.color, 60, 10);
                    spawnShockwave(rp.x, rp.y, rp.color);
                    playSound('explosion');
                }
            }

            // Cleanup UFO if it was killed
            if (data.deadId === 'ufo') {
                ufos = ufos.filter(u => u.id !== data.ufoId);
            }
        }
        else if (data.type === 'restart') {
            resetMatchState();
            startGame();
        }
    });
}

function broadcast(data) {
    for (let c of connections) {
        if (c.open) c.send(data);
    }
}

// Host syncs timer and state
setInterval(() => {
    if (gameState.started && gameState.isHost && !gameState.gameOver) {
        gameState.matchTimeRemaining--;
        updateTimerUI();
        broadcast({ type: 'timer', time: gameState.matchTimeRemaining });
        if (gameState.matchTimeRemaining <= 0) {
            endGame();
        }

        // Host governs UFO spawning
        if (Math.random() < 0.05 && ufos.length < 1) {
            let ufoId = 'ufo_' + Math.random().toString(36).substr(2, 9);
            ufos.push(new UFO(ufoId, (Math.random() - 0.5) * 8000, (Math.random() - 0.5) * 8000));
        }
        // Broadcast UFOs
        if (ufos.length > 0) {
            let list = ufos.map(u => ({ id: u.id, x: u.x, y: u.y, hp: u.hp }));
            broadcast({ type: 'ufo_sync', list });
        }
    }
}, 1000);

// Player 30fps sync
setInterval(() => {
    if (gameState.started && peer && player.hp > 0 && !gameState.gameOver) {
        broadcast({
            type: 'sync',
            id: gameState.playerId,
            x: player.x, y: player.y,
            hp: player.hp,
            facing: player.facing,
            score: gameState.scores[gameState.playerId]
        });
    }
}, 30);

function updateLobbyUI() {
    playerListContainer.innerHTML = '';
    for (let p of lobbyPlayers) {
        let div = document.createElement('div');
        div.className = 'player-tag';
        div.innerHTML = `<span style="display:flex; align-items:center; gap:10px;">
            <div style="width:15px; height:15px; border-radius:50%; background:${p.color}; box-shadow: 0 0 10px ${p.color};"></div>
            ${p.name} ${p.id === gameState.playerId ? '(Tu)' : ''}
        </span>`;
        playerListContainer.appendChild(div);
    }
}

function updateScoreboard() {
    scoreboardDiv.innerHTML = '';
    let sorted = Object.keys(gameState.scores).sort((a, b) => gameState.scores[b] - gameState.scores[a]);
    for (let id of sorted) {
        let isMe = id === gameState.playerId;
        let pName = isMe ? gameState.name : (remotePlayers[id] ? remotePlayers[id].name : id.substring(0, 3));
        let color = isMe ? gameState.color : (remotePlayers[id] ? remotePlayers[id].color : '#fff');

        let div = document.createElement('div');
        div.style.color = color;
        div.style.textShadow = `0 0 5px ${color}`;
        div.style.background = 'rgba(0,0,0,0.5)';
        div.style.padding = '2px 8px';
        div.style.borderRadius = '4px';
        div.style.fontWeight = '700';
        div.innerText = `${pName}: ${gameState.scores[id]}`;
        scoreboardDiv.appendChild(div);
    }
}

function formatTime(secs) {
    let m = Math.floor(secs / 60).toString().padStart(2, '0');
    let s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function updateTimerUI() {
    timerDisplay.innerText = formatTime(Math.max(0, gameState.matchTimeRemaining));
    if (gameState.matchTimeRemaining <= 10) timerDisplay.style.color = '#ff0055';
    else timerDisplay.style.color = '#fff';
}

document.getElementById('hostBtn').addEventListener('click', () => {
    let shortId = "ARENA-" + Math.floor(1000 + Math.random() * 9000);
    initPeer(true, shortId);
});
document.getElementById('joinBtn').addEventListener('click', () => {
    document.getElementById('introScreen').classList.add('hidden');
    document.getElementById('joinRoom').classList.remove('hidden');
});
document.getElementById('connectBtn').addEventListener('click', () => {
    let targetId = document.getElementById('joinInput').value.trim();
    if (targetId) {
        document.getElementById('joinRoom').classList.add('hidden');
        initPeer(false);
        let interval = setInterval(() => {
            if (peer && peer.open) {
                connectToPeer(targetId);
                clearInterval(interval);
            }
        }, 100);
    }
});
document.getElementById('startGameHostBtn').addEventListener('click', () => {
    let timeVal = parseInt(document.getElementById('timeSelectInput').value);
    // basic clamp text input
    if (isNaN(timeVal) || timeVal <= 0) timeVal = 120;

    gameState.matchDuration = timeVal;
    gameState.matchTimeRemaining = timeVal;
    broadcast({ type: 'settings', time: timeVal });
    broadcast({ type: 'start', time: timeVal });
    startGame();
});
document.getElementById('postMatchBtn').addEventListener('click', () => {
    if (gameState.isHost) {
        broadcast({ type: 'restart' });
        resetMatchState();
        startGame();
    }
});

function resetMatchState() {
    gameState.started = false;
    gameState.gameOver = false;
    gameState.matchTimeRemaining = gameState.matchDuration;
    bullets.length = 0;
    meteorites.length = 0;
    particles.length = 0;
    shockwaves.length = 0;
    ufos.length = 0;
    Object.keys(gameState.scores).forEach(k => gameState.scores[k] = 0);
    for (let id in remotePlayers) remotePlayers[id].hp = 100;
}

function startGame() {
    if (gameState.started) return;
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => { });

    document.getElementById('introScreen').classList.add('hidden');
    document.getElementById('lobbyRoom').classList.add('hidden');
    document.getElementById('winScreen').classList.add('hidden');
    document.getElementById('ui').classList.remove('hidden');

    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        document.getElementById('touchControls').classList.remove('hidden');
    }

    gameState.started = true;
    gameState.gameOver = false;
    initAudio();
    updateScoreboard();
    updateTimerUI();
    respawn();
}

function endGame() {
    gameState.gameOver = true;
    gameState.started = false;
    document.getElementById('ui').classList.add('hidden');
    document.getElementById('touchControls').classList.add('hidden');

    let sorted = Object.keys(gameState.scores).sort((a, b) => gameState.scores[b] - gameState.scores[a]);
    let winnerId = sorted[0];

    let wName = (winnerId === gameState.playerId) ? gameState.name : (remotePlayers[winnerId] ? remotePlayers[winnerId].name : winnerId.substring(0, 3));
    let wColor = (winnerId === gameState.playerId) ? gameState.color : (remotePlayers[winnerId] ? remotePlayers[winnerId].color : '#fff');

    document.getElementById('winName').innerText = wName;
    document.getElementById('winName').style.color = wColor;
    document.getElementById('winName').style.textShadow = `0 0 15px ${wColor}`;

    let finalBoard = document.getElementById('finalLeaderboard');
    finalBoard.innerHTML = '';
    for (let id of sorted) {
        let isMe = id === gameState.playerId;
        let pName = isMe ? gameState.name : (remotePlayers[id] ? remotePlayers[id].name : id.substring(0, 3));
        let div = document.createElement('div');
        div.className = 'player-tag';
        div.innerHTML = `<span>${pName}</span> <span style="font-size:1.5rem;">${gameState.scores[id]}</span>`;
        finalBoard.appendChild(div);
    }

    setTimeout(() => { document.getElementById('winScreen').classList.remove('hidden'); }, 1000);
}


// --- AUDIO SYSTEM ---
let audioCtx, bgmGain, filterNode;
function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    let osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(55, audioCtx.currentTime);

    filterNode = audioCtx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.setValueAtTime(300, audioCtx.currentTime);

    bgmGain = audioCtx.createGain();
    bgmGain.gain.value = 0.05;

    osc.connect(filterNode);
    filterNode.connect(bgmGain);
    bgmGain.connect(audioCtx.destination);
    osc.start();

    setInterval(() => {
        if (!audioCtx) return;
        filterNode.frequency.setTargetAtTime(200 + Math.random() * 400, audioCtx.currentTime, 2);
    }, 4000);
}

function playSound(type) {
    if (!audioCtx) return;
    let osc = audioCtx.createOscillator();
    let gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    let now = audioCtx.currentTime;

    if (type === 'shoot') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now); osc.stop(now + 0.15);
    } else if (type === 'hit') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'explosion') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(10, now + 0.6);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        osc.start(now); osc.stop(now + 0.6);
    } else if (type === 'ufo') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(800, now + 0.1);
        osc.frequency.linearRampToValueAtTime(400, now + 0.2);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 1.0);
        osc.start(now); osc.stop(now + 1.0);
    }
}

function triggerHaptic(type) {
    if (!navigator.vibrate) return;
    if (type === 'shoot') navigator.vibrate(15);
    if (type === 'hit') navigator.vibrate(50);
    if (type === 'heavy') navigator.vibrate([50, 50, 100]);
}

// --- INPUTS & TOUCH AIMING ---
window.addEventListener('mousemove', e => {
    gameState.mouse.x = e.clientX;
    gameState.mouse.y = e.clientY;
});
window.addEventListener('mousedown', e => {
    if (!gameState.started || gameState.gameOver || player.hp <= 0) return;
    player.tryShoot(e.clientX, e.clientY);
});

window.addEventListener('keydown', e => {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') gameState.keys.left = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') gameState.keys.right = true;
    if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'Space') gameState.keys.up = true;
});
window.addEventListener('keyup', e => {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') gameState.keys.left = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') gameState.keys.right = false;
    if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'Space') gameState.keys.up = false;
});

const joystickZone = document.getElementById('joystickZone');
const joystickKnob = document.getElementById('joystickKnob');
const btnJump = document.getElementById('btnJump');

let joystickActive = false;
let joystickCenter = { x: 0, y: 0 };
let joystickTouchId = null;

joystickZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    let touch = e.changedTouches[0];
    joystickTouchId = touch.identifier;
    let rect = joystickZone.getBoundingClientRect();
    joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    joystickActive = true;
    handleJoystickMove(touch.clientX);
}, { passive: false });

joystickZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!joystickActive) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joystickTouchId) handleJoystickMove(e.changedTouches[i].clientX);
    }
}, { passive: false });

joystickZone.addEventListener('touchend', (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joystickTouchId) {
            joystickActive = false; joystickKnob.style.transform = `translate(-50%, -50%)`;
            gameState.keys.left = gameState.keys.right = false;
        }
    }
}, { passive: false });

function handleJoystickMove(clientX) {
    let dx = clientX - joystickCenter.x;
    let clampedX = Math.max(-40, Math.min(40, dx));
    joystickKnob.style.transform = `translate(calc(-50% + ${clampedX}px), -50%)`;
    if (clampedX < -10) { gameState.keys.left = true; gameState.keys.right = false; }
    else if (clampedX > 10) { gameState.keys.right = true; gameState.keys.left = false; }
    else { gameState.keys.left = gameState.keys.right = false; }
}

btnJump.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); gameState.keys.up = true; btnJump.classList.add('active'); }, { passive: false });
btnJump.addEventListener('touchend', (e) => { e.stopPropagation(); e.preventDefault(); gameState.keys.up = false; btnJump.classList.remove('active'); }, { passive: false });

window.addEventListener('touchstart', (e) => {
    if (!gameState.started || gameState.gameOver || player.hp <= 0) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
        let touch = e.changedTouches[i];
        let target = document.elementFromPoint(touch.clientX, touch.clientY);
        if (target && (target.closest('#touchControls') || target.closest('.action-btn') || target.closest('.color-btn') || target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'SELECT')) {
            continue;
        }
        player.tryShoot(touch.clientX, touch.clientY);
    }
}, { passive: false });

let loreTimeout;
function showLore(text, duration = 4000) {
    const popup = document.getElementById('lorePopup');
    document.getElementById('loreText').innerText = text;
    popup.classList.remove('lore-hidden');
    clearTimeout(loreTimeout);
    loreTimeout = setTimeout(() => popup.classList.add('lore-hidden'), duration);
}

const dist = (p1, p2) => Math.hypot(p2.x - p1.x, p2.y - p1.y);
const normalize = (v) => { const d = Math.hypot(v.x, v.y); return d === 0 ? { x: 0, y: 0 } : { x: v.x / d, y: v.y / d }; };

const glowCache = {};
function getGlow(radius, coreColor, outerColor) {
    const key = `${Math.floor(radius)}_${coreColor}_${outerColor}`;
    if (glowCache[key]) return glowCache[key];
    let canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.ceil(radius * 2);
    let ctx2 = canvas.getContext('2d', { willReadFrequently: true });
    let grad = ctx2.createRadialGradient(radius, radius, 0, radius, radius, radius);
    grad.addColorStop(0, coreColor); grad.addColorStop(0.2, outerColor); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx2.fillStyle = grad; ctx2.fillRect(0, 0, radius * 2, radius * 2);
    glowCache[key] = canvas;
    return canvas;
}

function screenToWorld(sx, sy) {
    let wx = (sx - width / 2) / gameState.camera.zoom + gameState.camera.x;
    let wy = (sy - height / 2) / gameState.camera.zoom + gameState.camera.y;
    return { x: wx, y: wy };
}

// --- ENTITIES ---
const planets = [];
const meteorites = [];
const bullets = [];
const particles = [];
const shockwaves = [];
let stars = [];

class UFO {
    constructor(id, x, y) {
        this.id = id; this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.hp = 100;
        this.time = 0; this.radius = 25; this.shootCooldown = 0;
    }
    update() {
        if (this.hp <= 0) return;
        this.time += 0.05;
        this.vx = Math.sin(this.time) * 15;
        this.vy = Math.cos(this.time * 0.7) * 10;
        this.x += this.vx; this.y += this.vy;

        if (gameState.isHost) {
            this.shootCooldown--;
            if (this.shootCooldown <= 0) {
                this.shootCooldown = 45;
                let minDist = Infinity;
                let target = null;
                let allPlayers = [{ id: gameState.playerId, p: player }];
                for (let id in remotePlayers) if (remotePlayers[id].hp > 0) allPlayers.push({ id, p: remotePlayers[id] });
                for (let data of allPlayers) {
                    if (data.p.hp <= 0) continue;
                    let d = dist(this, data.p);
                    if (d < minDist) { minDist = d; target = data.p; }
                }
                if (target && minDist < 1500) {
                    let dir = normalize({ x: target.x - this.x, y: target.y - this.y });
                    let bvx = dir.x * 20; let bvy = dir.y * 20;
                    let bx = this.x + dir.x * 30; let by = this.y + dir.y * 30;
                    bullets.push(new Laser(bx, by, bvx, bvy, '#aa00ff', 'ufo'));
                    playSound('ufo');
                    broadcast({ type: 'shoot', id: 'ufo', x: bx, y: by, vx: bvx, vy: bvy, color: '#aa00ff' });
                }
            }
        }
    }
    draw(ctx) {
        if (this.hp <= 0) return;
        ctx.save(); ctx.translate(this.x, this.y);
        ctx.globalCompositeOperation = 'lighter';
        let glow = getGlow(60, '#aa00ff', 'rgba(0,0,0,0)'); ctx.drawImage(glow, -60, -60);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ff00ff'; ctx.beginPath(); ctx.arc(0, -5, 15, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#555'; ctx.beginPath(); ctx.ellipse(0, 5, 25, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = (Math.floor(Date.now() / 100) % 2 === 0) ? '#00ffff' : '#ff00ff';
        ctx.beginPath(); ctx.arc(-15, 5, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(0, 5, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(15, 5, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
}

class Shockwave {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color; this.radius = 1; this.maxRadius = 150; this.life = 1;
    }
    update() { this.radius += 8; this.life -= 0.05; }
    draw(ctx) {
        if (this.life <= 0) return;
        ctx.globalCompositeOperation = 'lighter'; ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.globalAlpha = Math.max(0, this.life); ctx.strokeStyle = this.color; ctx.lineWidth = 4 * this.life; ctx.stroke();
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
}
function spawnShockwave(x, y, color) { shockwaves.push(new Shockwave(x, y, color)); }

class Particle {
    constructor(x, y, vx, vy, color, life, size) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.color = color; this.life = this.maxLife = life; this.size = size; this.friction = 0.96;
    }
    update() {
        this.vx *= this.friction; this.vy *= this.friction; this.x += this.vx; this.y += this.vy; this.life--; this.size *= 0.94;
    }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life / this.maxLife); ctx.fillStyle = this.color; ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
}

function spawnExplosion(x, y, color, count, speed = 5, isHit = false) {
    let base = isHit ? 10 : 30;
    for (let i = 0; i < count; i++) {
        let a = Math.random() * Math.PI * 2; let v = Math.random() * speed;
        particles.push(new Particle(x, y, Math.cos(a) * v, Math.sin(a) * v, color, base + Math.random() * 20, 1 + Math.random() * 3));
    }
}

class Background {
    constructor() {
        for (let i = 0; i < 150; i++) {
            stars.push({ x: (Math.random() - 0.5) * 15000, y: (Math.random() - 0.5) * 15000, z: Math.random() * 2 + 0.1, size: Math.random() * 2, twinkleSpeed: Math.random() * 0.05 });
        }
    }
    draw(ctx) {
        const time = Date.now(); ctx.fillStyle = '#fff';
        for (let s of stars) {
            let sx = s.x - (gameState.camera.x / s.z); let sy = s.y - (gameState.camera.y / s.z);
            if (sx < -10 || sx > width + 10 || sy < -10 || sy > height + 10) continue;
            let alpha = 0.3 + Math.sin(time * s.twinkleSpeed) * 0.3 + 0.4;
            ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(sx, sy, s.size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

class Planet {
    constructor(x, y, radius, mass, style) {
        this.x = x; this.y = y; this.radius = radius; this.mass = mass; this.style = style;
        let styles = [
            { c: '#2a9d8f', s: '#264653', a: 'rgba(32, 227, 178, 0.4)', rings: true },
            { c: '#e76f51', s: '#4a2511', a: 'rgba(231, 111, 81, 0.3)', rings: false },
            { c: '#4cc9f0', s: '#1e1b4b', a: 'rgba(76, 201, 240, 0.3)', rings: false },
            { c: '#ffd166', s: '#06d6a0', a: 'rgba(255, 209, 102, 0.2)', rings: true }
        ];
        let st = styles[style % 4]; this.core = st.c; this.surface = st.s; this.atmosphereColor = st.a; this.hasRings = st.rings;
        this.rotation = Math.random() * Math.PI; this.craters = [];
        for (let i = 0; i < 5; i++) { this.craters.push({ r: Math.random() * this.radius, a: Math.random() * Math.PI * 2, size: 5 + Math.random() * 15 }); }
    }
    draw(ctx) {
        ctx.save(); ctx.translate(this.x, this.y); ctx.globalCompositeOperation = 'lighter';
        let atm = getGlow(this.radius * 2.5, this.atmosphereColor, 'rgba(0,0,0,0)'); ctx.drawImage(atm, -this.radius * 2.5, -this.radius * 2.5);
        ctx.globalCompositeOperation = 'source-over'; ctx.rotate(this.rotation);
        let grad = ctx.createRadialGradient(0, 0, 0, 0, 0, this.radius);
        grad.addColorStop(0, this.core); grad.addColorStop(0.7, this.surface); grad.addColorStop(1, '#050308');
        ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill(); ctx.clip();
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        for (let c of this.craters) {
            let cx = Math.cos(c.a) * c.r, cy = Math.sin(c.a) * c.r; ctx.beginPath(); ctx.arc(cx, cy, c.size, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.rotate(-this.rotation);
        let shadow = ctx.createLinearGradient(-this.radius, -this.radius, this.radius, this.radius);
        shadow.addColorStop(0, 'rgba(255,255,255,0.1)'); shadow.addColorStop(0.4, 'rgba(0,0,0,0)'); shadow.addColorStop(0.8, 'rgba(0,0,0,0.6)'); shadow.addColorStop(1, 'rgba(0,0,0,0.9)');
        ctx.fillStyle = shadow; ctx.fillRect(-this.radius, -this.radius, this.radius * 2, this.radius * 2); ctx.restore();
        if (this.hasRings) {
            ctx.save(); ctx.translate(this.x, this.y); ctx.scale(1, 0.3); ctx.rotate(this.rotation * 0.5);
            ctx.beginPath(); ctx.arc(0, 0, this.radius * 1.6, 0, Math.PI * 2); ctx.lineWidth = 15; ctx.strokeStyle = this.atmosphereColor; ctx.stroke();
            ctx.beginPath(); ctx.arc(0, 0, this.radius * 1.8, 0, Math.PI * 2); ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.stroke(); ctx.restore();
        }
    }
}

class Meteorite {
    constructor() {
        let angle = Math.random() * Math.PI * 2; let distSpawn = 4000;
        this.x = gameState.camera.x + Math.cos(angle) * distSpawn; this.y = gameState.camera.y + Math.sin(angle) * distSpawn;
        let tx = gameState.camera.x + (Math.random() - 0.5) * 1500; let ty = gameState.camera.y + (Math.random() - 0.5) * 1500;
        let dir = normalize({ x: tx - this.x, y: ty - this.y }); let speed = 20 + Math.random() * 20;
        this.vx = dir.x * speed; this.vy = dir.y * speed; this.radius = 50 + Math.random() * 60;
        this.rotation = 0; this.rotSpeed = (Math.random() - 0.5) * 0.1; this.points = [];
        for (let i = 0; i < 10; i++) this.points.push(this.radius * (0.7 + Math.random() * 0.3));
    }
    update() {
        this.x += this.vx; this.y += this.vy; this.rotation += this.rotSpeed;
        if (Math.random() < 0.4) {
            particles.push(new Particle(this.x + (Math.random() - 0.5) * this.radius, this.y + (Math.random() - 0.5) * this.radius, -this.vx * 0.2, -this.vy * 0.2, '#ff3300', 30, 6));
            particles.push(new Particle(this.x, this.y, -this.vx * 0.1, -this.vy * 0.1, '#550000', 40, 10));
        }
    }
    draw(ctx) {
        ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rotation); ctx.globalCompositeOperation = 'lighter';
        let glow = getGlow(this.radius * 1.8, 'rgba(255,50,0,0.6)', 'rgba(0,0,0,0)'); ctx.drawImage(glow, -this.radius * 1.8, -this.radius * 1.8);
        ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#110500'; ctx.beginPath();
        for (let i = 0; i < this.points.length; i++) {
            let a = (i / this.points.length) * Math.PI * 2; let r = this.points[i];
            if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#ff3300'; ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = '#ffaa00'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-this.radius * 0.5, 0); ctx.lineTo(this.radius * 0.5, 0); ctx.stroke(); ctx.restore();
    }
}

class Laser {
    constructor(x, y, vx, vy, color, ownerId) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.color = color; this.ownerId = ownerId; this.life = 100; this.pastPos = [];
    }
    update() {
        this.pastPos.push({ x: this.x, y: this.y }); if (this.pastPos.length > 5) this.pastPos.shift();
        this.x += this.vx; this.y += this.vy; this.life--;
        if (Math.random() < 0.5) particles.push(new Particle(this.x, this.y, this.vx * 0.1, this.vy * 0.1, this.color, 15, 2));
    }
    draw(ctx) {
        if (this.pastPos.length < 2) return; ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath(); ctx.moveTo(this.pastPos[0].x, this.pastPos[0].y); ctx.lineTo(this.x, this.y); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(this.pastPos[0].x, this.pastPos[0].y); ctx.lineTo(this.x, this.y); ctx.strokeStyle = this.color; ctx.lineWidth = 12; ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
    }
}

class Player {
    constructor(color) {
        this.color = color; this.radius = 12; this.trail = []; this.grounded = false; this.planet = null;
        this.moveSpeed = 0.35; this.jumpForce = 18; this.shootCooldown = 0; this.hp = 0; this.facing = { x: 1, y: 0 }; this.iFrames = 0;
    }
    update(planets) {
        if (this.hp <= 0) return;
        if (this.iFrames > 0) this.iFrames--;
        if (this.shootCooldown > 0) this.shootCooldown--;

        if (gameState.mouse.x !== 0 && !('ontouchstart' in window)) {
            let worldMouse = screenToWorld(gameState.mouse.x, gameState.mouse.y);
            let dir = normalize({ x: worldMouse.x - this.x, y: worldMouse.y - this.y });
            if (dir.x !== 0 || dir.y !== 0) this.facing = dir;
        }

        let totalDir = { x: 0, y: 0 }; let minDist = Infinity; let nearestP = null;
        for (let p of planets) {
            let d = dist(this, p); if (d < minDist) { minDist = d; nearestP = p; }
            let pdist = Math.max(d, p.radius);
            if (pdist < p.radius * 6) {
                let force = (p.mass * 0.005) / (pdist * 0.05); force = Math.min(force, 0.7);
                let normal = normalize({ x: p.x - this.x, y: p.y - this.y });
                totalDir.x += normal.x * force; totalDir.y += normal.y * force;
            }
        }

        this.planet = nearestP; let gravDir = { x: 0, y: 0 };
        if (totalDir.x !== 0 || totalDir.y !== 0) gravDir = normalize(totalDir);
        this.grounded = false;

        if (this.planet && minDist <= this.planet.radius + this.radius) {
            this.grounded = true; let overlap = (this.planet.radius + this.radius) - minDist;
            if (overlap > 0) {
                let local = normalize({ x: this.planet.x - this.x, y: this.planet.y - this.y });
                this.x -= local.x * overlap; this.y -= local.y * overlap;
                let dot = this.vx * local.x + this.vy * local.y;
                if (dot > 0) { this.vx -= local.x * dot; this.vy -= local.y * dot; }
            }
        }
        this.vx += totalDir.x; this.vy += totalDir.y;

        let upVec = { x: -gravDir.x, y: -gravDir.y }; if (upVec.x === 0 && upVec.y === 0) upVec = { x: 0, y: -1 }; let rightVec = { x: -upVec.y, y: upVec.x };

        if (this.grounded || minDist <= this.planet.radius + 150) {
            if (gameState.keys.left) { this.vx -= rightVec.x * this.moveSpeed; this.vy -= rightVec.y * this.moveSpeed; }
            if (gameState.keys.right) { this.vx += rightVec.x * this.moveSpeed; this.vy += rightVec.y * this.moveSpeed; }
        }

        if (gameState.keys.up && this.grounded) {
            this.vx += upVec.x * this.jumpForce; this.vy += upVec.y * this.jumpForce; this.grounded = false;
            triggerHaptic('light'); spawnExplosion(this.x, this.y, '#fff', 20, 4); gameState.keys.up = false;
        }

        let friction = this.grounded ? 0.88 : 0.99; this.vx *= friction; this.vy *= friction; this.x += this.vx; this.y += this.vy;

        this.trail.push({ x: this.x, y: this.y, grounded: this.grounded }); if (this.trail.length > 20) this.trail.shift();
        if (this.y > 6000 || this.y < -6000 || this.x > 8000 || this.x < -2000) die();
    }

    tryShoot(screenX, screenY) {
        if (this.hp <= 0 || this.shootCooldown > 0) return;
        this.shootCooldown = 12;
        let worldTarget = screenToWorld(screenX, screenY);
        let bDir = normalize({ x: worldTarget.x - this.x, y: worldTarget.y - this.y });
        if (bDir.x !== 0 || bDir.y !== 0) this.facing = bDir; else bDir = this.facing;
        let bSpeed = 25; let bx = this.x + bDir.x * 20; let by = this.y + bDir.y * 20;
        let bvx = bDir.x * bSpeed; let bvy = bDir.y * bSpeed;
        bullets.push(new Laser(bx, by, bvx, bvy, this.color, gameState.playerId));
        playSound('shoot'); triggerHaptic('shoot');
        broadcast({ type: 'shoot', id: gameState.playerId, x: bx, y: by, vx: bvx, vy: bvy, color: this.color });
    }

    draw(ctx) {
        if (this.hp <= 0) return;
        if (this.iFrames > 0 && Math.floor(Date.now() / 50) % 2 === 0) return;

        ctx.globalCompositeOperation = 'lighter';
        if (this.trail.length > 2) {
            ctx.beginPath(); ctx.moveTo(this.trail[0].x, this.trail[0].y);
            for (let i = 1; i < this.trail.length; i++) ctx.lineTo(this.trail[i].x, this.trail[i].y);
            ctx.strokeStyle = this.color; ctx.lineWidth = this.radius * 1.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = this.radius * 0.5; ctx.stroke();
        }
        let glow = getGlow(this.radius * 5, '#fff', this.color); ctx.drawImage(glow, this.x - this.radius * 5, this.y - this.radius * 5);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(this.x + this.facing.x * 7, this.y + this.facing.y * 7, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(this.x + this.facing.x * 8, this.y + this.facing.y * 8, 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        ctx.fillStyle = '#fff'; ctx.font = '12px Outfit'; ctx.textAlign = 'center'; ctx.fillText(gameState.name, this.x, this.y - 45);
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(this.x - 15, this.y - 35, 30, 4);
        ctx.fillStyle = '#0f0'; ctx.fillRect(this.x - 15, this.y - 35, 30 * (this.hp / 100), 4);
    }
}

function die() {
    if (player.hp <= 0) return;
    player.hp = 0; triggerHaptic('heavy'); playSound('explosion'); gameState.screenShake = 15;
    spawnExplosion(player.x, player.y, player.color, 80, 15); spawnShockwave(player.x, player.y, player.color);
    showLore("HAS MORT", 3000);
    setTimeout(() => { respawn(); }, 3000);
}

function respawn() {
    if (gameState.gameOver) return;
    let p = planets[Math.floor(Math.random() * planets.length)];
    let angle = Math.random() * Math.PI * 2;
    player.x = p.x + Math.cos(angle) * (p.radius + 100);
    player.y = p.y + Math.sin(angle) * (p.radius + 100);
    player.vx = player.vy = 0; player.hp = 100; player.iFrames = 120; player.trail = [];
}

const background = new Background();
let player = new Player(gameState.color);

function buildLevel() {
    planets.push(new Planet(0, 0, 250, 600, 0));
    planets.push(new Planet(1000, -500, 180, 400, 1));
    planets.push(new Planet(2000, 300, 300, 900, 2));
    planets.push(new Planet(3000, -800, 150, 350, 0));
    planets.push(new Planet(4000, 100, 220, 500, 3));
    planets.push(new Planet(1500, -1200, 200, 600, 2));
}

function update() {
    if (!gameState.started || gameState.gameOver) return;
    if (gameState.screenShake > 0) gameState.screenShake *= 0.9;
    if (gameState.screenShake < 0.5) gameState.screenShake = 0;

    player.update(planets);
    if (Math.random() < 0.015) if (meteorites.length < 8) meteorites.push(new Meteorite());

    // Smooth Interpolation for remote players
    for (let id in remotePlayers) {
        let rp = remotePlayers[id];
        // Only interpolate if within reasonable distance to avoid long glides instead of snaps
        if (Math.hypot(rp.targetX - rp.x, rp.targetY - rp.y) < 1000) {
            rp.x += (rp.targetX - rp.x) * 0.3;
            rp.y += (rp.targetY - rp.y) * 0.3;
        } else {
            rp.x = rp.targetX; rp.y = rp.targetY;
        }
    }

    // Update UFOs
    for (let u of ufos) u.update();

    if (player.hp > 0) {
        let speed = Math.hypot(player.vx, player.vy); let targetCamZoom = speed > 15 ? 0.55 : 0.7;
        gameState.camera.x += (player.x - gameState.camera.x) * 0.1; gameState.camera.y += (player.y - gameState.camera.y) * 0.1;
        gameState.camera.zoom += (targetCamZoom - gameState.camera.zoom) * 0.05;
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i]; b.update(); let hitSomething = false;
        for (let p of planets) if (dist(b, p) < p.radius) hitSomething = true;

        // Bullet hits local player
        if (b.ownerId !== gameState.playerId && player.hp > 0 && player.iFrames <= 0) {
            if (dist(b, player) < player.radius + 15) {
                hitSomething = true; player.hp -= 34; playSound('hit'); triggerHaptic('hit');
                spawnExplosion(player.x, player.y, b.color, 25, 6, true); gameState.screenShake = 5;
                if (player.hp <= 0) { broadcast({ type: 'kill', killerId: b.ownerId, deadId: gameState.playerId }); die(); }
            }
        }

        // Local Player bullet hits UFO (Local player checks collision with UFOs to give themselves points)
        if (b.ownerId === gameState.playerId) {
            for (let u of ufos) {
                if (u.hp > 0 && dist(b, u) < u.radius + 15) {
                    hitSomething = true;
                    u.hp -= 34; // 3 hits to kill
                    playSound('hit');
                    spawnExplosion(u.x, u.y, b.color, 15, 6, true);
                    if (u.hp <= 0) {
                        broadcast({ type: 'kill', killerId: gameState.playerId, deadId: 'ufo', ufoId: u.id, pts: 2 }); // +2 kills
                        gameState.scores[gameState.playerId] += 2;
                        updateScoreboard();
                        spawnExplosion(u.x, u.y, '#ff00ff', 60, 10);
                        playSound('explosion');
                        ufos = ufos.filter(x => x.id !== u.id); // remove locally
                    }
                }
            }
        }

        if (hitSomething || b.life <= 0) { spawnExplosion(b.x, b.y, b.color, 15, 3, true); bullets.splice(i, 1); }
    }

    for (let i = meteorites.length - 1; i >= 0; i--) {
        let m = meteorites[i]; m.update();
        if (player.hp > 0 && player.iFrames <= 0 && dist(m, player) < m.radius + player.radius) {
            die(); broadcast({ type: 'kill', killerId: 'environment', deadId: gameState.playerId });
        }
        if (dist(m, gameState.camera) > 6000) meteorites.splice(i, 1);
    }
    for (let i = particles.length - 1; i >= 0; i--) { particles[i].update(); if (particles[i].life <= 0) particles.splice(i, 1); }
    for (let i = shockwaves.length - 1; i >= 0; i--) { shockwaves[i].update(); if (shockwaves[i].life <= 0) shockwaves.splice(i, 1); }
}

function draw() {
    ctx.fillStyle = '#050308'; ctx.fillRect(0, 0, width, height);
    ctx.save(); ctx.translate(width / 2, height / 2);
    if (gameState.screenShake > 0) {
        let sx = (Math.random() - 0.5) * gameState.screenShake; let sy = (Math.random() - 0.5) * gameState.screenShake;
        ctx.translate(sx, sy);
    }
    ctx.scale(gameState.camera.zoom, gameState.camera.zoom);
    ctx.translate(-gameState.camera.x, -gameState.camera.y);

    background.draw(ctx);
    for (let p of planets) p.draw(ctx);
    for (let m of meteorites) m.draw(ctx);
    for (let b of bullets) b.draw(ctx);
    for (let p of particles) p.draw(ctx);
    for (let s of shockwaves) s.draw(ctx);
    for (let u of ufos) u.draw(ctx);

    // Draw remote players
    for (let id in remotePlayers) {
        let rp = remotePlayers[id];
        if (rp.hp <= 0) continue;

        ctx.globalCompositeOperation = 'lighter';
        let glow = getGlow(32, '#fff', rp.color); ctx.drawImage(glow, rp.x - 32, rp.y - 32);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(rp.x, rp.y, 12, 0, Math.PI * 2); ctx.fill();

        if (rp.facing) {
            ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(rp.x + rp.facing.x * 7, rp.y + rp.facing.y * 7, 5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = rp.color; ctx.beginPath(); ctx.arc(rp.x + rp.facing.x * 8, rp.y + rp.facing.y * 8, 2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#fff'; ctx.font = '12px Outfit'; ctx.textAlign = 'center'; ctx.fillText(rp.name, rp.x, rp.y - 45);
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(rp.x - 15, rp.y - 35, 30, 4);
        ctx.fillStyle = '#f00'; ctx.fillRect(rp.x - 15, rp.y - 35, 30 * (rp.hp / 100), 4);
    }

    player.draw(ctx);
    ctx.restore();

    drawMinimap();
}

function drawMinimap() {
    let mui = document.getElementById('minimapUi');
    if (!mui) return;
    let mCtx = mui.getContext('2d');
    if (!mCtx) return;

    mCtx.clearRect(0, 0, 120, 120);
    mCtx.save();
    mCtx.translate(60, 60); // center of minimap
    let mapScale = 120 / 12000; // Map size is approx 12k
    mCtx.scale(mapScale, mapScale);

    // Planets
    mCtx.fillStyle = 'rgba(100,100,100,0.8)';
    for (let p of planets) { mCtx.beginPath(); mCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); mCtx.fill(); }

    // Enemies
    mCtx.fillStyle = '#f00';
    for (let id in remotePlayers) {
        if (remotePlayers[id].hp > 0) { mCtx.beginPath(); mCtx.arc(remotePlayers[id].x, remotePlayers[id].y, 250, 0, Math.PI * 2); mCtx.fill(); }
    }

    // UFOs
    mCtx.fillStyle = '#a0f';
    for (let u of ufos) {
        mCtx.beginPath(); mCtx.arc(u.x, u.y, 400, 0, Math.PI * 2); mCtx.fill();
    }

    // Self
    if (player.hp > 0) {
        mCtx.fillStyle = '#0f0';
        mCtx.beginPath(); mCtx.arc(player.x, player.y, 250, 0, Math.PI * 2); mCtx.fill();
    }
    mCtx.restore();
}

function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

buildLevel();
loop();
