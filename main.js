const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let width, height;
function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// --- GAME STATE & CONSTANTS ---
const gameState = {
    started: false,
    gameOver: false,
    camera: { x: 0, y: 0, zoom: 0.8 },
    keys: { left: false, right: false, up: false },
    mouse: { x: 0, y: 0, isDown: false }, // For desktop aiming
    screenShake: 0, // Effect
    playerId: Math.random().toString(36).substring(7),
    isHost: false,
    color: ['#00ffff', '#ff00ff', '#ffff00', '#ff5500', '#00ff88'][Math.floor(Math.random()*5)],
    scores: {}
};
gameState.scores[gameState.playerId] = 0;

// --- DOM ELEMENTS ---
const roomIdDisplay = document.getElementById('roomIdDisplay');
const netStatus = document.getElementById('netStatus');
const scoreboardDiv = document.getElementById('pvpScoreboard');

// --- PEER JS MULTIPLAYER ---
let peer = null;
let connections = [];
let remotePlayers = {};

function initPeer(isHosting, presetId = null) {
    netStatus.innerText = "Connectant...";
    peer = new Peer(presetId); 

    peer.on('open', (id) => {
        if(isHosting) {
            gameState.isHost = true;
            roomIdDisplay.innerText = id;
            document.getElementById('lobbyOptions').classList.add('hidden');
            document.getElementById('lobbyRoom').classList.remove('hidden');
            document.getElementById('startGameHostBtn').classList.remove('hidden');
            netStatus.innerText = "Hosting: " + id;
        } else {
            netStatus.innerText = "Preparat.";
        }
    });

    peer.on('connection', (conn) => {
        connections.push(conn);
        setupConnection(conn);
    });
}

function connectToPeer(targetId) {
    let conn = peer.connect(targetId);
    connections.push(conn);
    setupConnection(conn);
}

function setupConnection(conn) {
    conn.on('open', () => {
        conn.send({ type: 'init', id: gameState.playerId, color: gameState.color });
    });
    
    conn.on('data', (data) => {
        if(data.type === 'init') {
            remotePlayers[data.id] = { x: 0, y: 0, color: data.color, hp: 100, facing: {x:1, y:0} };
            gameState.scores[data.id] = 0;
            if(gameState.isHost && gameState.started) conn.send({type: 'start'});
            updateScoreboard();
        }
        else if(data.type === 'start') {
            startGame(); 
        }
        else if(data.type === 'sync') {
            if(!remotePlayers[data.id]) return;
            remotePlayers[data.id].x = data.x;
            remotePlayers[data.id].y = data.y;
            remotePlayers[data.id].hp = data.hp;
            remotePlayers[data.id].facing = data.facing;
            if(data.score !== undefined) {
                gameState.scores[data.id] = data.score;
                updateScoreboard();
            }
        }
        else if(data.type === 'shoot') {
            bullets.push(new Laser(data.x, data.y, data.vx, data.vy, data.color, data.id));
            playSound('shoot');
        }
        else if(data.type === 'kill') {
            if(data.killerId === gameState.playerId) {
                gameState.scores[gameState.playerId]++;
                updateScoreboard();
                showLore("Has destruït un enemic!", 2000);
            }
            if(data.deadId === gameState.playerId) {
                die();
            } else {
                let rp = remotePlayers[data.deadId];
                if(rp) {
                    spawnExplosion(rp.x, rp.y, rp.color, 60, 10);
                    spawnShockwave(rp.x, rp.y, rp.color);
                }
                playSound('explosion');
                gameState.screenShake = 10;
            }
        }
    });
}

function broadcast(data) {
    for(let c of connections) {
        if(c.open) c.send(data);
    }
}

