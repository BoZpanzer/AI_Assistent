import { useEffect, useRef } from 'preact/hooks';
import { getState } from '../lib/store.js';

/**
 * Holographic JARVIS orb — canvas 2D, pre-rendered glow sprites, adaptive FPS.
 * States: idle · listening · thinking · speaking (blend smoothly).
 * Pauses when hidden; throttles while gaming / reduced animation; static when off.
 */
const COLORS = {
  idle: [34, 211, 238], listening: [56, 225, 255], thinking: [99, 140, 255], speaking: [120, 240, 255],
};

function sprite(size, rgb) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `rgba(255,255,255,1)`); grd.addColorStop(0.25, `rgba(${rgb},0.9)`); grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  return c;
}

export function Orb({ size = 1, compact = false, onClick }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    let raf = 0; let last = 0; let t = 0; let alive = true;
    const blend = { r: 34, g: 211, b: 238, energy: 0.2, speed: 0.15, ring: 0 };
    const dotSprite = sprite(32, '160,240,255');
    const anim = () => getState().settings?.animations || 'full';
    const N = () => (anim() === 'reduced' || getState().game?.gaming ? 360 : 650);
    let pts = []; let nCached = 0;
    const build = (n) => {
      pts = []; const g = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) { const y = 1 - (i / (n - 1)) * 2; const r = Math.sqrt(1 - y * y); const th = g * i; pts.push([Math.cos(th) * r, y, Math.sin(th) * r]); }
      nCached = n;
    };
    const resize = () => {
      const dpr = Math.min(1.25, window.devicePixelRatio || 1);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, width * dpr); canvas.height = Math.max(1, height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

    const frame = (now) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const st = getState();
      const mode = anim();
      const hidden = document.hidden || !st.windowVisible;
      const fps = hidden ? 0 : mode === 'off' ? 0 : st.game?.gaming ? 12 : mode === 'reduced' ? 15 : (st.orb === 'idle' ? 20 : 45);
      if (!fps) { if (last !== -1) { drawStatic(); last = -1; } return; }
      if (now - last < 1000 / fps - 2) return;
      const dt = last > 0 ? Math.min(0.1, (now - last) / 1000) : 0.016;
      last = now; t += dt;
      if (N() !== nCached) build(N());
      const target = COLORS[st.orb] || COLORS.idle;
      const lvl = st.orb === 'speaking' ? st.outLevel : st.orb === 'listening' ? st.micLevel : 0;
      const te = st.orb === 'idle' ? 0.15 : st.orb === 'thinking' ? 0.55 : 0.35 + lvl * 0.9;
      const ts = st.orb === 'thinking' ? 0.9 : st.orb === 'speaking' ? 0.35 : st.orb === 'listening' ? 0.28 : 0.12;
      const k = Math.min(1, dt * 4);
      blend.r += (target[0] - blend.r) * k; blend.g += (target[1] - blend.g) * k; blend.b += (target[2] - blend.b) * k;
      blend.energy += (te - blend.energy) * Math.min(1, dt * 10); blend.speed += (ts - blend.speed) * k;
      blend.ring += dt * (0.4 + blend.energy);
      draw(t);
    };

    function drawStatic() {
      const { width: w, height: h } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w, h) * 0.3 * size;
      const g = ctx.createRadialGradient(w / 2, h / 2, R * 0.1, w / 2, h / 2, R * 1.3);
      g.addColorStop(0, 'rgba(170,240,255,0.9)'); g.addColorStop(0.5, 'rgba(34,211,238,0.35)'); g.addColorStop(1, 'rgba(34,211,238,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w / 2, h / 2, R * 1.3, 0, Math.PI * 2); ctx.fill();
    }

    function draw(time) {
      const { width: w, height: h } = canvas.getBoundingClientRect();
      const cx = w / 2, cy = h / 2;
      const base = Math.min(w, h) * (compact ? 0.36 : 0.27) * size;
      const R = base * (1 + blend.energy * 0.12);
      const col = `${blend.r | 0},${blend.g | 0},${blend.b | 0}`;
      ctx.clearRect(0, 0, w, h);

      // halo
      const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.1);
      halo.addColorStop(0, `rgba(${col},${0.32 + blend.energy * 0.25})`); halo.addColorStop(0.45, `rgba(${col},0.08)`); halo.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R * 2.1, 0, Math.PI * 2); ctx.fill();

      // crosshair lines + ticks
      if (!compact) {
        ctx.strokeStyle = `rgba(${col},0.35)`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - R * 2.6, cy); ctx.lineTo(cx - R * 1.35, cy); ctx.moveTo(cx + R * 1.35, cy); ctx.lineTo(cx + R * 2.6, cy);
        ctx.moveTo(cx, cy - R * 1.9); ctx.lineTo(cx, cy - R * 1.35); ctx.moveTo(cx, cy + R * 1.35); ctx.lineTo(cx, cy + R * 1.9); ctx.stroke();
        ctx.fillStyle = `rgba(${col},0.9)`;
        for (const [x, y] of [[cx - R * 2.6, cy], [cx + R * 2.6, cy], [cx - R * 1.6, cy], [cx + R * 1.6, cy], [cx, cy - R * 1.9], [cx, cy + R * 1.9]]) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
      }

      // rotating rings / arcs
      ctx.lineCap = 'round';
      const rings = [[1.22, 2.2, 0.55, 0.6], [1.36, 1.4, -0.35, 0.35], [1.5, 3.4, 0.22, 0.25]];
      rings.forEach(([rr, lw, sp, a], i) => {
        ctx.strokeStyle = `rgba(${col},${a + blend.energy * 0.3})`; ctx.lineWidth = lw;
        const off = time * sp * (1 + blend.speed * 2) + i;
        for (let s = 0; s < 3; s++) { ctx.beginPath(); ctx.arc(cx, cy, R * rr, off + s * 2.1, off + s * 2.1 + 1.1 + Math.sin(time + i) * 0.2); ctx.stroke(); }
      });
      // thin full rings
      ctx.strokeStyle = `rgba(${col},0.25)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.62, 0, Math.PI * 2); ctx.stroke();

      // listening/speaking ripples
      if (blend.energy > 0.3) {
        for (let i = 0; i < 2; i++) {
          const p = (blend.ring * 0.5 + i * 0.5) % 1;
          ctx.strokeStyle = `rgba(${col},${(1 - p) * 0.35 * blend.energy})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy, R * (1.05 + p * 0.9), 0, Math.PI * 2); ctx.stroke();
        }
      }

      // sphere core glow
      const core = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R);
      core.addColorStop(0, `rgba(220,252,255,${0.55 + blend.energy * 0.3})`); core.addColorStop(0.35, `rgba(${col},0.38)`); core.addColorStop(0.85, `rgba(10,60,90,0.25)`); core.addColorStop(1, `rgba(${col},0.05)`);
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

      // rotating point sphere
      const rotY = time * blend.speed * 1.6, rotX = 0.35 + Math.sin(time * 0.2) * 0.08;
      const cY = Math.cos(rotY), sY = Math.sin(rotY), cX = Math.cos(rotX), sX = Math.sin(rotX);
      const wobble = blend.energy * 0.06;
      ctx.globalCompositeOperation = 'lighter';
      const buckets = [[], [], [], []];
      for (let i = 0; i < pts.length; i++) {
        const [x, y, z] = pts[i];
        const x1 = x * cY + z * sY; const z1 = -x * sY + z * cY;
        const y2 = y * cX - z1 * sX; const z2 = y * sX + z1 * cX;
        const d = wobble ? 1 + wobble * Math.sin(time * 6 + i * 0.37) : 1;
        const depth = (z2 + 1) / 2;
        buckets[Math.min(3, (depth * 4) | 0)].push(cx + x1 * R * 0.96 * d, cy + y2 * R * 0.96 * d);
      }
      for (let b = 0; b < 4; b++) {
        const arr = buckets[b]; if (!arr.length) continue;
        ctx.globalAlpha = 0.1 + b * 0.27;
        const sz = 1.6 + b * 1.1; const s2 = sz * 2;
        for (let k = 0; k < arr.length; k += 2) ctx.drawImage(dotSprite, arr[k] - sz, arr[k + 1] - sz, s2, s2);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      // specular
      const spec = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.32);
      spec.addColorStop(0, `rgba(255,255,255,${0.5 + blend.energy * 0.4})`); spec.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = spec; ctx.beginPath(); ctx.arc(cx, cy, R * 0.32, 0, Math.PI * 2); ctx.fill();
    }

    build(N());
    raf = requestAnimationFrame(frame);
    const vis = () => { last = 0; };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', vis); };
  }, [size, compact]);
  return (
    <div class="orb-stage" style={{ height: '100%' }}>
      <canvas ref={ref} />
      {!compact && <><i class="corner tl" /><i class="corner tr" /><i class="corner bl" /><i class="corner br" /></>}
      {onClick && <div class="orb-hit" onClick={onClick} title="Sprachmodus starten/stoppen" />}
    </div>
  );
}
