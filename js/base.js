// --- Simulation params ---
let P = 15, I = 1, D = 300;
let STATIC_FORCE = -100;
const FPS = 60; // simulation framerate target
const renderDt = 1 / FPS;
const world = { xMin: -100, xMax: 100, yMin: -5, yMax: 25 };

// Target: A * sin(2π t / T)
let A = 80; // amplitude
let T = 10; // period seconds

let randomStartTime = 2 * Math.PI * Math.random();

function expectedFunction(t) {
    return A * Math.sin(2 * Math.PI * t / T);
}

class State {
    constructor(delta_t, starting_position = 0) {
        this.delta_t = delta_t;
        this.position = starting_position;
        this.velocity = 0;
    }
    update(acceleration) {
        // midpoint method
        this.velocity += acceleration * this.delta_t / 2;
        this.position += this.velocity * this.delta_t;
        this.velocity += acceleration * this.delta_t / 2;
    }
}

// --- Canvas / Frame like utilities ---
const scene = document.getElementById('scene');
const ctx = scene.getContext('2d');

function resizeCanvasForDPR(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const ro = new ResizeObserver(() => resizeCanvasForDPR(scene));
ro.observe(scene);

// World→Screen transform
function w2s(x, y) {

    x /= zoomFactor;
    y /= zoomFactor;

    const rect = scene.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    const sx = (x - world.xMin) / (world.xMax - world.xMin) * W;
    const sy = H - (y - world.yMin) / (world.yMax - world.yMin) * H;
    return [sx, sy];
}

function drawPath(points, strokeStyle, fill = false) {
    if (points.length === 0) return;
    ctx.beginPath();
    const [x0, y0] = w2s(points[0][0], points[0][1]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < points.length; i++) {
        const [x, y] = w2s(points[i][0], points[i][1]);
        ctx.lineTo(x, y);
    }
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (fill) {
        ctx.fillStyle = strokeStyle;
        ctx.globalAlpha = 0.08;
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function drawBoat(x, y, size = 15, color = 'lime') {
    const pts = [
        [x, y],
        [x + size, y],
        [x + .8 * size, y - .2 * size],
        [x - .8 * size, y - .2 * size],
        [x - size, y],
        [x, y],
        [x, y + size],
        [x + .6 * size, y + .6 * size],
        [x, y + .4 * size],
    ];
    drawPath(pts, color, false);
}

let zoomFactor = 1;
document.getElementById('zoomSlider').addEventListener('input', e => {
    zoomFactor = parseFloat(e.target.value);
});

function clearScene() {
    const r = scene.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    // horizon/water line at y=-3
    drawPath([[-1000, -3], [1000, -3]], '#4da3ff', false);
}

// --- Charts (Chart.js) ---
const timeWindow = 10; // seconds visible
const deltaCtx = document.getElementById('deltaChart').getContext('2d');
const posCtx = document.getElementById('posChart').getContext('2d');

const deltaChart = new Chart(deltaCtx, {
    type: 'line',
    data: {
        labels: [], datasets: [{
            label: 'Delta', data: [], tension: 0.15, borderWidth: 2
        }]
    },
    options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: true,
        scales: { x: { type: 'linear', title: { display: true, text: 'Time (s)' } }, y: { min: -120, max: 120, title: { display: true, text: 'Delta' } } },
        plugins: { legend: { display: false } }
    }
});

const posChart = new Chart(posCtx, {
    type: 'line',
    data: {
        labels: [], datasets: [
            { label: 'Target', data: [], borderWidth: 2 },
            { label: 'Current', data: [], borderWidth: 2 }
        ]
    },
    options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: true,
        scales: { x: { type: 'linear', title: { display: true, text: 'Time (s)' } }, y: { min: -120, max: 120, title: { display: true, text: 'Position' } } }
    }
});

// --- Simulation loop ---
let running = true;
let frameIndex = 0;
let currentState = new State(renderDt);
let runningTotalError = 0;
let lastDelta = null;

// Pre-roll 3 seconds render like Python (visual warmup)
let warmupStart = performance.now();

function reset() {
    frameIndex = 0;
    currentState = new State(renderDt);
    runningTotalError = 0;
    randomStartTime = 2 * Math.PI * Math.random();
    lastDelta = null;
    deltaChart.data.datasets[0].data = [];
    posChart.data.datasets[0].data = [];
    posChart.data.datasets[1].data = [];
    deltaChart.update(); posChart.update();
}

function loop(now) {
    if (!running) { requestAnimationFrame(loop); return; }

    const t = frameIndex * renderDt; // seconds
    frameIndex++;

    clearScene();

    // target & current positions
    const targetPos = expectedFunction(t + randomStartTime);
    drawBoat(targetPos, 0, 15, 'red');
    drawBoat(currentState.position, 0, 15, 'lime');

    // PID
    const delta = targetPos - currentState.position;
    runningTotalError += delta;
    if (lastDelta === null) lastDelta = delta;

    let output = P * delta;
    output += (delta - lastDelta) * D;
    output += runningTotalError * I;
    lastDelta = delta;

    if (I == 0) {
        runningTotalError = 0; // Special case in case the integral was set to zero, and there is a consistent steady state error. This keeps the integral term from going crazy when the integral term is re-added.
    }

    currentState.update(output + STATIC_FORCE);

    const startCut = Math.max(0, t - timeWindow);
    // Delta
    deltaChart.data.datasets[0].data.push({ x: t, y: delta });
    deltaChart.data.datasets[0].data = deltaChart.data.datasets[0].data.filter(p => p.x >= startCut);
    deltaChart.options.scales.x.min = startCut;
    deltaChart.options.scales.x.max = t;
    deltaChart.update();
    // Position
    posChart.data.datasets[0].data.push({ x: t, y: targetPos });
    posChart.data.datasets[1].data.push({ x: t, y: currentState.position });
    posChart.data.datasets[0].data = posChart.data.datasets[0].data.filter(p => p.x >= startCut);
    posChart.data.datasets[1].data = posChart.data.datasets[1].data.filter(p => p.x >= startCut);
    posChart.options.scales.x.min = startCut;
    posChart.options.scales.x.max = t;
    posChart.update();

    function fitAxis(chart) {
        let all = [];
        chart.data.datasets.forEach(ds => { all = all.concat(ds.data.map(p => p.y)); });

        if (all.length === 0) return;

        let min = Math.min(...all), max = Math.max(...all);

        max = Math.max(1, max);
        min = Math.min(-1, min);

        // Ensure correct signs. This step is kind redundant, but its more of a sanity check for me. 
        max = Math.abs(max);
        min = -Math.abs(min);

        if (max > -min) {
            min = - max;
        }

        if (-min > max) {
            max = -min;
        }

        chart.options.scales.y = { min: min, max: max };
    }
    fitAxis(deltaChart);
    fitAxis(posChart);

    // Readouts
    document.getElementById('deltaReadout').textContent = delta.toFixed(2);
    document.getElementById('posReadout').textContent = currentState.position.toFixed(2);
    document.getElementById('tgtReadout').textContent = targetPos.toFixed(2);

    requestAnimationFrame(loop);
}

// Warmup render (~3s) similar to matplotlib pre-loop
function warmup() {
    const t = (performance.now() - warmupStart) / 1000;
    clearScene();
    const pos = expectedFunction(randomStartTime);
    drawBoat(pos, 0, 15, 'red');
    drawBoat(currentState.position, 0, 15, 'lime');
    if (t < 1) { requestAnimationFrame(warmup); }
    else { requestAnimationFrame(loop); }
}

// Controls wiring
const Pslider = document.getElementById('P');
const Islider = document.getElementById('I');
const Dslider = document.getElementById('D');
const Wslider = document.getElementById('W');
const Aslider = document.getElementById('A');
const Tslider = document.getElementById('T');

function bind(slider, setter, readoutId) {
    const out = document.getElementById(readoutId);
    const upd = () => { setter(parseFloat(slider.value)); out.textContent = parseFloat(slider.value).toFixed(2); };
    slider.addEventListener('input', upd);
    upd();
}

bind(Pslider, v => P = v, 'Pval');
bind(Islider, v => I = v, 'Ival');
bind(Dslider, v => D = v, 'Dval');
bind(Wslider, v => STATIC_FORCE = v, 'Wval');

// amplitude & period have integer readouts
const Aval = document.getElementById('Aval');
const Tval = document.getElementById('Tval');
Aslider.addEventListener('input', () => { A = parseFloat(Aslider.value); Aval.textContent = Aslider.value; });
Tslider.addEventListener('input', () => { T = parseFloat(Tslider.value); Tval.textContent = Tslider.value; });

document.getElementById('reset').addEventListener('click', reset);
document.getElementById('pause').addEventListener('click', () => {
    running = !running;
    document.getElementById('pause').textContent = running ? 'Pause' : 'Resume';
    if (running) requestAnimationFrame(loop);
});

// Kickoff
resizeCanvasForDPR(scene);
warmup();

// Modal logic
const helpModal = document.getElementById('helpModal');
document.getElementById('helpBtn').onclick = () => { helpModal.style.display = 'block'; };
document.getElementById('closeHelp').onclick = () => { helpModal.style.display = 'none'; };
window.onclick = (e) => { if (e.target === helpModal) helpModal.style.display = 'none'; };