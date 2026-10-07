'use strict';

// 背景闪电（写实向）：云对地主干 + 云内横闪，分形中点位移生成折线；
// 每道闪电有「主击 + 一次回击」的亮度包络（真实闪电是多次放电），
// 三层描边（深红外发光 / 橙红中层 / 白热细芯），落地点与云底各有一团闪光，
// destination-out 做余辉衰减，画布保持透明；关闭时 <html> 加 fx-off，页面纯黑。
(function () {
  const canvas = document.getElementById('bgFx');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, dpr = 1;
  let bolts = [], flashes = [];
  let raf = null, nextSpawn = 0, running = false, paused = false;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(W * dpr));
    canvas.height = Math.max(1, Math.floor(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // 递归中点位移：位移量随线段变短而减半，得到自然的分形折线
  function subdivide(x1, y1, x2, y2, disp, depth, out) {
    if (depth <= 0) { out.push([x2, y2]); return; }
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const off = (Math.random() - 0.5) * disp;
    const mx = (x1 + x2) / 2 + (-dy / len) * off;
    const my = (y1 + y2) / 2 + (dx / len) * off;
    subdivide(x1, y1, mx, my, disp * 0.52, depth - 1, out);
    subdivide(mx, my, x2, y2, disp * 0.52, depth - 1, out);
  }

  function makeBolt(x, y, angle, len, width, life, dim) {
    const ex = x + Math.cos(angle) * len;
    const ey = y + Math.sin(angle) * len;
    const pts = [[x, y]];
    subdivide(x, y, ex, ey, len * 0.16, 6, pts);
    return { pts: pts, born: performance.now(), life: life, w: width, dim: dim || 1, end: [ex, ey] };
  }

  // 亮度包络：主击快速衰减 + 中段一次回击，接近真实多次放电
  function alphaOf(b, t) {
    const age = (t - b.born) / b.life;
    if (age >= 1) return 0;
    const decay = Math.exp(-age * 3.2);
    const restrike = Math.exp(-Math.pow((age - 0.45) * 6, 2)) * 0.9;
    return Math.min(1, (decay + restrike) * b.dim);
  }

  function branchFrom(bolt) {
    const pts = bolt.pts;
    const i = 2 + Math.floor(Math.random() * Math.max(1, Math.floor(pts.length * 0.6)));
    const p = pts[i];
    const q = pts[Math.min(i + 1, pts.length - 1)];
    const base = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const ang = base + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.8);
    const seg = Math.sqrt(Math.pow(q[0] - p[0], 2) + Math.pow(q[1] - p[1], 2)) || 1;
    const total = pts.length * seg;
    bolts.push(makeBolt(p[0], p[1], ang, total * (0.12 + Math.random() * 0.18), bolt.w * 0.5, 160 + Math.random() * 160, 0.7));
  }

  function strike() {
    const now = performance.now();
    // 云对地主干：从顶部落下，略带倾角
    const x = W * (0.06 + Math.random() * 0.88);
    const y = -16 + Math.random() * H * 0.1;
    const angle = Math.PI / 2 + (Math.random() - 0.5) * 0.65;
    const len = H * (0.55 + Math.random() * 0.5);
    const b = makeBolt(x, y, angle, len, 0.9 + Math.random() * 0.7, 700 + Math.random() * 700, 1);
    bolts.push(b);
    const branches = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < branches; k++) branchFrom(b);
    if (Math.random() < 0.4) {
      const b2 = makeBolt(x + (Math.random() - 0.5) * 160, y, angle + (Math.random() - 0.5) * 0.5, len * (0.6 + Math.random() * 0.4), 0.8 + Math.random() * 0.5, 620 + Math.random() * 500, 0.8);
      bolts.push(b2);
      branchFrom(b2);
    }

    // 云底闪光 + 落地闪光 + 全屏微弱照亮
    flashes.push({ x: x, y: Math.max(0, y), born: now, life: 520, r: 190 + Math.random() * 160, s: 0.20 });
    if (b.end[1] < H + 40) flashes.push({ x: b.end[0], y: b.end[1], born: now + 30, life: 300, r: 70 + Math.random() * 70, s: 0.16 });
    flashes.push({ x: W / 2, y: H / 2, born: now, life: 220, r: Math.max(W, H) * 0.85, s: 0.045 });
  }

  function cloudFlash() {
    const now = performance.now();
    const y = H * (0.04 + Math.random() * 0.2);
    const x = W * (0.1 + Math.random() * 0.8);
    const dir = Math.random() < 0.5 ? 0 : Math.PI;
    const b = makeBolt(x, y, dir + (Math.random() - 0.5) * 0.5, W * (0.16 + Math.random() * 0.24), 0.8 + Math.random() * 0.5, 220 + Math.random() * 180, 0.55);
    bolts.push(b);
    if (Math.random() < 0.7) branchFrom(b);
    flashes.push({ x: x, y: y, born: now, life: 460, r: 160 + Math.random() * 140, s: 0.13 });
  }

  function strokePolyline(pts, color, width, blur) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.shadowColor = 'rgba(255,40,40,.9)';
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }

  function frame(t) {
    if (paused) {
      raf = null;
      return;
    }
    raf = requestAnimationFrame(frame);

    // 余辉：把上一帧按透明度擦掉一部分，画布仍是透明的，页面背景照旧透出
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    if (t > nextSpawn) {
      strike();
      if (Math.random() < 0.45) cloudFlash();
      nextSpawn = t + 900 + Math.random() * 1600;
    }

    flashes = flashes.filter((f) => t - f.born < f.life && t >= f.born);
    for (const f of flashes) {
      const k = 1 - (t - f.born) / f.life;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, 'rgba(255,96,72,' + (f.s * k).toFixed(3) + ')');
      g.addColorStop(0.45, 'rgba(220,30,30,' + (f.s * 0.4 * k).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(160,10,10,0)');
      ctx.shadowBlur = 0;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    bolts = bolts.filter((b) => t - b.born < b.life);
    for (const b of bolts) {
      const a = alphaOf(b, t);
      if (a <= 0.01) continue;
      strokePolyline(b.pts, 'rgba(255,32,32,' + (0.18 * a).toFixed(3) + ')', b.w * 6, 32 * a);
      strokePolyline(b.pts, 'rgba(255,66,44,' + (0.55 * a).toFixed(3) + ')', b.w * 2.4, 16 * a);
      strokePolyline(b.pts, 'rgba(255,246,240,' + (0.98 * a).toFixed(3) + ')', b.w * 0.9, 8 * a);
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
  }

  function start() {
    if (running) return;
    running = true;
    document.documentElement.classList.remove('fx-off');
    resize();
    nextSpawn = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf != null) cancelAnimationFrame(raf);
    raf = null;
    bolts = [];
    flashes = [];
    ctx.clearRect(0, 0, W, H);
    document.documentElement.classList.add('fx-off');
  }

  window.addEventListener('resize', () => { if (running) resize(); });

  /** 窗口看不见时逐帧停摆：画布没人看，没必要继续占 CPU/GPU。回到前台再续上。 */
  function setPaused(on) {
    const v = !!on;
    if (v === paused) return;
    paused = v;
    if (paused) {
      if (raf != null) cancelAnimationFrame(raf);
      raf = null;
      bolts = [];
      flashes = [];
      ctx.clearRect(0, 0, W, H);
    } else if (running && raf == null) {
      raf = requestAnimationFrame(frame);
    }
  }

  window.bgFx = {
    setEnabled(on) { if (on) start(); else stop(); },
    setPaused,
    get enabled() { return running; },
  };

  // 首屏默认按「关闭」的纯黑呈现，等设置读出来再决定是否开启动效
  document.documentElement.classList.add('fx-off');
})();