setInterval(() => {
    if(gameState.started && peer && player.hp > 0) {
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

function updateScoreboard() {
    scoreboardDiv.innerHTML = '';
    let sorted = Object.keys(gameState.scores).sort((a,b) => gameState.scores[b] - gameState.scores[a]);
    for(let id of sorted) {
        let isMe = id === gameState.playerId;
        let color = isMe ? gameState.color : (remotePlayers[id] ? remotePlayers[id].color : '#fff');
        let div = document.createElement('div');
        div.style.color = color;
        div.style.textShadow = `0 0 5px ${color}`;
        div.style.background = 'rgba(0,0,0,0.5)';
        div.style.padding = '2px 8px';
        div.style.borderRadius = '4px';
        div.innerText = `${isMe ? '(Tu) ' : ''}Jugador ${id.substring(0,3)}: ${gameState.scores[id]} Kills`;
        scoreboardDiv.appendChild(div);
    }
}

// Lobby Buttons
document.getElementById('startBtn').addEventListener('click', () => { startGame(); });
document.getElementById('hostBtn').addEventListener('click', () => {
    let shortId = "ARENA-" + Math.floor(1000 + Math.random() * 9000);
    initPeer(true, shortId);
});
document.getElementById('joinBtn').addEventListener('click', () => {
    document.getElementById('lobbyOptions').classList.add('hidden');
    document.getElementById('joinRoom').classList.remove('hidden');
    initPeer(false); 
});
document.getElementById('connectBtn').addEventListener('click', () => {
    let targetId = document.getElementById('joinInput').value.trim();
    if(targetId) {
        connectToPeer(targetId);
        document.getElementById('joinStatus').innerText = "Esperant al Host...";
    }
});
document.getElementById('startGameHostBtn').addEventListener('click', () => {
    broadcast({type: 'start'});
    startGame();
});

function startGame() {
    if(gameState.started) return;
    
    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
    }
    
    document.getElementById('introScreen').classList.add('hidden');
    document.getElementById('ui').classList.remove('hidden');
    
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        document.getElementById('touchControls').classList.remove('hidden');
    }
    
    gameState.started = true;
    initAudio();
    updateScoreboard();
    respawn();
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
        if(!audioCtx) return;
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
    }
}

function triggerHaptic(type) {
    if (!navigator.vibrate) return;
    if (type === 'shoot') navigator.vibrate(15);
    if (type === 'hit') navigator.vibrate(50);
    if (type === 'heavy') navigator.vibrate([50, 50, 100]);
}

// --- INPUTS & TOUCH AIMING ---
// Desktop Mouse Aiming
window.addEventListener('mousemove', e => {
    gameState.mouse.x = e.clientX;
    gameState.mouse.y = e.clientY;
});
window.addEventListener('mousedown', e => {
    if(!gameState.started || player.hp <= 0) return;
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

// Touch Inputs
const joystickZone = document.getElementById('joystickZone');
const joystickKnob = document.getElementById('joystickKnob');
const btnJump = document.getElementById('btnJump');

let joystickActive = false;
let joystickCenter = {x:0, y:0};
let joystickTouchId = null;

joystickZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    let touch = e.changedTouches[0];
    joystickTouchId = touch.identifier;
    let rect = joystickZone.getBoundingClientRect();
    joystickCenter = { x: rect.left + rect.width/2, y: rect.top + rect.height/2 };
    joystickActive = true;
    handleJoystickMove(touch.clientX);
}, {passive: false});

joystickZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if(!joystickActive) return;
    for(let i=0; i<e.changedTouches.length; i++) {
        if(e.changedTouches[i].identifier === joystickTouchId) {
            handleJoystickMove(e.changedTouches[i].clientX);
        }
    }
}, {passive: false});

joystickZone.addEventListener('touchend', (e) => {
    e.preventDefault();
    for(let i=0; i<e.changedTouches.length; i++) {
        if(e.changedTouches[i].identifier === joystickTouchId) {
            joystickActive = false;
            joystickKnob.style.transform = `translate(-50%, -50%)`;
            gameState.keys.left = gameState.keys.right = false;
        }
    }
}, {passive: false});

function handleJoystickMove(clientX) {
    let dx = clientX - joystickCenter.x;
    let clampedX = Math.max(-40, Math.min(40, dx));
    joystickKnob.style.transform = `translate(calc(-50% + ${clampedX}px), -50%)`;
    if(clampedX < -10) { gameState.keys.left = true; gameState.keys.right = false; }
    else if(clampedX > 10) { gameState.keys.right = true; gameState.keys.left = false; }
    else { gameState.keys.left = gameState.keys.right = false; }
}

