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
    keys: { left: false, right: false, up: false, shoot: false },
    playerId: Math.random().toString(36).substring(7),
    isHost: false,
    color: ['#00ffff', '#ff00ff', '#ffff00', '#ff5500', '#00ff88'][Math.floor(Math.random()*5)],
    scores: {} // { id: kills }
};
gameState.scores[gameState.playerId] = 0;

// --- DOM ELEMENTS ---
const roomIdDisplay = document.getElementById('roomIdDisplay');
const netStatus = document.getElementById('netStatus');
const scoreboardDiv = document.getElementById('pvpScoreboard');

// --- PEER JS MULTIPLAYER ---
let peer = null;
let connections = [];
let remotePlayers = {}; // { id: {x, y, color, hp, facing} }

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
            bullets.push(new Bullet(data.x, data.y, data.vx, data.vy, data.color, data.id));
            playSound('shoot');
        }
        else if(data.type === 'kill') {
            // Someone was killed
            if(data.killerId === gameState.playerId) {
                // I got a kill!
                gameState.scores[gameState.playerId]++;
                updateScoreboard();
                showLore("Has destruït un enemic!", 2000);
            }
            if(data.deadId === gameState.playerId) {
                // I died :(
                die();
            } else {
                // Someone else died, explode them
                let rp = remotePlayers[data.deadId];
                if(rp) spawnExplosion(rp.x, rp.y, rp.color, 50, 8);
                playSound('explosion');
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
    // Sort scores
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
    
    // Auto Fullscreen
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
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now); osc.stop(now + 0.2);
    } else if (type === 'hit') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.2);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now); osc.stop(now + 0.2);
    } else if (type === 'explosion') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(10, now + 0.5);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start(now); osc.stop(now + 0.5);
    }
}

function triggerHaptic(type) {
    if (!navigator.vibrate) return;
    if (type === 'light') navigator.vibrate(10);
    if (type === 'heavy') navigator.vibrate([50, 50, 100]);
}

// --- INPUTS ---
window.addEventListener('keydown', e => {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') gameState.keys.left = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') gameState.keys.right = true;
    if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'Space') gameState.keys.up = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') gameState.keys.shoot = true;
});
window.addEventListener('keyup', e => {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') gameState.keys.left = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') gameState.keys.right = false;
    if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'Space') gameState.keys.up = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') gameState.keys.shoot = false;
});

// Touch Inputs
const joystickZone = document.getElementById('joystickZone');
const joystickKnob = document.getElementById('joystickKnob');
const btnJump = document.getElementById('btnJump');
const btnShoot = document.getElementById('btnShoot'); // Renamed Dash to Shoot

let joystickActive = false;
let joystickCenter = {x:0, y:0};

joystickZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    let touch = e.changedTouches[0];
    let rect = joystickZone.getBoundingClientRect();
    joystickCenter = { x: rect.left + rect.width/2, y: rect.top + rect.height/2 };
    joystickActive = true;
    handleJoystickMove(touch.clientX);
}, {passive: false});
joystickZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if(joystickActive) handleJoystickMove(e.changedTouches[0].clientX);
}, {passive: false});
joystickZone.addEventListener('touchend', (e) => {
    e.preventDefault();
    joystickActive = false;
    joystickKnob.style.transform = `translate(-50%, -50%)`;
    gameState.keys.left = gameState.keys.right = false;
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

btnShoot.addEventListener('touchstart', (e) => { e.preventDefault(); gameState.keys.shoot = true; btnShoot.classList.add('active'); }, {passive: false});
btnShoot.addEventListener('touchend', (e) => { e.preventDefault(); gameState.keys.shoot = false; btnShoot.classList.remove('active'); }, {passive: false});

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
    const key = `${radius}_${coreColor}_${outerColor}`;
    if (glowCache[key]) return glowCache[key];
    let canvas = document.createElement('canvas');
    canvas.width = canvas.height = radius * 2;
    let ctx2 = canvas.getContext('2d');
    let grad = ctx2.createRadialGradient(radius, radius, 0, radius, radius, radius);
    grad.addColorStop(0, coreColor);
    grad.addColorStop(0.2, outerColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx2.fillStyle = grad; ctx2.fillRect(0,0, radius*2, radius*2);
    glowCache[key] = canvas;
    return canvas;
}

// --- ENTITIES ---
const planets = [];
const meteorites = []; // new hazards
const bullets = [];
const particles = [];
let stars = [];

class Particle {
    constructor(x, y, vx, vy, color, life, size) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.color = color; this.life = this.maxLife = life; this.size = size;
    }
    update() { this.x+=this.vx; this.y+=this.vy; this.life--; this.size*=0.96; }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
        ctx.fillStyle = this.color;
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
}

function spawnExplosion(x, y, color, count, speed = 5) {
    for(let i=0; i<count; i++){
        let a = Math.random() * Math.PI * 2;
        let v = Math.random() * speed;
        particles.push(new Particle(x, y, Math.cos(a)*v, Math.sin(a)*v, color, 30 + Math.random()*30, 2 + Math.random()*4));
    }
}

class Background {
    constructor() {
        for(let i=0; i<250; i++) { 
            stars.push({
                x: (Math.random()-0.5)*15000, y: (Math.random()-0.5)*15000,
                z: Math.random() * 2 + 0.1, size: Math.random() * 2, twinkleSpeed: Math.random() * 0.05
            });
        }
    }
    draw(ctx) {
        for(let p of planets) {
            let nx = p.x - gameState.camera.x * 0.1;
            let ny = p.y - gameState.camera.y * 0.1;
            let grad = ctx.createRadialGradient(nx, ny, 0, nx, ny, p.radius * 8);
            grad.addColorStop(0, p.atmosphereColor.replace('0.2', '0.05'));
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad; ctx.fillRect(nx - p.radius*8, ny - p.radius*8, p.radius*16, p.radius*16);
        }
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

class Planet {
    constructor(x, y, radius, mass, style) {
        this.x = x; this.y = y; this.radius = radius; this.mass = mass;
        let styles = [
            {c:'#2a9d8f', s:'#264653', a:'rgba(32, 227, 178, 0.2)'},
            {c:'#e76f51', s:'#4a2511', a:'rgba(231, 111, 81, 0.2)'},
            {c:'#4cc9f0', s:'#1e1b4b', a:'rgba(76, 201, 240, 0.2)'}
        ];
        let st = styles[style%3];
        this.core = st.c; this.surface = st.s; this.atmosphereColor = st.a;
        this.rotation = Math.random() * Math.PI;
    }
    draw(ctx) {
        ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rotation);
        let atm = getGlow(this.radius * 2, this.atmosphereColor, 'rgba(0,0,0,0)');
        ctx.drawImage(atm, -this.radius*2, -this.radius*2);
        let grad = ctx.createRadialGradient(0, 0, this.radius*0.2, 0, 0, this.radius);
        grad.addColorStop(0, this.core); grad.addColorStop(0.8, this.surface); grad.addColorStop(1, '#000');
        ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI*2); ctx.fillStyle = grad; ctx.fill();
        ctx.restore();
    }
}

class Meteorite {
    constructor() {
        // Spawn far outside camera view
        let angle = Math.random() * Math.PI*2;
        let distSpawn = 3000;
        this.x = gameState.camera.x + Math.cos(angle)*distSpawn;
        this.y = gameState.camera.y + Math.sin(angle)*distSpawn;
        
        // Aim roughly at center
        let tx = gameState.camera.x + (Math.random()-0.5)*1000;
        let ty = gameState.camera.y + (Math.random()-0.5)*1000;
        let dir = normalize({x: tx-this.x, y: ty-this.y});
        
        let speed = 15 + Math.random()*15;
        this.vx = dir.x * speed;
        this.vy = dir.y * speed;
        
        this.radius = 40 + Math.random()*40;
        this.rotation = 0;
        this.rotSpeed = (Math.random()-0.5)*0.1;
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        this.rotation += this.rotSpeed;
        if(Math.random()<0.3) {
            particles.push(new Particle(this.x + (Math.random()-0.5)*this.radius, this.y + (Math.random()-0.5)*this.radius, -this.vx*0.1, -this.vy*0.1, '#ff5500', 30, 4));
        }
    }
    draw(ctx) {
        ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rotation);
        let glow = getGlow(this.radius*1.5, 'rgba(255,85,0,0.8)', 'rgba(0,0,0,0)');
        ctx.drawImage(glow, -this.radius*1.5, -this.radius*1.5);
        ctx.fillStyle = '#110000';
        ctx.beginPath();
        // Jagged rock
        for(let i=0; i<8; i++) {
            let a = (i/8)*Math.PI*2;
            let r = this.radius * (0.8 + Math.random()*0.2);
            if(i===0) ctx.moveTo(Math.cos(a)*r, Math.sin(a)*r);
            else ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#ff3300'; ctx.lineWidth = 3; ctx.stroke();
        ctx.restore();
    }
}

class Bullet {
    constructor(x, y, vx, vy, color, ownerId) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.color = color;
        this.ownerId = ownerId;
        this.life = 120;
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        this.life--;
        particles.push(new Particle(this.x, this.y, 0, 0, this.color, 10, 2));
    }
    draw(ctx) {
        ctx.globalCompositeOperation = 'lighter';
        let glow = getGlow(15, '#fff', this.color);
        ctx.drawImage(glow, this.x - 15, this.y - 15);
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
        
        this.moveSpeed = 0.3;
        this.jumpForce = 15;
        this.shootCooldown = 0;
        
        this.hp = 0; // Starts dead, requires respawn()
        this.facing = {x: 1, y: 0}; // Default aim right
        this.iFrames = 0;
    }
    
    update(planets) {
        if(this.hp <= 0) return; // Dead players don't update physics
        if(this.iFrames > 0) this.iFrames--;
        if(this.shootCooldown > 0) this.shootCooldown--;
        
        // Physics
        let totalDir = {x:0, y:0};
        let minDist = Infinity;
        let nearestP = null;
        
        for(let p of planets) {
            let d = dist(this, p);
            if(d < minDist) { minDist = d; nearestP = p; }
            let pdist = Math.max(d, p.radius);
            if(pdist < p.radius * 6) {
                let force = (p.mass * 0.005) / (pdist * 0.05);
                force = Math.min(force, 0.6);
                let normal = normalize({x: p.x - this.x, y: p.y - this.y});
                totalDir.x += normal.x * force; totalDir.y += normal.y * force;
            }
        }
        
        this.planet = nearestP;
        let gravDir = {x:0,y:0};
        if(totalDir.x !== 0 || totalDir.y !== 0) gravDir = normalize(totalDir);
        this.grounded = false;
        
        // Collision with planets
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
        
        // Horizontal Move & Update Facing direction
        if(this.grounded || minDist <= this.planet.radius + 80) {
            if(gameState.keys.left) { 
                this.vx -= rightVec.x * this.moveSpeed; this.vy -= rightVec.y * this.moveSpeed; 
                this.facing = {x: -rightVec.x, y: -rightVec.y}; // aiming left
            }
            if(gameState.keys.right) { 
                this.vx += rightVec.x * this.moveSpeed; this.vy += rightVec.y * this.moveSpeed; 
                this.facing = {x: rightVec.x, y: rightVec.y}; // aiming right
            }
        }
        
        // Jump
        if(gameState.keys.up && this.grounded) {
            this.vx += upVec.x * this.jumpForce; this.vy += upVec.y * this.jumpForce;
            this.grounded = false;
            triggerHaptic('light');
            spawnExplosion(this.x, this.y, '#fff', 15, 3);
            gameState.keys.up = false;
        }
        
        // Shoot Energy Blasts
        if(gameState.keys.shoot && this.shootCooldown <= 0) {
            this.shootCooldown = 15; // Fire rate
            
            // Allow aiming slightly upwards if holding jump key while shooting? Or just shoot purely in facing dir.
            let bDir = {x: this.facing.x, y: this.facing.y};
            
            let bSpeed = 15;
            let bx = this.x + bDir.x * 20;
            let by = this.y + bDir.y * 20;
            let bvx = bDir.x * bSpeed;
            let bvy = bDir.y * bSpeed;
            
            bullets.push(new Bullet(bx, by, bvx, bvy, this.color, gameState.playerId));
            playSound('shoot');
            triggerHaptic('light');
            
            // Broadcast shoot
            broadcast({type: 'shoot', id: gameState.playerId, x: bx, y: by, vx: bvx, vy: bvy, color: this.color});
        }
        
        // Apply friction
        let friction = this.grounded ? 0.88 : 0.99;
        this.vx *= friction; this.vy *= friction;
        
        this.x += this.vx; this.y += this.vy;
        
        // Visual Trail
        this.trail.push({x: this.x, y: this.y});
        if(this.trail.length > 15) this.trail.shift();
        
        // Out of bounds death
        if(this.y > 5000 || this.y < -5000 || this.x > 8000 || this.x < -2000) {
            die();
        }
    }
    
    draw(ctx) {
        if(this.hp <= 0) return;
        if(this.iFrames > 0 && Math.floor(Date.now()/50)%2===0) return;
        
        ctx.globalCompositeOperation = 'lighter';
        
        // Trail
        if(this.trail.length > 2) {
            ctx.beginPath(); ctx.moveTo(this.trail[0].x, this.trail[0].y);
            for(let i=1; i<this.trail.length; i++) ctx.lineTo(this.trail[i].x, this.trail[i].y);
            ctx.strokeStyle = this.color; ctx.lineWidth = this.radius; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = this.radius * 0.4; ctx.stroke();
        }
        
        let glow = getGlow(this.radius*4, '#fff', this.color);
        ctx.drawImage(glow, this.x - this.radius*4, this.y - this.radius*4);
        
        // Draw character body
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2); ctx.fill();
        
        // Draw aim thruster/visor based on facing dir
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.arc(this.x + this.facing.x*6, this.y + this.facing.y*6, 4, 0, Math.PI*2); ctx.fill();
        
        // Health Bar Above player
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(this.x - 15, this.y - 25, 30, 4);
        ctx.fillStyle = '#0f0';
        ctx.fillRect(this.x - 15, this.y - 25, 30 * (this.hp/100), 4);
    }
}

