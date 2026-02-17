/* =========================================================
   ZERO-COPY CINEMATIC VISUALIZER — script.js
   ========================================================= */

'use strict';

// ── State ──────────────────────────────────────────────────
let currentMode = 'traditional';
let animSpeed   = 1.0;
let running     = false;

// ── Canvas Particle Field ──────────────────────────────────
(function initCanvas () {
  const canvas = document.getElementById('particleCanvas');
  const ctx    = canvas.getContext('2d');
  let W, H, particles = [];

  function resize () {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function mkParticle () {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - .5) * .4,
      vy: (Math.random() - .5) * .4,
      r: Math.random() * 1.8 + .4,
      alpha: Math.random() * .5 + .1
    };
  }

  for (let i = 0; i < 120; i++) particles.push(mkParticle());

  function tick () {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,240,255,${p.alpha})`;
      ctx.fill();
    });
    requestAnimationFrame(tick);
  }
  tick();
})();

// ── Architecture Configurations ────────────────────────────
const MODES = {

  // ────────────────────────────────────────
  traditional: {
    label : 'Traditional Buffered I/O',
    layers: [
      { id:'disk',   name:'Disk Storage',  icon:'💾', hue:'#fb923c',
        gbg:'linear-gradient(135deg,#fb923c,#f59e0b)',
        glow:'rgba(251,163,60,.28)' },
      { id:'kernel', name:'Kernel Space',  icon:'🔧', hue:'#3b82f6',
        gbg:'linear-gradient(135deg,#3b82f6,#2563eb)',
        glow:'rgba(59,130,246,.28)' },
      { id:'user',   name:'User Space',    icon:'👤', hue:'#22c55e',
        gbg:'linear-gradient(135deg,#22c55e,#16a34a)',
        glow:'rgba(34,197,94,.28)' },
      { id:'app',    name:'Application',   icon:'⚡', hue:'#a855f7',
        gbg:'linear-gradient(135deg,#a855f7,#9333ea)',
        glow:'rgba(168,85,247,.28)' }
    ],
    steps: [
      { dot:'1', title:'Disk Read via DMA',
        desc:'The DMA controller transfers data from physical disk sectors into the Kernel Page Cache — no CPU involvement yet.' },
      { dot:'2', title:'Kernel → User Copy',
        desc:'The <code>read()</code> syscall fires. The CPU copies the data from the kernel buffer into the user-space buffer your application provided.' },
      { dot:'3', title:'User → Application Copy',
        desc:'Your application parses the raw bytes and copies substrings into its own data structures (std::string, structs, maps…).' },
      { dot:'4', title:'Final State — Three Copies',
        desc:'Three complete copies of the data now exist in RAM. Three allocations, three traversals of memory bandwidth, 75 % cache pollution.' }
    ],
    finalStats: { copies:3, cpu:1000, mem:64, cache:75 },
    explanation: makeExplanationTraditional()
  },

  // ────────────────────────────────────────
  mmap: {
    label : 'Zero-Copy via mmap()',
    layers: [
      { id:'disk',   name:'Disk Storage',           icon:'💾', hue:'#fb923c',
        gbg:'linear-gradient(135deg,#fb923c,#f59e0b)',
        glow:'rgba(251,163,60,.28)' },
      { id:'kernel', name:'Kernel Page Cache',       icon:'🔧', hue:'#3b82f6',
        gbg:'linear-gradient(135deg,#3b82f6,#2563eb)',
        glow:'rgba(59,130,246,.28)' },
      { id:'user',   name:'User Space (Mapped)',     icon:'🗺️', hue:'#22c55e',
        gbg:'linear-gradient(135deg,#22c55e,#16a34a)',
        glow:'rgba(34,197,94,.28)' }
    ],
    steps: [
      { dot:'1', title:'Disk → Kernel (DMA)',
        desc:'DMA loads data into the Kernel Page Cache.  Identical to the traditional path — this one copy is unavoidable.' },
      { dot:'2', title:'mmap() — Virtual Memory Mapping',
        desc:'The kernel modifies the page-table entries so that user-space virtual addresses point at the <em>same physical pages</em>. No bytes are copied.' },
      { dot:'3', title:'Final State — One Shared Copy',
        desc:'One copy in physical RAM, accessible from both kernel and user virtual address spaces. No explicit read() needed. 70 % fewer CPU cycles.' }
    ],
    finalStats: { copies:1, cpu:300, mem:32, cache:25 },
    explanation: makeExplanationMmap()
  },

  // ────────────────────────────────────────
  stringview: {
    label : 'Application-Level Zero-Copy',
    layers: [
      { id:'app', name:'Application Memory', icon:'⚡', hue:'#a855f7',
        gbg:'linear-gradient(135deg,#a855f7,#9333ea)',
        glow:'rgba(168,85,247,.28)' }
    ],
    steps: [
      { dot:'1', title:'Single Buffer Allocation',
        desc:'One contiguous buffer is allocated (e.g., directly from the network stack or mmap region). All data lives here.' },
      { dot:'2', title:'Create Non-Owning Views',
        desc:'<code>std::string_view</code> objects are constructed — just a pointer + length. No heap allocation, no memcpy, no new cache lines.' },
      { dot:'3', title:'Final State — Zero Copies',
        desc:'All views reference subregions of the same buffer. Parsing thousands of FIX messages costs ~50 cycles instead of ~1000.' }
    ],
    finalStats: { copies:0, cpu:50, mem:16, cache:5 },
    explanation: makeExplanationStringView()
  }
};

// ── Explanation Builders ───────────────────────────────────
function makeExplanationTraditional () {
  return `
  <h2 class="exp-h2">Traditional Buffered I/O — The Three-Copy Problem</h2>

  <div class="exp-section">
    <h3 class="exp-h3">What happens step by step</h3>
    <p>When a user-space program calls <span class="exp-hl">read(fd, buf, len)</span> the kernel must:</p>
    <ul>
      <li><strong>Copy 1 — DMA transfer:</strong> The disk controller writes data into the kernel page cache via Direct Memory Access.  The CPU is not involved, but this still uses memory bandwidth.</li>
      <li><strong>Copy 2 — Kernel → User (CPU):</strong> The kernel copies bytes from the page cache into the user-provided buffer.  This is a full <em>memcpy</em> inside the kernel, costing ≈ 300–400 CPU cycles per 16 KB.</li>
      <li><strong>Copy 3 — User → Application (CPU):</strong> The application parses the raw buffer and allocates new <code>std::string</code> objects, structs, or maps, duplicating data again.</li>
    </ul>
  </div>

  <div class="exp-section">
    <h3 class="exp-h3">Performance impact</h3>
    <p>
      <span class="exp-badge bad">3 memory copies</span>
      <span class="exp-badge bad">~1000 CPU cycles</span>
      <span class="exp-badge bad">64 KB total allocation</span>
      <span class="exp-badge bad">75 % cache pollution</span>
    </p>
    <ul>
      <li>Every copy walks the same bytes through the CPU cache, evicting other useful working data.</li>
      <li>Two context switches (user→kernel, kernel→user) per <code>read()</code> call.</li>
      <li>Memory bandwidth is consumed 3× for the same dataset.</li>
      <li>At 1 M messages/sec (typical FIX feed), this adds ~300 ns of pure copy overhead per message.</li>
    </ul>
  </div>

  <div class="exp-section">
    <h3 class="exp-h3">Why it's acceptable for most software but fatal for HFT</h3>
    <p>Ordinary applications never notice.  But at microsecond-latency targets a 300 ns copy is a catastrophic budget overrun. Every co-located exchange gateway and market-data handler must eliminate it.</p>
  </div>`;
}

function makeExplanationMmap () {
  return `
  <h2 class="exp-h2">Zero-Copy via mmap() — Shared Physical Pages</h2>

  <div class="exp-section">
    <h3 class="exp-h3">How it works</h3>
    <p><span class="exp-hl">mmap()</span> tells the kernel to map a file (or anonymous region) directly into the calling process's virtual address space.  The OS sets page-table entries so that the user's virtual addresses resolve to the <em>same physical RAM frames</em> already used by the kernel page cache.</p>
    <div class="exp-code">
<pre>int fd = open("ticks.bin", O_RDONLY);
struct stat s; fstat(fd, &s);

// Map — no read() call, no copy!
void* base = mmap(nullptr, s.st_size,
                  PROT_READ, MAP_PRIVATE, fd, 0);

// Access data directly through page table
const Tick* ticks = static_cast&lt;const Tick*&gt;(base);
processTick(ticks[0]);  // page-fault on first access → DMA
processTick(ticks[1]);  // already in cache → zero cost</pre>
    </div>
  </div>

  <div class="exp-section">
    <h3 class="exp-h3">Performance gains</h3>
    <p>
      <span class="exp-badge good">1 copy (vs 3)</span>
      <span class="exp-badge good">~300 CPU cycles (vs 1000)</span>
      <span class="exp-badge good">32 KB memory (vs 64 KB)</span>
      <span class="exp-badge good">25 % cache pollution (vs 75 %)</span>
    </p>
    <ul>
      <li><strong>70 % CPU reduction:</strong> Two expensive kernel-mode memcpy calls are eliminated.</li>
      <li><strong>50 % memory savings:</strong> Only one physical copy of the data exists in RAM.</li>
      <li><strong>Cache efficiency:</strong> Data lives in exactly one cache-line set, not three.</li>
      <li><strong>No syscall per record:</strong> After the initial mmap() call, reads are pure load instructions with no kernel transitions.</li>
    </ul>
  </div>

  <div class="exp-section">
    <h3 class="exp-h3">Trade-offs to understand</h3>
    <ul>
      <li><strong>Page-fault latency:</strong> First access to each 4 KB page triggers a fault (~1–2 µs).  Pre-fault with <code>mlock()</code> or <code>MAP_POPULATE</code> for deterministic latency.</li>
      <li><strong>TLB pressure:</strong> Large mappings can increase TLB misses.  Use huge pages (<code>MAP_HUGETLB</code>) to mitigate.</li>
      <li><strong>Not always faster for small files:</strong> Setup overhead makes mmap() slower than read() for files &lt; 4 KB.</li>
    </ul>
  </div>

  <div class="exp-section">
    <h3 class="exp-h3">Ideal use cases</h3>
    <ul>
      <li>Market-data replay from memory-mapped historical tick files (LMDB, custom ring-buffer files).</li>
      <li>Shared-memory IPC between the network gateway and the strategy engine.</li>
      <li>Database storage engines (SQLite WAL, RocksDB).</li>
    </ul>
  </div>`;
}

function makeExplanationStringView () {
  return `
  <h2 class="exp-h2">Application-Level Zero-Copy — std::string_view</h2>

  <div class="exp-section">
    <h3 class="exp-h3">The key insight</h3>
    <p><span class="exp-hl">std::string_view</span> (C++17) is an <em>immutable, non-owning</em> reference to a contiguous character sequence.  Its entire state is two machine words:</p>
    <div class="exp-code">
<pre>// Conceptual layout (16 bytes on 64-bit)
struct string_view {
    const char* data;   // 8 bytes — pointer into existing buffer
    size_t      size;   // 8 bytes — length of the view
    // owns nothing, allocates nothing, frees nothing
};</pre>
    </div>
    <p>Every substring operation returns a new <code>string_view</code> in O(1) time with zero heap allocation and zero memcpy.</p>
  </div>

  <div class="exp-section">
    <h3 class="exp-h3">Real-world FIX protocol parser</h3>
    <div class="exp-code">
<pre>// Network buffer received from the exchange
std::string_view buf{ raw_ptr, raw_len };   // wrap — no copy

// Split messages at '|' delimiter — O(1) each
auto split = [](std::string_view s, char d) {
    std::vector&lt;std::string_view&gt; out;
    for (size_t b = 0, e; b &lt; s.size(); b = e + 1) {
        e = s.find(d, b);
        if (e == std::string_view::npos) e = s.size();
        out.push_back(s.substr(b, e - b));
    }
    return out;   // views only — zero copies
};

auto msgs   = split(buf,    '|');  // "35=D|55=AAPL|44=150.25"
auto fields = split(msgs[0], '|');
// extract symbol, side, price as string_views → no allocation
auto symbol = extractTag(fields, "55");  // "AAPL" — no copy
auto price  = extractTag(fields, "44");  // "150.25" — no copy

double px = std::stod(price);  // only numeric parse allocates</pre>
    </div>
  </div>

  <div class="exp-section">
    <h3 class="exp-h3">Performance profile</h3>
    <p>
      <span class="exp-badge good">0 copies</span>
      <span class="exp-badge good">~50 CPU cycles total</span>
      <span class="exp-badge good">16 KB memory (buffer only)</span>
      <span class="exp-badge good">5 % cache pollution</span>
    </p>
    <ul>
      <li>All views share the same hot cache lines → extremely cache-friendly.</li>
      <li>No heap allocator calls → no lock contention, no fragmentation.</li>
      <li>Deterministic latency: no malloc() jitter in the critical path.</li>
      <li>Enables parsing 5–10 M FIX messages/sec on a single core.</li>
    </ul>
  </div>

  <div class="exp-section">
    <h3 class="exp-h3">Critical safety rules</h3>
    <ul>
      <li><strong>Never outlive the buffer:</strong> The view is a raw pointer. If the underlying <code>std::string</code> or buffer is destroyed, the view is dangling — UB.</li>
      <li><strong>Not null-terminated:</strong> Cannot be passed to C APIs expecting a null terminator without copying first.</li>
      <li><strong>Read-only:</strong> <code>string_view</code> cannot modify the underlying data.</li>
    </ul>
    <div class="exp-code">
<pre>// ❌ Dangling — UNDEFINED BEHAVIOUR
std::string_view bad() {
    std::string tmp = "ephemeral";
    return tmp;   // tmp destroyed here!
}

// ✅ Safe — buffer outlives all views
void process(const std::string& buf) {
    std::string_view v(buf);   // lives as long as buf
}</pre>
    </div>
  </div>

  <div class="exp-section">
    <h3 class="exp-h3">Equivalent in other languages</h3>
    <ul>
      <li><strong>Rust:</strong> <code>&amp;str</code> — ownership system statically prevents dangling.</li>
      <li><strong>Go:</strong> string slice (<code>s[i:j]</code>) — shares backing array.</li>
      <li><strong>Python:</strong> <code>memoryview</code> — zero-copy view over bytes/bytearray.</li>
      <li><strong>Java:</strong> <code>ByteBuffer.slice()</code> — shared backing store.</li>
    </ul>
  </div>`;
}

// ── DOM helpers ────────────────────────────────────────────
const $ = id => document.getElementById(id);

function setNarrator (badge, title, desc) {
  $('narratorBadge').textContent = badge;
  $('narratorTitle').textContent = title;
  $('narratorDesc').innerHTML    = desc;
}

function setMetrics (copies, cpu, mem, cache) {
  const slots = [
    ['mCopies', copies,     'mCopiesBar', copies / 3   * 100],
    ['mCPU',    cpu,        'mCPUBar',    cpu    / 1000 * 100],
    ['mMem',    mem + ' KB','mMemBar',    mem    / 64   * 100],
    ['mCache',  cache + '%','mCacheBar',  cache]
  ];
  slots.forEach(([vid, val, bid, pct]) => {
    const el = $(vid);
    el.textContent = val;
    el.classList.remove('pop');
    void el.offsetWidth;                 // force reflow
    el.classList.add('pop');
    $(bid).style.width = Math.min(pct, 100) + '%';
  });
}

function setTimeline (pct) {
  $('timelineFill').style.width = pct + '%';
}

function buildTimelineDots (count) {
  const wrap = $('timelineDots');
  wrap.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const d = document.createElement('div');
    d.className = 'timeline-dot';
    d.id = `tdot-${i}`;
    wrap.appendChild(d);
  }
}

function advanceDot (index) {
  const prev = $(`tdot-${index - 1}`);
  const curr = $(`tdot-${index}`);
  if (prev) { prev.classList.remove('active'); prev.classList.add('done'); }
  if (curr) curr.classList.add('active');
}

function finishDots (count) {
  for (let i = 0; i < count; i++) {
    const d = $(`tdot-${i}`);
    if (d) { d.classList.remove('active'); d.classList.add('done'); }
  }
}

// ── Delay (speed-scaled) ──────────────────────────────────
const wait = ms => new Promise(r => setTimeout(r, ms / animSpeed));

// ── Layer builder ─────────────────────────────────────────
function buildLayers (layers) {
  const stack = $('layerStack');
  stack.innerHTML = '';

  layers.forEach((cfg, i) => {
    const el = document.createElement('div');
    el.className = 'layer';
    el.id = `layer-${cfg.id}`;
    el.style.setProperty('--lc',  cfg.hue);
    el.style.setProperty('--lg',  cfg.glow);
    el.style.setProperty('--lbg', cfg.gbg);

    el.innerHTML = `
      <div class="layer-header">
        <div class="layer-badge">${cfg.icon}</div>
        <div>
          <div class="layer-name">${cfg.name}</div>
          <div class="layer-sub">Layer ${i + 1} of ${layers.length}</div>
        </div>
      </div>
      <div class="cpu-chip" id="cpu-${cfg.id}">
        <span class="cpu-spinner">⚙</span>
        <span class="cpu-chip-text" id="cpuText-${cfg.id}">Working…</span>
      </div>
      <div class="mem-area" id="mem-${cfg.id}"></div>
      <div class="cache-bar-row">
        <span class="cache-bar-label">L2 CACHE</span>
        <div class="cache-lines" id="cache-${cfg.id}"></div>
      </div>
    `;
    stack.appendChild(el);
  });
}

// ── Layer activation ──────────────────────────────────────
function activateLayer (id) {
  document.querySelectorAll('.layer').forEach(l => l.classList.remove('layer-active'));
  const el = $(`layer-${id}`);
  if (el) el.classList.add('layer-active');
}

function deactivateLayer (id) {
  const el = $(`layer-${id}`);
  if (el) el.classList.remove('layer-active');
}

// ── CPU chip ──────────────────────────────────────────────
function showCPU (id, label) {
  const chip = $(`cpu-${id}`);
  const txt  = $(`cpuText-${id}`);
  if (!chip) return;
  txt.textContent = label;
  chip.classList.add('show');
}
function hideCPU (id) {
  const chip = $(`cpu-${id}`);
  if (chip) chip.classList.remove('show');
}

// ── Cache lines ───────────────────────────────────────────
function fillCache (id, count) {
  const wrap = $(`cache-${id}`);
  if (!wrap) return;
  wrap.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const seg = document.createElement('div');
    seg.className = 'cache-line-seg';
    wrap.appendChild(seg);
    setTimeout(() => seg.classList.add('filled'), i * 90);
  }
}

// ── Memory Block ──────────────────────────────────────────
function spawnBlock (areaId, text, sizeLabel, shared = false) {
  const area  = $(`mem-${areaId}`);
  if (!area) return null;
  const block = document.createElement('div');
  block.className = 'mem-block' + (shared ? ' shared' : '');
  block.innerHTML = `${text}<div class="mem-block-size">${sizeLabel}</div>`;
  area.appendChild(block);
  requestAnimationFrame(() => requestAnimationFrame(() => block.classList.add('spawn')));
  return block;
}

// ── Floating Packet ───────────────────────────────────────
async function flyPacket (fromLayerId, toLayerId) {
  const fromEl = $(`layer-${fromLayerId}`);
  const toEl   = $(`layer-${toLayerId}`);
  const stage  = document.querySelector('.stage');
  if (!fromEl || !toEl || !stage) return;

  const fromR  = fromEl.getBoundingClientRect();
  const toR    = toEl.getBoundingClientRect();
  const stageR = stage.getBoundingClientRect();

  const packet = document.createElement('div');
  packet.className = 'data-packet';
  packet.style.left = '50%';
  packet.style.top  = (fromR.bottom - stageR.top - 48) + 'px';
  packet.innerHTML  = `
    <div class="packet-glow"></div>
    <div>📦</div>
    <div class="packet-sub">DATA</div>
  `;
  stage.appendChild(packet);

  const dur = 1100 / animSpeed;
  await wait(80);
  packet.style.transition = `top ${dur}ms cubic-bezier(.4,0,.2,1)`;
  packet.style.top = (toR.top - stageR.top - 48) + 'px';

  await wait(dur + 100);
  packet.remove();
}

// ── Transfer Arrow + Badge ────────────────────────────────
function showArrow (fromLayerId, toLayerId, type, label) {
  const fromEl = $(`layer-${fromLayerId}`);
  const toEl   = $(`layer-${toLayerId}`);
  const stage  = document.querySelector('.stage');
  if (!fromEl || !toEl || !stage) return;

  const fromR  = fromEl.getBoundingClientRect();
  const toR    = toEl.getBoundingClientRect();
  const stageR = stage.getBoundingClientRect();

  const height = toR.top - fromR.bottom;
  if (height < 4) return;

  const arrow = document.createElement('div');
  arrow.className = `tx-arrow type-${type} go`;
  arrow.style.top    = (fromR.bottom - stageR.top) + 'px';
  arrow.style.height = height + 'px';
  stage.appendChild(arrow);

  const badge = document.createElement('div');
  badge.className = `tx-badge type-${type}`;
  badge.textContent = label;
  badge.style.top  = (fromR.bottom - stageR.top + height / 2) + 'px';
  badge.style.transform = 'translateY(-50%)';
  stage.appendChild(badge);

  // Remove after animation
  setTimeout(() => { arrow.remove(); badge.remove(); }, 2200);
}

// ── Emit spark particles at a layer ───────────────────────
function emitSparks (layerId, color, count = 18) {
  const el = $(`layer-${layerId}`);
  if (!el) return;
  const r  = el.getBoundingClientRect();
  const pr = document.querySelector('.stage').getBoundingClientRect();

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.style.cssText = `
      position:absolute;
      width:5px; height:5px; border-radius:50%;
      background:${color};
      box-shadow:0 0 10px ${color};
      pointer-events:none;
      left:${r.left - pr.left + Math.random() * r.width}px;
      top:${r.top  - pr.top  + Math.random() * r.height}px;
      z-index:3000;
      animation: sparks .9s ease-out forwards;
    `;
    document.querySelector('.stage').appendChild(p);
    const tx = (Math.random() - .5) * 140;
    const ty = (Math.random() - .5) * 140;
    p.animate([
      { opacity:1, transform:'translate(0,0) scale(1)' },
      { opacity:0, transform:`translate(${tx}px,${ty}px) scale(0)` }
    ], { duration: 900, easing:'ease-out' }).onfinish = () => p.remove();
  }
}

// ── Traditional I/O Animation ─────────────────────────────
async function runTraditional () {
  const steps = MODES.traditional.steps;
  const total = steps.length;

  // Step 1 — Disk
  setNarrator(`STEP ${steps[0].dot}`, steps[0].title, steps[0].desc);
  advanceDot(0);
  setTimeline(10);
  activateLayer('disk');
  showCPU('disk', 'DMA Transfer');
  emitSparks('disk', '#fb923c', 22);
  spawnBlock('disk', 'Raw Data Block', '16 KB');
  fillCache('disk', 4);
  setMetrics(0, 80, 16, 10);

  await wait(1400);
  await flyPacket('disk', 'kernel');
  showArrow('disk', 'kernel', 'copy', '① COPY — DMA');
  await wait(800);

  // Step 2 — Kernel
  setNarrator(`STEP ${steps[1].dot}`, steps[1].title, steps[1].desc);
  advanceDot(1);
  setTimeline(35);
  deactivateLayer('disk');
  activateLayer('kernel');
  showCPU('kernel', 'CPU memcpy()');
  emitSparks('kernel', '#3b82f6', 22);
  spawnBlock('kernel', 'Kernel Buffer', '16 KB');
  fillCache('kernel', 7);
  setMetrics(1, 400, 32, 35);

  await wait(1400);
  await flyPacket('kernel', 'user');
  showArrow('kernel', 'user', 'copy', '② COPY — read()');
  await wait(800);

  // Step 3 — User
  setNarrator(`STEP ${steps[2].dot}`, steps[2].title, steps[2].desc);
  advanceDot(2);
  setTimeline(65);
  deactivateLayer('kernel');
  activateLayer('user');
  showCPU('user', 'CPU memcpy()');
  emitSparks('user', '#22c55e', 22);
  spawnBlock('user', 'User Buffer', '16 KB');
  fillCache('user', 9);
  setMetrics(2, 700, 48, 60);

  await wait(1400);
  await flyPacket('user', 'app');
  showArrow('user', 'app', 'copy', '③ COPY — parse()');
  await wait(800);

  // Step 4 — App
  setNarrator(`STEP ${steps[3].dot}`, steps[3].title, steps[3].desc);
  advanceDot(3);
  setTimeline(100);
  deactivateLayer('user');
  activateLayer('app');
  emitSparks('app', '#a855f7', 22);
  spawnBlock('app', 'Application Struct', '16 KB');
  fillCache('app', 12);
  hideCPU('disk'); hideCPU('kernel'); hideCPU('user');
  setMetrics(3, 1000, 64, 75);

  finishDots(total);
  setNarrator('COMPLETE', 'Three Copies — High Overhead',
    '3 full memory copies consumed 1000 CPU cycles and 64 KB of RAM. Cache is 75 % polluted.');
}

// ── mmap Animation ────────────────────────────────────────
async function runMmap () {
  const steps = MODES.mmap.steps;
  const total = steps.length;

  // Step 1 — Disk
  setNarrator(`STEP ${steps[0].dot}`, steps[0].title, steps[0].desc);
  advanceDot(0);
  setTimeline(10);
  activateLayer('disk');
  showCPU('disk', 'DMA Transfer');
  emitSparks('disk', '#fb923c', 22);
  spawnBlock('disk', 'Raw Data Block', '16 KB');
  fillCache('disk', 4);
  setMetrics(1, 100, 16, 10);

  await wait(1400);
  await flyPacket('disk', 'kernel');
  showArrow('disk', 'kernel', 'copy', '① COPY — DMA');
  await wait(800);

  // Step 2 — mmap
  setNarrator(`STEP ${steps[1].dot}`, steps[1].title, steps[1].desc);
  advanceDot(1);
  setTimeline(65);
  deactivateLayer('disk');
  activateLayer('kernel');
  emitSparks('kernel', '#3b82f6', 18);
  spawnBlock('kernel', 'Page Cache', '16 KB', true);  // shared block
  fillCache('kernel', 5);
  setMetrics(1, 200, 16, 15);

  await wait(1200);
  // No packet — mapping, not copying
  showArrow('kernel', 'user', 'map', '② MAPPING — mmap()');
  await wait(1200);

  activateLayer('user');
  emitSparks('user', '#22c55e', 18);
  spawnBlock('user', 'Page Cache (mapped)', '16 KB', true);  // same physical
  fillCache('user', 5);
  setMetrics(1, 300, 32, 25);

  await wait(1200);

  // Step 3 — Final
  setNarrator(`STEP ${steps[2].dot}`, steps[2].title, steps[2].desc);
  advanceDot(2);
  setTimeline(100);
  deactivateLayer('kernel');
  deactivateLayer('user');
  setMetrics(1, 300, 32, 25);

  finishDots(total);
  setNarrator('COMPLETE', 'One Shared Copy — 70 % Fewer Cycles',
    'A single physical page, accessible from both kernel and user space. No CPU-driven copy.');
}

// ── string_view Animation ─────────────────────────────────
async function runStringView () {
  const steps = MODES.stringview.steps;
  const total = steps.length;

  // Step 1 — Buffer
  setNarrator(`STEP ${steps[0].dot}`, steps[0].title, steps[0].desc);
  advanceDot(0);
  setTimeline(20);
  activateLayer('app');
  emitSparks('app', '#a855f7', 20);

  const area = $('mem-app');
  const bufBlock = document.createElement('div');
  bufBlock.id = 'mainBuf';
  bufBlock.className = 'mem-block';
  bufBlock.style.maxWidth = '680px';
  bufBlock.style.fontSize = '.88rem';
  bufBlock.innerHTML = `<strong>Buffer:</strong> AAPL,150.25,1000|MSFT,380.50,500|GOOGL,2800.00,250<div class="mem-block-size">~64 bytes</div>`;
  area.appendChild(bufBlock);
  requestAnimationFrame(() => requestAnimationFrame(() => bufBlock.classList.add('spawn')));
  fillCache('app', 3);
  setMetrics(0, 20, 16, 2);

  await wait(1600);

  // Step 2 — Views
  setNarrator(`STEP ${steps[1].dot}`, steps[1].title, steps[1].desc);
  advanceDot(1);
  setTimeline(60);

  const svArea = document.createElement('div');
  svArea.className = 'sv-area';
  area.appendChild(svArea);

  const views = [
    { label:'string_view #1',  text:'AAPL,150.25,1000',  delay:0 },
    { label:'string_view #2',  text:'MSFT,380.50,500',   delay:500 },
    { label:'string_view #3',  text:'GOOGL,2800.00,250', delay:1000 }
  ];

  for (const v of views) {
    await wait(v.delay);
    const ref = document.createElement('div');
    ref.className = 'sv-ref';
    ref.setAttribute('data-label', v.label);
    ref.textContent = v.text;
    svArea.appendChild(ref);
    requestAnimationFrame(() => requestAnimationFrame(() => ref.classList.add('appear')));
    emitSparks('app', '#ffbe0b', 8);
    setMetrics(0, 30 + views.indexOf(v) * 10, 16, 3 + views.indexOf(v));
  }

  await wait(1200);

  // Step 3 — Final
  setNarrator(`STEP ${steps[2].dot}`, steps[2].title, steps[2].desc);
  advanceDot(2);
  setTimeline(100);
  setMetrics(0, 50, 16, 5);

  finishDots(total);
  setNarrator('COMPLETE', 'Zero Copies — Maximum Efficiency',
    '0 allocations for substring extraction. 50 CPU cycles. All views share the same cache-hot buffer region.');
}

// ── Master execution ──────────────────────────────────────
async function executeAnimation () {
  if (running) return;
  running = true;

  const playBtn = $('playBtn');
  playBtn.disabled = true;

  // Hard reset
  $('layerStack').innerHTML  = '';
  $('timelineFill').style.width = '0%';
  setMetrics(0, 0, 0, 0);

  const cfg = MODES[currentMode];
  buildLayers(cfg.layers);
  buildTimelineDots(cfg.steps.length);

  setNarrator('LOADING…', cfg.label, 'Initializing architecture layers…');
  await wait(600);

  if (currentMode === 'traditional')  await runTraditional();
  else if (currentMode === 'mmap')    await runMmap();
  else                                await runStringView();

  playBtn.disabled = false;
  running = false;
}

// ── Mode selection ────────────────────────────────────────
function selectMode (mode) {
  if (running) return;
  currentMode = mode;

  document.querySelectorAll('.mode-card').forEach(c => {
    const pressed = c.dataset.mode === mode;
    c.classList.toggle('active', pressed);
    c.setAttribute('aria-pressed', pressed);
  });

  // Reset stage & show explanation
  $('layerStack').innerHTML = '';
  $('timelineFill').style.width = '0%';
  $('timelineDots').innerHTML   = '';
  setMetrics(0, 0, 0, 0);
  setNarrator('READY', MODES[mode].label,
    'Click "Execute Animation" to watch the full step-by-step chain.');

  $('explanationPanel').innerHTML = MODES[mode].explanation;
}

// ── Wire up controls ──────────────────────────────────────
document.querySelectorAll('.mode-card').forEach(card => {
  card.addEventListener('click', () => selectMode(card.dataset.mode));
});

$('playBtn').addEventListener('click', executeAnimation);

$('speedRange').addEventListener('input', e => {
  animSpeed = parseFloat(e.target.value);
  $('speedDisplay').textContent = animSpeed.toFixed(1) + '×';
});

// ── Init ──────────────────────────────────────────────────
selectMode('traditional');