btnJump.addEventListener('touchstart', (e) => { e.preventDefault(); gameState.keys.up = true; btnJump.classList.add('active'); }, {passive: false});
btnJump.addEventListener('touchend', (e) => { e.preventDefault(); gameState.keys.up = false; btnJump.classList.remove('active'); }, {passive: false});

// Touch to Aim/Shoot Handler (Anywhere except joystick/buttons)
window.addEventListener('touchstart', (e) => {
    if(!gameState.started || player.hp <= 0) return;
    // Don't intercept if touching joystick or specific buttons
    for(let i=0; i<e.changedTouches.length; i++) {
        let touch = e.changedTouches[i];
        let target = document.elementFromPoint(touch.clientX, touch.clientY);
        if(target && (target.closest('#touchControls') || target.closest('button') || target.tagName === 'INPUT')) {
            continue; // It's UI, ignore for shooting
        }
        player.tryShoot(touch.clientX, touch.clientY);
    }
}, {passive: false});

// --- UI UTILS ---
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
    grad.addColorStop(0, coreColor);
    grad.addColorStop(0.2, outerColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx2.fillStyle = grad; ctx2.fillRect(0,0, radius*2, radius*2);
    glowCache[key] = canvas;
    return canvas;
}

// Convert screen coordinate to game world coordinate based on camera
function screenToWorld(sx, sy) {
    let wx = (sx - width/2) / gameState.camera.zoom + gameState.camera.x;
    let wy = (sy - height/2) / gameState.camera.zoom + gameState.camera.y;
    return {x: wx, y: wy};
}

// --- ENTITIES ---
const planets = [];
const meteorites = []; 
const bullets = [];
const particles = [];
const shockwaves = [];
let stars = [];

class Shockwave {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        this.radius = 1; this.maxRadius = 150;
        this.life = 1;
    }
    update() {
        this.radius += 8;
        this.life -= 0.05;
    }
    draw(ctx) {
        if(this.life <= 0) return;
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2);
        ctx.strokeStyle = this.color.replace(')', `, ${this.life})`).replace('#', '');
        // Hacky way if hex, let's just use globalAlpha
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 4 * this.life;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }
}
function spawnShockwave(x, y, color) { shockwaves.push(new Shockwave(x,y,color)); }

class Particle {
    constructor(x, y, vx, vy, color, life, size) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.color = color; this.life = this.maxLife = life; this.size = size;
        this.friction = 0.96;
    }
    update() { 
        this.vx *= this.friction; this.vy *= this.friction;
        this.x+=this.vx; this.y+=this.vy; 
        this.life--; this.size*=0.94; 
    }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
        ctx.fillStyle = this.color;
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
}

function spawnExplosion(x, y, color, count, speed = 5, isHit = false) {
    let base = isHit ? 10 : 30;
    for(let i=0; i<count; i++){
        let a = Math.random() * Math.PI * 2;
        let v = Math.random() * speed;
        particles.push(new Particle(x, y, Math.cos(a)*v, Math.sin(a)*v, color, base + Math.random()*20, 1 + Math.random()*3));
    }
}