function die() {
    if(player.hp <= 0) return; // Already dead
    player.hp = 0;
    triggerHaptic('heavy');
    playSound('explosion');
    spawnExplosion(player.x, player.y, player.color, 50, 8);
    showLore("Has mort. Reapareixent...", 3000);
    
    setTimeout(() => {
        respawn();
    }, 3000);
}

function respawn() {
    // Pick random planetary coordinate
    let p = planets[Math.floor(Math.random() * planets.length)];
    player.x = p.x;
    player.y = p.y - p.radius - 50; 
    player.vx = 0; player.vy = 0;
    player.hp = 100;
    player.iFrames = 90; // Invulnerable on spawn
    player.trail = [];
}

const background = new Background();
const player = new Player(gameState.color);

function buildLevel() {
    planets.push(new Planet(0, 0, 200, 500, 0));
    planets.push(new Planet(800, -400, 150, 400, 1));
    planets.push(new Planet(1600, 200, 250, 800, 2));
    planets.push(new Planet(2400, -600, 120, 300, 0));
    planets.push(new Planet(3200, 0, 180, 500, 1));
    planets.push(new Planet(1200, -1000, 200, 600, 2));
}

function update() {
    if(!gameState.started) return;

    player.update(planets);
    
    // Meteorite Spawning (Handled by Host to ensure sync, though they are purely visual/death triggers so local is fine for MVP)
    if(Math.random() < 0.01) { // 1% chance per frame per client -> chaos! (For real sync, host dictates)
        if (meteorites.length < 5) meteorites.push(new Meteorite());
    }

    // Camera follow
    if(player.hp > 0) {
        let speed = Math.hypot(player.vx, player.vy);
        let targetCamZoom = speed > 10 ? 0.6 : 0.8;
        gameState.camera.x += (player.x - gameState.camera.x) * 0.1;
        gameState.camera.y += (player.y - gameState.camera.y) * 0.1;
        gameState.camera.zoom += (targetCamZoom - gameState.camera.zoom) * 0.05;
    }

    // Bullets update
    for(let i=bullets.length-1; i>=0; i--) {
        let b = bullets[i];
        b.update();
        let hitSomething = false;

        // Check planet collisions
        for(let p of planets) {
            if(dist(b, p) < p.radius) hitSomething = true;
        }

        // Check player collision (only check my own player vs other bullets)
        if(b.ownerId !== gameState.playerId && player.hp > 0 && player.iFrames <= 0) {
            if(dist(b, player) < player.radius + 15) {
                // I got hit!
                hitSomething = true;
                player.hp -= 20; // 5 hits to kill
                playSound('hit');
                triggerHaptic('light');
                spawnExplosion(player.x, player.y, b.color, 15, 4);
                
                if(player.hp <= 0) {
                    // I died! Tell everyone who killed me.
                    broadcast({type: 'kill', killerId: b.ownerId, deadId: gameState.playerId});
                    die();
                }
            }
        }
        
        if(hitSomething || b.life <= 0) {
            spawnExplosion(b.x, b.y, b.color, 10, 2);
            bullets.splice(i, 1);
        }
    }

    // Update hazards
    for(let i=meteorites.length-1; i>=0; i--) {
        let m = meteorites[i];
        m.update();
        
        // If meteorite hits player
        if(player.hp > 0 && player.iFrames <= 0 && dist(m, player) < m.radius + player.radius) {
            // Squashed by meteorite!
            die();
            // Don't award kills for environmental deaths
            broadcast({type: 'kill', killerId: 'environment', deadId: gameState.playerId});
        }
        
        if(dist(m, gameState.camera) > 5000) meteorites.splice(i, 1);
    }

    for(let i=particles.length-1; i>=0; i--) {
        particles[i].update();
        if(particles[i].life <= 0) particles.splice(i, 1);
    }
}

