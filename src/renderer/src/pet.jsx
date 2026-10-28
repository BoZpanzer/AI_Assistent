import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { rpc, useEvent } from './lib/api.js';
import { renderMarkdown } from './lib/markdown.js';
import { PetFigure, PetBubble, genderFor, petHeight, bubbleName } from './components/Pet.jsx';
import { usePetMood } from './lib/pet-mood.js';

/**
 * Desktop-Figur: durchsichtiger Streifen über der Taskleiste. Die Figur hat einen Stammplatz (Standard: rechter Rand; per Ziehen
 * nach links, rechts oder in die Mitte versetzbar – wird gemerkt). Am Rand läuft sie zum Reden ein Stück zur Seite (damit die
 * Blase Platz hat) und nach dem Schließen der Blase zurück. Dazwischen winkt sie, bummelt herum oder schläft ein.
 * Doppelklick → JARVIS öffnen, ziehen → sie zappelt in der Luft und plumpst am neuen Platz auf, Rechtsklick → Menü.
 * Maus: Nur die sichtbaren Pixel der Figur und die Blase nehmen Klicks an – alles andere geht an die Fenster darunter.
 */
const SPEED = 90; // px/s
const EDGE = 24; // Abstand zum Rand in Ruhe
const TALK_SHIFT = 300; // so weit läuft sie zum Reden nach links

/** Alpha-Werte der Figurbilder für den Klick-Test (gleicher Ursprung → Canvas lesbar). */
const alphaCache = new Map();
function alphaAt(img, fx, fy) {
  if (!img?.complete || !img.naturalWidth) return 255;
  let c = alphaCache.get(img.src);
  if (!c) {
    const cv = document.createElement('canvas'); cv.width = 200; cv.height = Math.round(200 * img.naturalHeight / img.naturalWidth);
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, cv.width, cv.height);
    try { c = { w: cv.width, h: cv.height, data: ctx.getImageData(0, 0, cv.width, cv.height).data }; } catch { c = { w: 0 }; }
    alphaCache.set(img.src, c);
  }
  if (!c.w) return 255;
  const x = Math.min(c.w - 1, Math.max(0, Math.floor(fx * c.w))); const y = Math.min(c.h - 1, Math.max(0, Math.floor(fy * c.h)));
  // kleiner Spielraum: Nachbarpixel mitzählen, damit dünne Stellen (Arme, Haare) greifbar bleiben
  let a = 0;
  for (const [dx, dy] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
    const xx = Math.min(c.w - 1, Math.max(0, x + dx)); const yy = Math.min(c.h - 1, Math.max(0, y + dy));
    a = Math.max(a, c.data[(yy * c.w + xx) * 4 + 3]);
  }
  return a;
}