class Background {
    constructor() {
        for(let i=0; i<150; i++) { 
            stars.push({
                x: (Math.random()-0.5)*15000, y: (Math.random()-0.5)*15000,
                z: Math.random() * 2 + 0.1, size: Math.random() * 2, twinkleSpeed: Math.random() * 0.05
            });
        }
    }
    draw(ctx) {
        const time = Date.now();
        ctx.fillStyle = '#fff';
        for(let s of stars) {
            let sx = s.x - (gameState.camera.x / s.z);
            let sy = s.y - (gameState.camera.y / s.z);
            if(sx < -10 || sx > width+10 || sy < -10 || sy > height+10) continue;
            let alpha = 0.3 + Math.sin(time * s.twinkleSpeed) * 0.3 + 0.4;
            ctx.globalAlpha = alpha;
            ctx.beginPath(); ctx.arc(sx, sy, s.size, 0, Math.PI*2); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

// Graphically Enhanced Planets
class Planet {
    constructor(x, y, radius, mass, style) {
        this.x = x; this.y = y; this.radius = radius; this.mass = mass;
        this.style = style;
        
        let styles = [
            {c:'#2a9d8f', s:'#264653', a:'rgba(32, 227, 178, 0.4)', rings: true},
            {c:'#e76f51', s:'#4a2511', a:'rgba(231, 111, 81, 0.3)', rings: false},
            {c:'#4cc9f0', s:'#1e1b4b', a:'rgba(76, 201, 240, 0.3)', rings: false},
            {c:'#ffd166', s:'#06d6a0', a:'rgba(255, 209, 102, 0.2)', rings: true}
        ];
        let st = styles[style%4];
        this.core = st.c; this.surface = st.s; this.atmosphereColor = st.a; this.hasRings = st.rings;
        
        this.rotation = Math.random() * Math.PI;
        this.craters = [];
        for(let i=0; i<5; i++) {
            this.craters.push({
                r: Math.random()*this.radius,
                a: Math.random()*Math.PI*2,
                size: 5 + Math.random()*15
            });
        }
    }
    draw(ctx) {
        ctx.save(); ctx.translate(this.x, this.y); 

        // Glowing Atmosphere Background
        ctx.globalCompositeOperation = 'lighter';
        let atm = getGlow(this.radius * 2.5, this.atmosphereColor, 'rgba(0,0,0,0)');
        ctx.drawImage(atm, -this.radius*2.5, -this.radius*2.5);
        ctx.globalCompositeOperation = 'source-over';

        // Planet Base Fill
        ctx.rotate(this.rotation);
        let grad = ctx.createRadialGradient(0, 0, 0, 0, 0, this.radius);
        grad.addColorStop(0, this.core); 
        grad.addColorStop(0.7, this.surface); 
        grad.addColorStop(1, '#050308'); // Dark rim
        
        ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI*2); 
        ctx.fillStyle = grad; ctx.fill();
        ctx.clip(); // Clip everything inside the sphere

        // Craters / Texture details
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        for(let c of this.craters) {
            let cx = Math.cos(c.a)*c.r;
            let cy = Math.sin(c.a)*c.r;
            ctx.beginPath(); ctx.arc(cx, cy, c.size, 0, Math.PI*2);
            ctx.fill(); ctx.stroke();
        }
        
        // Directional Shadow (simulating light from top-left)
        ctx.rotate(-this.rotation); // Undo rotation for lighting
        let shadow = ctx.createLinearGradient(-this.radius, -this.radius, this.radius, this.radius);
        shadow.addColorStop(0, 'rgba(255,255,255,0.1)'); // Highlight
        shadow.addColorStop(0.4, 'rgba(0,0,0,0)');
        shadow.addColorStop(0.8, 'rgba(0,0,0,0.6)'); // Core shadow
        shadow.addColorStop(1, 'rgba(0,0,0,0.9)');
        ctx.fillStyle = shadow;
        ctx.fillRect(-this.radius, -this.radius, this.radius*2, this.radius*2);
        
        ctx.restore();

        // Asteroid Rings
        if(this.hasRings) {
            ctx.save(); ctx.translate(this.x, this.y);
            // Tilt illusion
            ctx.scale(1, 0.3);
            ctx.rotate(this.rotation * 0.5);
            ctx.beginPath();
            ctx.arc(0, 0, this.radius * 1.6, 0, Math.PI*2);
            ctx.lineWidth = 15;
            ctx.strokeStyle = this.atmosphereColor;
            ctx.stroke();
            
            // Inner gap
            ctx.beginPath();
            ctx.arc(0, 0, this.radius * 1.8, 0, Math.PI*2);
            ctx.lineWidth = 5;
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.stroke();
            ctx.restore();
        }
    }
}

class Meteorite {
    constructor() {
        let angle = Math.random() * Math.PI*2;
        let distSpawn = 4000;
        this.x = gameState.camera.x + Math.cos(angle)*distSpawn;
        this.y = gameState.camera.y + Math.sin(angle)*distSpawn;
        let tx = gameState.camera.x + (Math.random()-0.5)*1500;
        let ty = gameState.camera.y + (Math.random()-0.5)*1500;
        let dir = normalize({x: tx-this.x, y: ty-this.y});
        
        let speed = 20 + Math.random()*20; // Increased speed for PvP chaos
        this.vx = dir.x * speed;
        this.vy = dir.y * speed;
        
        this.radius = 50 + Math.random()*60;
        this.rotation = 0;
        this.rotSpeed = (Math.random()-0.5)*0.1;
        
        // Procedural rock shape
        this.points = [];
        for(let i=0; i<10; i++) {
            this.points.push(this.radius * (0.7 + Math.random()*0.3));
        }
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        this.rotation += this.rotSpeed;
        if(Math.random()<0.4) { // Meteorite trail
            particles.push(new Particle(this.x + (Math.random()-0.5)*this.radius, this.y + (Math.random()-0.5)*this.radius, -this.vx*0.2, -this.vy*0.2, '#ff3300', 30, 6));
            particles.push(new Particle(this.x, this.y, -this.vx*0.1, -this.vy*0.1, '#550000', 40, 10)); // Smoke
        }
    }
    draw(ctx) {
        ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rotation);
        
        ctx.globalCompositeOperation = 'lighter';
        let glow = getGlow(this.radius*1.8, 'rgba(255,50,0,0.6)', 'rgba(0,0,0,0)');
        ctx.drawImage(glow, -this.radius*1.8, -this.radius*1.8);
        ctx.globalCompositeOperation = 'source-over';
        
        ctx.fillStyle = '#110500';
        ctx.beginPath();
        for(let i=0; i<this.points.length; i++) {
            let a = (i/this.points.length)*Math.PI*2;
            let r = this.points[i];
            if(i===0) ctx.moveTo(Math.cos(a)*r, Math.sin(a)*r);
            else ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
        }
        ctx.closePath(); ctx.fill();
        
        ctx.strokeStyle = '#ff3300'; ctx.lineWidth = 3; ctx.stroke();
        
        // Inner magma lines
        ctx.strokeStyle = '#ffaa00';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-this.radius*0.5, 0);
        ctx.lineTo(this.radius*0.5, 0);
        ctx.stroke();
        
        ctx.restore();
    }
}