function draw() {
    ctx.fillStyle = '#030308';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width/2, height/2);
    ctx.scale(gameState.camera.zoom, gameState.camera.zoom);
    ctx.translate(-gameState.camera.x, -gameState.camera.y);

    background.draw(ctx);
    
    for(let p of planets) p.draw(ctx);
    for(let m of meteorites) m.draw(ctx);
    for(let b of bullets) b.draw(ctx);
    for(let p of particles) p.draw(ctx);
    
    // Draw remote players
    for(let id in remotePlayers) {
        let rp = remotePlayers[id];
        if(rp.hp <= 0) continue; // Don't draw dead players
        
        ctx.globalCompositeOperation = 'lighter';
        let glow = getGlow(32, '#fff', rp.color);
        ctx.drawImage(glow, rp.x - 32, rp.y - 32);
        
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(rp.x, rp.y, 12, 0, Math.PI*2); ctx.fill();
        
        // Facing
        if(rp.facing) {
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.arc(rp.x + rp.facing.x*6, rp.y + rp.facing.y*6, 4, 0, Math.PI*2); ctx.fill();
        }
        
        ctx.globalCompositeOperation = 'source-over';
        
        // Remote HP bar
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(rp.x - 15, rp.y - 25, 30, 4);
        ctx.fillStyle = '#f00';
        ctx.fillRect(rp.x - 15, rp.y - 25, 30 * (rp.hp/100), 4);
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