function Desk() {
  const [settings, setSettings] = useState(null);
  const mood = usePetMood();
  const [x, setX] = useState(() => Math.max(40, window.innerWidth - 200));
  const [facing, setFacing] = useState(-1);
  const [walk, setWalk] = useState(null); // { dur }
  const [idleAct, setIdleAct] = useState(null); // 'wave' | 'lean' | 'sleep'
  const [drag, setDrag] = useState(null);
  const [tilt, setTilt] = useState(0); // Schräglage beim Ziehen (folgt der Mausbewegung)
  const [landed, setLanded] = useState(0); // Aufplumpsen nach dem Loslassen
  const lastActive = useRef(Date.now());
  const over = useRef(false);
  const lastClick = useRef(0);
  const walker = useRef(null); const bubbleBox = useRef(null);
  const walkTimer = useRef(null);

  const load = () => rpc('settings.get').then(setSettings).catch(() => {});
  useEffect(() => { load(); }, []);
  useEvent('settings:changed', load);
  // Fenster wird (wieder) gezeigt – Maus-Zustand zurücksetzen (sonst hält sie ihn vom Verstecken und lässt sich nicht mehr greifen)
  useEvent('pet:shown', () => { over.current = false; setDrag(null); load(); });
  const cfg = settings?.pet || {};
  const size = Math.round(150 * Math.max(0.6, Math.min(1.6, cfg.size || 1)));
  const edge = () => Math.max(10, window.innerWidth - size - EDGE);
  // Stammplatz: gemerkte Stelle (Anteil der Bildschirmbreite, Mitte der Figur) oder rechter Rand
  const home = () => (typeof cfg.homeX === 'number' ? Math.round(Math.min(Math.max(10, cfg.homeX * window.innerWidth - size / 2), window.innerWidth - size - 10)) : edge());
  const busy = !!(mood.bubble || mood.speaking || mood.listening || mood.flash || mood.standby);

  /** Zu einer Stelle laufen (Blickrichtung, Laufanimation, CSS-Übergang). */
  const walkTo = (target) => {
    const to = Math.round(Math.min(Math.max(10, target), window.innerWidth - size - 10));
    setX((from) => {
      const dur = Math.abs(to - from) / SPEED;
      clearTimeout(walkTimer.current);
      if (dur < 0.3) { setWalk(null); return to; }
      setFacing(to < from ? -1 : 1); setWalk({ dur }); setIdleAct(null);
      walkTimer.current = setTimeout(() => setWalk(null), dur * 1000);
      return to;
    });
  };

  // Aktivität weckt die Figur
  useEffect(() => { if (busy) { lastActive.current = Date.now(); setIdleAct(null); } }, [busy, mood.bubble?.kind]);
  // Blase erscheint → ein Stück vom Rand weg nach links, damit sie neben dem Kopf Platz hat
  const hadBubble = useRef(false);
  useEffect(() => {
    const has = !!mood.bubble;
    if (has && !hadBubble.current && !drag) setX((cur) => { if (cur > edge() - TALK_SHIFT + 40) setTimeout(() => walkTo(edge() - TALK_SHIFT), 0); return cur; });
    hadBubble.current = has;
  }, [!!mood.bubble]);
  // Blase von dir geschlossen (× oder „mach die Sprechblase weg“) → zurück an den Rand
  useEffect(() => { if (mood.closed) walkTo(home()); }, [mood.closed]);
  // Standby → an den Rand und schlafen
  useEffect(() => { if (mood.standby) walkTo(home()); }, [mood.standby]);

  // Bummeln / winken / einschlafen, solange nichts los ist
  useEffect(() => {
    let t;
    const tick = () => {
      t = setTimeout(tick, 7000 + Math.random() * 10000);
      if (busy || drag || over.current || walk) return;
      if (Date.now() - lastActive.current > 8 * 60_000) { setIdleAct('sleep'); return; }
      if (idleAct === 'sleep') return;
      const r = Math.random();
      if (r < 0.2) { setIdleAct('wave'); setTimeout(() => setIdleAct((a) => (a === 'wave' ? null : a)), 2200); return; }
      if (r < 0.32) { setIdleAct('lean'); setTimeout(() => setIdleAct((a) => (a === 'lean' ? null : a)), 3500); return; }
      if (cfg.walk === false || r > 0.6) return;
      // kleine Runde um den Stammplatz und wieder zurück
      const d = 80 + Math.random() * 260; const h = home();
      const out = h + d > window.innerWidth - size - 10 ? h - d : h - d < 10 ? h + d : (Math.random() < 0.5 ? h - d : h + d);
      walkTo(out);
      setTimeout(() => { if (!hadBubble.current && !over.current) walkTo(home()); }, (Math.abs(out - x) / SPEED + 4 + Math.random() * 6) * 1000);
    };
    t = setTimeout(tick, 5000);
    return () => clearTimeout(t);
  }, [busy, drag, idleAct, x, size, cfg.walk, walk]);

  // Auflösung geändert → wieder an den Rand
  useEffect(() => { const f = () => setX(() => home()); addEventListener('resize', f); return () => removeEventListener('resize', f); }, [size, cfg.homeX]);
  // Stammplatz geladen/geändert → dorthin laufen (nicht während sie redet)
  useEffect(() => { if (settings && !hadBubble.current && !drag) walkTo(home()); }, [cfg.homeX, !!settings]);

  // Maus nur über sichtbaren Pixeln (Figur) oder der Blase annehmen
  const setOver = (on) => {
    if (over.current === on) return;
    over.current = on; rpc('pet.mouse', { over: on }).catch(() => {});
    if (on && idleAct === 'sleep') { lastActive.current = Date.now(); setIdleAct(null); }
  };
  useEffect(() => {
    const move = (e) => {
      if (drag) return;
      const b = bubbleBox.current?.getBoundingClientRect();
      if (b && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom) return setOver(true);
      const el = walker.current?.querySelector('.pet-lift')?.firstElementChild; const r = el?.getBoundingClientRect();
      if (!r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return setOver(false);
      const img = el.querySelector('img');
      if (!img) return setOver(true); // Ersatzfigur (SVG): ganze Fläche
      let fx = (e.clientX - r.left) / r.width; const fy = (e.clientY - r.top) / r.height;
      if (getComputedStyle(el).transform.startsWith('matrix(-1')) fx = 1 - fx;
      setOver(alphaAt(img, fx, fy) > 40);
    };
    const leave = () => setOver(false);
    addEventListener('mousemove', move); document.addEventListener('mouseleave', leave);
    return () => { removeEventListener('mousemove', move); document.removeEventListener('mouseleave', leave); };
  }, [drag, idleAct]);

  const down = (e) => {
    if (e.button !== 0 || !over.current) return;
    e.preventDefault();
    const start = { mx: e.clientX, x, moved: false };
    clearTimeout(walkTimer.current); setWalk(null); setDrag(start);
    let lastX = e.clientX; let tiltT = null;
    const move = (ev) => {
      const dx = ev.clientX - start.mx; if (Math.abs(dx) > 4) start.moved = true;
      // Schräg in Zugrichtung baumeln, beruhigt sich, wenn die Maus stillsteht
      const v = ev.clientX - lastX; lastX = ev.clientX;
      if (start.moved) { setTilt(Math.max(-14, Math.min(14, -v * 1.2))); setFacing(v < 0 ? -1 : v > 0 ? 1 : facing); clearTimeout(tiltT); tiltT = setTimeout(() => setTilt(0), 120); }
      setX(Math.min(Math.max(0, start.x + dx), window.innerWidth - size));
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      clearTimeout(tiltT); setTilt(0);
      setDrag(null); lastActive.current = Date.now();
      if (start.moved) {
        // Aufplumpsen, kurz freuen – und den neuen Platz merken (links, rechts, Mitte …)
        setLanded((n) => n + 1); setIdleAct('happy'); setTimeout(() => setIdleAct((a) => (a === 'happy' ? null : a)), 1500);
        setX((cur) => { rpc('settings.update', { pet: { homeX: Math.round(((cur + size / 2) / window.innerWidth) * 1000) / 1000 } }).catch(() => {}); return cur; });
        return;
      }
      // Doppelklick → JARVIS nach vorne holen; einfacher Klick → sie winkt
      if (Date.now() - lastClick.current < 380) { lastClick.current = 0; rpc('pet.open').catch(() => {}); return; }
      lastClick.current = Date.now();
      setIdleAct('wave'); setTimeout(() => setIdleAct((a) => (a === 'wave' ? null : a)), 1600);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const menu = (e) => { if (!over.current) return; e.preventDefault(); rpc('pet.menu').catch(() => {}); };

  const state = drag?.moved || (drag && tilt) ? 'oops' : mood.standby && !mood.speaking ? (walk ? 'walk' : 'sleep') : ['talk', 'listen', 'think', 'think_high'].includes(mood.state) ? mood.state : walk ? 'walk' : mood.state !== 'idle' ? mood.state : drag ? 'wave' : idleAct || 'idle';
  const gender = genderFor(settings);
  // Blase neben dem Kopf – auf der Seite mit mehr Platz; die Spitze zeigt Richtung Gesicht
  const bw = mood.bubble?.kind === 'think' ? 120 : 330; const gap = 16; // „denkt …“-Blase nur so breit wie die Punkte
  const figH = petHeight(gender, size);
  const headY = window.innerHeight - figH + figH * 0.12; // Gesichtshöhe (von oben)
  let side = x + size / 2 > window.innerWidth / 2 ? 'left' : 'right';
  if (side === 'left' && x - gap - bw < 8) side = 'right';
  if (side === 'right' && x + size + gap + bw > window.innerWidth - 8) side = 'left';
  // Bild ist breiter als die Figur (Haare) → Abstand zur sichtbaren Kontur
  const bx = side === 'left' ? Math.max(8, x + size * 0.1 - gap - bw) : Math.min(window.innerWidth - bw - 8, x + size * 0.9 + gap);
  const bottom = Math.max(8, window.innerHeight - headY - 34);
  return (
    <div class="pet-desk">
      {mood.bubble && (
        <div ref={bubbleBox} class="pet-bubble-wrap" style={{ left: bx + 'px', bottom: bottom + 'px', width: bw + 'px', transition: walk ? `left ${walk.dur}s linear` : 'none' }}>
          <PetBubble bubble={mood.bubble} html={renderMarkdown(mood.bubble.text || '')} onClose={mood.close} side={side} name={bubbleName(settings)} />
        </div>
      )}
      <div ref={walker} class={`pet-walker ${drag ? 'drag' : ''}`} style={{ left: x + 'px', transition: walk ? `left ${walk.dur}s linear` : 'none' }}>
        <div key={landed} class={`pet-lift ${landed && !drag ? 'landed' : ''}`} style={{ '--tilt': tilt + 'deg' }}>
        <PetFigure gender={gender} state={state} facing={facing} size={size} onPointerDown={down} onContextMenu={menu} />
        </div>
      </div>
    </div>
  );
}

render(<Desk />, document.getElementById('app'));