class Laser {
    constructor(x, y, vx, vy, color, ownerId) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.color = color;
        this.ownerId = ownerId;
        this.life = 100; // Frames before expiring
        this.pastPos = []; // For motion blur trail line
    }
    update() {
        this.pastPos.push({x: this.x, y: this.y});
        if(this.pastPos.length > 5) this.pastPos.shift();
        
        this.x += this.vx; this.y += this.vy;
        this.life--;
        // Light sparking trail
        if(Math.random()<0.5) particles.push(new Particle(this.x, this.y, this.vx*0.1, this.vy*0.1, this.color, 15, 2));
    }
    draw(ctx) {
        if(this.pastPos.length < 2) return;
        ctx.globalCompositeOperation = 'lighter';
        
        ctx.beginPath();
        ctx.moveTo(this.pastPos[0].x, this.pastPos[0].y);
        ctx.lineTo(this.x, this.y);
        
        // Core white line
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.stroke();
        
        // Colored glow line
        ctx.beginPath();
        ctx.moveTo(this.pastPos[0].x, this.pastPos[0].y);
        ctx.lineTo(this.x, this.y);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 12;
        ctx.stroke();
        
        ctx.globalCompositeOperation = 'source-over';
    }
}

class Player {
    constructor(color) {
        this.color = color;
        this.radius = 12;
        this.trail = [];
        this.grounded = false;
        this.planet = null;
        
        this.moveSpeed = 0.35; // slightly faster combat
        this.jumpForce = 18; // higher jumps
        this.shootCooldown = 0;
        
        this.hp = 0; 
        this.facing = {x: 1, y: 0}; 
        this.iFrames = 0;
    }
    
