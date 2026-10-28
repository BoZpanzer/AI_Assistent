import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { rpc, useEvent } from './lib/api.js';
import { renderMarkdown } from './lib/markdown.js';
import { PetFigure, PetBubble, genderFor, petHeight, bubbleName } from './components/Pet.jsx';
import { usePetMood } from './lib/pet-mood.js';

/**
 * Desktop-Figur: durchsichtiger Streifen über der Taskleiste. Die Figur läuft herum, winkt, schläft ein und
 * spricht in einer Sprechblase, die bis zur nächsten Eingabe stehen bleibt. Klick → JARVIS öffnen,
 * ziehen → umsetzen, Rechtsklick → Menü. Der Rest des Fensters lässt die Maus durch.
 */
const SPEED = 70; // px/s

function Desk() {
  const [settings, setSettings] = useState(null);
  const mood = usePetMood();
  const [x, setX] = useState(() => Math.max(40, window.innerWidth - 320));
  const [facing, setFacing] = useState(-1);
  const [walk, setWalk] = useState(null); // { dur }
  const [idleAct, setIdleAct] = useState(null); // 'wave' | 'lean' | 'sleep'
  const [drag, setDrag] = useState(null);
  const lastActive = useRef(Date.now());
  const over = useRef(false);
  const lastClick = useRef(0);

  const load = () => rpc('settings.get').then(setSettings).catch(() => {});
  useEffect(() => { load(); }, []);
  useEvent('settings:changed', load);
  const cfg = settings?.pet || {};
  const size = Math.round(150 * Math.max(0.6, Math.min(1.6, cfg.size || 1)));
  const busy = !!(mood.bubble || mood.speaking || mood.listening || mood.flash);

  // Aktivität weckt die Figur
  useEffect(() => { if (busy) { lastActive.current = Date.now(); setIdleAct(null); setWalk(null); } }, [busy, mood.bubble?.kind]);

  // Herumlaufen / winken / einschlafen, solange nichts los ist
  useEffect(() => {
    let t;
    const tick = () => {
      t = setTimeout(tick, 6000 + Math.random() * 9000);
      if (busy || drag || over.current) return;
      if (Date.now() - lastActive.current > 8 * 60_000) { setIdleAct('sleep'); return; }
      if (idleAct === 'sleep') return;
      const r = Math.random();
      if (r < 0.2) { setIdleAct('wave'); setTimeout(() => setIdleAct((a) => (a === 'wave' ? null : a)), 2200); return; }
      if (r < 0.32) { setIdleAct('lean'); setTimeout(() => setIdleAct((a) => (a === 'lean' ? null : a)), 3500); return; } // kurz nach vorne beugen
      if (cfg.walk === false || r > 0.75) return;
      const max = window.innerWidth - size - 20;
      const target = Math.round(30 + Math.random() * Math.max(10, max - 30));
      const dur = Math.abs(target - x) / SPEED;
      if (dur < 0.6) return;
      setFacing(target < x ? -1 : 1);
      setWalk({ dur }); setX(target);
      setTimeout(() => setWalk(null), dur * 1000);
    };
    t = setTimeout(tick, 4000);
    return () => clearTimeout(t);
  }, [busy, drag, idleAct, x, size, cfg.walk]);

  // Fenstergröße geändert (Auflösung) → in den sichtbaren Bereich holen
  useEffect(() => { const f = () => setX((v) => Math.min(Math.max(10, v), window.innerWidth - size - 10)); addEventListener('resize', f); return () => removeEventListener('resize', f); }, [size]);

  const hover = (on) => { over.current = on; rpc('pet.mouse', { over: on }).catch(() => {}); if (on && idleAct === 'sleep') { lastActive.current = Date.now(); setIdleAct(null); } };
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { mx: e.clientX, x, moved: false };
    setWalk(null); setDrag(start);
    const move = (ev) => { const dx = ev.clientX - start.mx; if (Math.abs(dx) > 4) start.moved = true; setX(Math.min(Math.max(0, start.x + dx), window.innerWidth - size)); };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      setDrag(null); lastActive.current = Date.now();
      if (start.moved) return;
      // Doppelklick → JARVIS nach vorne holen; einfacher Klick → sie winkt
      if (Date.now() - lastClick.current < 380) { lastClick.current = 0; rpc('pet.open').catch(() => {}); return; }
      lastClick.current = Date.now();
      setIdleAct('wave'); setTimeout(() => setIdleAct((a) => (a === 'wave' ? null : a)), 1600);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const menu = (e) => { e.preventDefault(); rpc('pet.menu').catch(() => {}); };

  const state = mood.state !== 'idle' ? mood.state : drag ? 'wave' : walk ? 'walk' : idleAct || 'idle';
  const gender = genderFor(settings);
  // Blase neben dem Kopf – auf der Seite mit mehr Platz; der Strich zeigt Richtung Gesicht
  const bw = 330; const gap = 30;
  const figH = petHeight(gender, size);
  const headY = window.innerHeight - figH + figH * 0.12; // Gesichtshöhe (von oben)
  let side = x + size / 2 > window.innerWidth / 2 ? 'left' : 'right';
  if (side === 'left' && x - gap - bw < 8) side = 'right';
  if (side === 'right' && x + size + gap + bw > window.innerWidth - 8) side = 'left';
  // Bild ist breiter als die Figur (Haare) → Abstand zur sichtbaren Kontur
  const bx = side === 'left' ? Math.max(8, x + size * 0.06 - gap - bw) : Math.min(window.innerWidth - bw - 8, x + size * 0.94 + gap);
  const bottom = Math.max(8, window.innerHeight - headY - 34);
  return (
    <div class="pet-desk">
      {mood.bubble && (
        <div onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
          <PetBubble bubble={mood.bubble} html={renderMarkdown(mood.bubble.text || '')} onClose={mood.clear} side={side} name={bubbleName(settings)}
            style={{ left: bx + 'px', bottom: bottom + 'px', width: bw + 'px', '--link': gap + 'px' }} />
        </div>
      )}
      <div class={`pet-walker ${drag ? 'drag' : ''}`} style={{ left: x + 'px', transition: walk ? `left ${walk.dur}s linear` : 'none' }}>
        <PetFigure gender={gender} state={state} facing={facing} size={size} onPointerDown={down} onContextMenu={menu} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)} />
      </div>
    </div>
  );
}

render(<Desk />, document.getElementById('app'));
