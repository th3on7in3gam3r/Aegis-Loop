/**
 * Hero "Aegis Loop" canvas — shield hub, repo nodes, scan arcs.
 * SVG placeholder crossfades in when canvas is ready (GitHub homepage pattern).
 */
(function () {
  const root = document.getElementById('heroLoop');
  if (!root) return;

  const canvas = root.querySelector('.hero-loop-canvas');
  const placeholder = root.querySelector('.hero-loop-placeholder');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!canvas || reduced) {
    root.classList.add('is-static');
    return;
  }

  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let dpr = 1;
  let t = 0;
  let running = false;
  let rafId = 0;
  let mouseX = 0.5;
  let mouseY = 0.5;

  const C = {
    violet: [124, 58, 237],
    violetLight: [139, 92, 246],
    green: [34, 197, 94],
    amber: [245, 158, 11],
    red: [239, 68, 68],
    ink: [18, 24, 43],
  };

  const LABELS = ['Code', 'Cloud', 'Attack', 'Protect', 'PR #482', 'api', 'auth'];
  const nodes = [];
  const arcs = [];

  function rgba(rgb, a) {
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  }

  function quadPoint(x0, y0, cx, cy, x1, y1, p) {
    const m = 1 - p;
    return {
      x: m * m * x0 + 2 * m * p * cx + p * p * x1,
      y: m * m * y0 + 2 * m * p * cy + p * p * y1,
    };
  }

  function layout() {
    const rect = root.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(rect.width, 1);
    h = Math.max(rect.height, 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = w * 0.5;
    const cy = h * 0.42;
    const radius = Math.min(w, h) * 0.34;
    const count = LABELS.length;

    nodes.length = 0;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      nodes.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        label: LABELS[i],
        pulse: Math.random() * Math.PI * 2,
        flash: 0,
        severity: i % 3 === 0 ? 'crit' : i % 3 === 1 ? 'warn' : 'ok',
      });
    }

    arcs.length = 0;
    for (let i = 0; i < count; i++) {
      arcs.push({
        from: i,
        to: 'center',
        progress: Math.random(),
        speed: 0.12 + Math.random() * 0.18,
      });
      arcs.push({
        from: i,
        to: (i + 2) % count,
        progress: Math.random(),
        speed: 0.08 + Math.random() * 0.12,
      });
    }
  }

  function center() {
    const parallaxX = (mouseX - 0.5) * 12;
    const parallaxY = (mouseY - 0.5) * 10;
    return { x: w * 0.5 + parallaxX, y: h * 0.42 + parallaxY };
  }

  function drawGrid(cx, cy, maxR) {
    ctx.strokeStyle = rgba(C.ink, 0.06);
    ctx.lineWidth = 1;
    for (let r = maxR * 0.35; r <= maxR; r += maxR * 0.22) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawScanSweep(cx, cy, maxR) {
    const angle = t * 0.0012;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(0, 0, maxR, 0);
    g.addColorStop(0, rgba(C.violetLight, 0));
    g.addColorStop(0.65, rgba(C.violetLight, 0.06));
    g.addColorStop(1, rgba(C.violetLight, 0.14));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, maxR, -0.32, 0.32);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawArc(from, to, progress) {
    const { x: cx, y: cy } = center();
    const x1 = from === 'center' ? cx : nodes[from].x;
    const y1 = from === 'center' ? cy : nodes[from].y;
    const x2 = to === 'center' ? cx : nodes[to].x;
    const y2 = to === 'center' ? cy : nodes[to].y;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - Math.min(w, h) * 0.08;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(mx, my, x2, y2);

    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, rgba(C.violetLight, 0.04));
    grad.addColorStop(0.5, rgba(C.violetLight, 0.32));
    grad.addColorStop(1, rgba(C.violet, 0.06));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 9]);
    ctx.lineDashOffset = -t * 0.035;
    ctx.stroke();
    ctx.setLineDash([]);

    const dot = quadPoint(x1, y1, mx, my, x2, y2, progress % 1);
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = rgba(C.violetLight, 0.85);
    ctx.fill();
  }

  function drawShield(cx, cy, scale) {
    const pulse = 1 + Math.sin(t * 0.002) * 0.035;
    const s = scale * pulse;

    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 2);
    glow.addColorStop(0, rgba(C.violet, 0.22));
    glow.addColorStop(0.55, rgba(C.violetLight, 0.08));
    glow.addColorStop(1, rgba(C.violet, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s / 42, s / 42);
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.lineTo(22, -14);
    ctx.lineTo(22, 8);
    ctx.quadraticCurveTo(0, 28, -22, 8);
    ctx.lineTo(-22, -14);
    ctx.closePath();
    ctx.fillStyle = rgba(C.violet, 0.14);
    ctx.strokeStyle = rgba(C.violetLight, 0.55);
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = rgba(C.violetLight, 0.75);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, -2, 10, -Math.PI * 0.15, Math.PI * 1.12);
    ctx.stroke();
    ctx.restore();
  }

  function drawNodes() {
    nodes.forEach((n) => {
      if (n.flash > 0) n.flash -= 0.018;
      if (Math.random() < 0.0018) n.flash = 1;

      let rgb = C.violetLight;
      if (n.flash > 0) {
        if (n.severity === 'crit') rgb = C.red;
        else if (n.severity === 'warn') rgb = C.amber;
        else rgb = C.green;
      }

      const baseR = 4.5 + Math.sin(t * 0.028 + n.pulse) * 1.2;
      const glowR = baseR + n.flash * 7;

      ctx.beginPath();
      ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, 0.12 + n.flash * 0.28);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(n.x, n.y, baseR, 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, 0.55 + n.flash * 0.35);
      ctx.fill();
      ctx.strokeStyle = rgba(rgb, 0.75);
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.font = '500 10px "IBM Plex Mono", monospace';
      ctx.fillStyle = rgba(C.ink, 0.42);
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.y + 17);
    });
  }

  function frame() {
    if (!running) return;
    t += 1;
    ctx.clearRect(0, 0, w, h);

    const { x: cx, y: cy } = center();
    const maxR = Math.min(w, h) * 0.44;

    drawGrid(cx, cy, maxR);
    drawScanSweep(cx, cy, maxR);

    arcs.forEach((a) => {
      a.progress += a.speed * 0.007;
      drawArc(a.from, a.to, a.progress);
    });

    drawShield(cx, cy, 42);
    drawNodes();

    rafId = requestAnimationFrame(frame);
  }

  function fadeToCanvas() {
    root.classList.add('is-live');
    if (placeholder) placeholder.setAttribute('aria-hidden', 'true');
  }

  function start() {
    if (running) return;
    layout();
    running = true;
    fadeToCanvas();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => (e.isIntersecting ? start() : stop()));
    },
    { threshold: 0.12, rootMargin: '40px' },
  );
  io.observe(root);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (root.getBoundingClientRect().bottom > 0 && root.getBoundingClientRect().top < window.innerHeight) {
      start();
    }
  });

  const visual = root.closest('.hero-visual');
  if (visual) {
    visual.addEventListener('pointermove', (e) => {
      const r = visual.getBoundingClientRect();
      mouseX = (e.clientX - r.left) / r.width;
      mouseY = (e.clientY - r.top) / r.height;
    });
    visual.addEventListener('pointerleave', () => {
      mouseX = 0.5;
      mouseY = 0.5;
    });
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (running) layout();
    }, 120);
  });
})();