    update(planets) {
        if(this.hp <= 0) return; 
        if(this.iFrames > 0) this.iFrames--;
        if(this.shootCooldown > 0) this.shootCooldown--;
        
        // Aiming (Mouse) Update (Only if desktop and interacting)
        // For mobile, aim is determined exactly at the moment of touching using `tryShoot`
        if(gameState.mouse.x !== 0 && !('ontouchstart' in window)) {
            let worldMouse = screenToWorld(gameState.mouse.x, gameState.mouse.y);
            let dir = normalize({x: worldMouse.x - this.x, y: worldMouse.y - this.y});
            if(dir.x !== 0 || dir.y !== 0) this.facing = dir;
        }

        let totalDir = {x:0, y:0};
        let minDist = Infinity;
        let nearestP = null;
        
        for(let p of planets) {
            let d = dist(this, p);
            if(d < minDist) { minDist = d; nearestP = p; }
            let pdist = Math.max(d, p.radius);
            if(pdist < p.radius * 6) {
                let force = (p.mass * 0.005) / (pdist * 0.05);
                force = Math.min(force, 0.7);
                let normal = normalize({x: p.x - this.x, y: p.y - this.y});
                totalDir.x += normal.x * force; totalDir.y += normal.y * force;
            }
        }
        
        this.planet = nearestP;
        let gravDir = {x:0,y:0};
        if(totalDir.x !== 0 || totalDir.y !== 0) gravDir = normalize(totalDir);
        this.grounded = false;
        
        if(this.planet && minDist <= this.planet.radius + this.radius) {
            this.grounded = true;
            let overlap = (this.planet.radius + this.radius) - minDist;
            if(overlap > 0) {
                let local = normalize({x: this.planet.x - this.x, y: this.planet.y - this.y});
                this.x -= local.x * overlap; this.y -= local.y * overlap;
                let dot = this.vx * local.x + this.vy * local.y;
                if(dot > 0) { this.vx -= local.x * dot; this.vy -= local.y * dot; }
            }
        }
        
        this.vx += totalDir.x; this.vy += totalDir.y;

        let upVec = {x: -gravDir.x, y: -gravDir.y};
        if(upVec.x===0 && upVec.y===0) upVec = {x:0, y:-1};
        let rightVec = {x: -upVec.y, y: upVec.x};
        
        if(this.grounded || minDist <= this.planet.radius + 150) {
            if(gameState.keys.left) { this.vx -= rightVec.x * this.moveSpeed; this.vy -= rightVec.y * this.moveSpeed; }
            if(gameState.keys.right) { this.vx += rightVec.x * this.moveSpeed; this.vy += rightVec.y * this.moveSpeed; }
        }
        
        if(gameState.keys.up && this.grounded) {
            this.vx += upVec.x * this.jumpForce; this.vy += upVec.y * this.jumpForce;
            this.grounded = false;
            triggerHaptic('light');
            spawnExplosion(this.x, this.y, '#fff', 20, 4);
            gameState.keys.up = false;
        }
        
        let friction = this.grounded ? 0.88 : 0.99;
        this.vx *= friction; this.vy *= friction;
        this.x += this.vx; this.y += this.vy;
        
        this.trail.push({x: this.x, y: this.y, grounded: this.grounded});
        if(this.trail.length > 20) this.trail.shift();
        
        // Out of bounds
        if(this.y > 6000 || this.y < -6000 || this.x > 8000 || this.x < -2000) die();
    }
    
    // NEW: tryShoot function handles specific coordinate targeting
    tryShoot(screenX, screenY) {
        if(this.hp <= 0 || this.shootCooldown > 0) return;
        
        this.shootCooldown = 12; // Adjusted fire rate
        
        let worldTarget = screenToWorld(screenX, screenY);
        let bDir = normalize({x: worldTarget.x - this.x, y: worldTarget.y - this.y});
        
        if(bDir.x !== 0 || bDir.y !== 0) {
            this.facing = bDir; // Update direction facing
        } else {
            bDir = this.facing;
        }
        
        let bSpeed = 25; // Faster lasers
        let bx = this.x + bDir.x * 20;
        let by = this.y + bDir.y * 20;
        let bvx = bDir.x * bSpeed;
        let bvy = bDir.y * bSpeed;
        
        bullets.push(new Laser(bx, by, bvx, bvy, this.color, gameState.playerId));
        playSound('shoot');
        triggerHaptic('shoot');
        
        broadcast({type: 'shoot', id: gameState.playerId, x: bx, y: by, vx: bvx, vy: bvy, color: this.color});
    }

    draw(ctx) {
        if(this.hp <= 0) return;
        if(this.iFrames > 0 && Math.floor(Date.now()/50)%2===0) return; // Blinking
        
        ctx.globalCompositeOperation = 'lighter';
        
        if(this.trail.length > 2) {
            ctx.beginPath(); ctx.moveTo(this.trail[0].x, this.trail[0].y);
            for(let i=1; i<this.trail.length; i++) ctx.lineTo(this.trail[i].x, this.trail[i].y);
            ctx.strokeStyle = this.color; ctx.lineWidth = this.radius*1.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = this.radius * 0.5; ctx.stroke();
        }
        
        let glow = getGlow(this.radius*5, '#fff', this.color);
        ctx.drawImage(glow, this.x - this.radius*5, this.y - this.radius*5);
        
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2); ctx.fill();
        
        // High-tech visor
        ctx.fillStyle = '#111';
        ctx.beginPath(); 
        ctx.arc(this.x + this.facing.x*7, this.y + this.facing.y*7, 5, 0, Math.PI*2); 
        ctx.fill();
        // Inner glowing eye
        ctx.fillStyle = this.color;
        ctx.beginPath(); 
        ctx.arc(this.x + this.facing.x*8, this.y + this.facing.y*8, 2, 0, Math.PI*2); 
        ctx.fill();
        
        ctx.globalCompositeOperation = 'source-over';
        
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(this.x - 15, this.y - 30, 30, 4);
        ctx.fillStyle = '#0f0';
        ctx.fillRect(this.x - 15, this.y - 30, 30 * (this.hp/100), 4);
    }
}

function die() {
    if(player.hp <= 0) return; 
    player.hp = 0;
    triggerHaptic('heavy');
    playSound('explosion');
    gameState.screenShake = 15;
    spawnExplosion(player.x, player.y, player.color, 80, 15);
    spawnShockwave(player.x, player.y, player.color);
    showLore("HAS MORT", 3000);
    
    setTimeout(() => { respawn(); }, 3000);
}

function respawn() {
    let p = planets[Math.floor(Math.random() * planets.length)];
    let angle = Math.random() * Math.PI*2;
    player.x = p.x + Math.cos(angle) * (p.radius + 100);
    player.y = p.y + Math.sin(angle) * (p.radius + 100); 
    player.vx = player.vy = 0;
    player.hp = 100;
    player.iFrames = 120; // 2 seconds invulnerability
    player.trail = [];
}

const background = new Background();
const player = new Player(gameState.color);

function buildLevel() {
    planets.push(new Planet(0,    0,     250, 600, 0)); // Has rings
    planets.push(new Planet(1000, -500,  180, 400, 1));
    planets.push(new Planet(2000, 300,   300, 900, 2));
    planets.push(new Planet(3000, -800,  150, 350, 0));
    planets.push(new Planet(4000, 100,  220, 500, 3)); // New style, rings
    planets.push(new Planet(1500, -1200, 200, 600, 2));
}

function update() {
    if(!gameState.started) return;

    if(gameState.screenShake > 0) gameState.screenShake *= 0.9;
    if(gameState.screenShake < 0.5) gameState.screenShake = 0;

    player.update(planets);
    
    // Server Authority logic isn't fully implemented, so for chaos, anyone can spawn visual meteorites locally
    if(Math.random() < 0.015) { 
        if (meteorites.length < 8) meteorites.push(new Meteorite());
    }

    if(player.hp > 0) {
        let speed = Math.hypot(player.vx, player.vy);
        let targetCamZoom = speed > 15 ? 0.55 : 0.7; // Zooms out more for chaotic combat
        gameState.camera.x += (player.x - gameState.camera.x) * 0.1;
        gameState.camera.y += (player.y - gameState.camera.y) * 0.1;
        gameState.camera.zoom += (targetCamZoom - gameState.camera.zoom) * 0.05;
    }

    for(let i=bullets.length-1; i>=0; i--) {
        let b = bullets[i];
        b.update();
        let hitSomething = false;

        for(let p of planets) {
            if(dist(b, p) < p.radius) hitSomething = true;
        }

        if(b.ownerId !== gameState.playerId && player.hp > 0 && player.iFrames <= 0) {
            if(dist(b, player) < player.radius + 15) {
                hitSomething = true;
                player.hp -= 34; // 3 hits to kill natively
                playSound('hit');
                triggerHaptic('hit');
                spawnExplosion(player.x, player.y, b.color, 25, 6, true);
                gameState.screenShake = 5;
                
                if(player.hp <= 0) {
                    broadcast({type: 'kill', killerId: b.ownerId, deadId: gameState.playerId});
                    die();
                }
            }
        }
        
        if(hitSomething || b.life <= 0) {
            spawnExplosion(b.x, b.y, b.color, 15, 3, true);
            bullets.splice(i, 1);
        }
    }

    for(let i=meteorites.length-1; i>=0; i--) {
        let m = meteorites[i];
        m.update();
        if(player.hp > 0 && player.iFrames <= 0 && dist(m, player) < m.radius + player.radius) {
            die();
            broadcast({type: 'kill', killerId: 'environment', deadId: gameState.playerId});
        }
        if(dist(m, gameState.camera) > 6000) meteorites.splice(i, 1);
    }

    for(let i=particles.length-1; i>=0; i--) {
        particles[i].update();
        if(particles[i].life <= 0) particles.splice(i, 1);
    }
    
    for(let i=shockwaves.length-1; i>=0; i--) {
        shockwaves[i].update();
        if(shockwaves[i].life <= 0) shockwaves.splice(i, 1);
    }
}

function draw() {
    ctx.fillStyle = '#050308'; // Slightly lighter deep space
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width/2, height/2);
    
    // Screen shake application
    if(gameState.screenShake > 0) {
        let sx = (Math.random()-0.5) * gameState.screenShake;
        let sy = (Math.random()-0.5) * gameState.screenShake;
        ctx.translate(sx, sy);
    }
    
    ctx.scale(gameState.camera.zoom, gameState.camera.zoom);
    ctx.translate(-gameState.camera.x, -gameState.camera.y);

    background.draw(ctx);
    
    for(let p of planets) p.draw(ctx);
    for(let m of meteorites) m.draw(ctx);
    for(let b of bullets) b.draw(ctx);
    for(let p of particles) p.draw(ctx);
    for(let s of shockwaves) s.draw(ctx);
    
    // Draw remote players
    for(let id in remotePlayers) {
        let rp = remotePlayers[id];
        if(rp.hp <= 0) continue; 
        
        ctx.globalCompositeOperation = 'lighter';
        let glow = getGlow(32, '#fff', rp.color);
        ctx.drawImage(glow, rp.x - 32, rp.y - 32);
        
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(rp.x, rp.y, 12, 0, Math.PI*2); ctx.fill();
        
        if(rp.facing) {
            ctx.fillStyle = '#111';
            ctx.beginPath(); ctx.arc(rp.x + rp.facing.x*7, rp.y + rp.facing.y*7, 5, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = rp.color;
            ctx.beginPath(); ctx.arc(rp.x + rp.facing.x*8, rp.y + rp.facing.y*8, 2, 0, Math.PI*2); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(rp.x - 15, rp.y - 30, 30, 4);
        ctx.fillStyle = '#f00';
        ctx.fillRect(rp.x - 15, rp.y - 30, 30 * (rp.hp/100), 4);
    }
    
    player.draw(ctx);
    ctx.restore();
}

function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

buildLevel();
loop();
