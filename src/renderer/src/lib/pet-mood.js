import { useEffect, useRef, useState } from 'preact/hooks';
import { useEvent, rpc } from './api.js';
import { bubbleText } from '../components/Pet.jsx';

/**
 * Was die Figur gerade tut – gemeinsam für Desktop und Overlay.
 * Ereignisse aus dem Hauptprozess: pet:input (neue Eingabe), pet:delta / pet:answer (Antwort, live bzw. fertig),
 * pet:signal (hört zu / spricht – kommt vom Hauptfenster), overlay:thinking / overlay:answer (Bildschirmfragen).
 * Die Blase bleibt stehen, bis die nächste Eingabe kommt.
 */
export function usePetMood({ max = 700 } = {}) {
  const [bubble, setBubble] = useState(null);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [flash, setFlash] = useState(null); // 'happy' | 'oops' kurz nach der Antwort
  const msg = useRef(null);
  const flashTimer = useRef(null);
  // ms = 0 → Pose bleibt bis zur nächsten Eingabe (z. B. „lean“ bei einer Rückfrage)
  const showFlash = (f, ms = 1800) => { clearTimeout(flashTimer.current); setFlash(f && f !== 'idle' ? f : null); if (ms > 0) flashTimer.current = setTimeout(() => setFlash(null), ms); };
  const showMood = (m, error) => { if (m?.pose) showFlash(m.pose, m.ms); else showFlash(error ? 'oops' : 'happy'); };
  const [think, setThink] = useState('think');
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const input = (d) => { msg.current = d?.messageId || null; clearTimeout(flashTimer.current); setFlash(null); setThink(d?.think === 'think_high' ? 'think_high' : 'think'); setBubble({ kind: 'think' }); };
  useEvent('pet:input', input);
  useEvent('overlay:thinking', input);
  useEvent('pet:delta', (d) => {
    if (msg.current && d.messageId && msg.current !== d.messageId) return;
    msg.current = d.messageId || msg.current;
    if (d.text) setBubble({ kind: 'text', text: bubbleText(d.text, max) });
  });
  useEvent('pet:answer', (d) => {
    if (msg.current && d.messageId && msg.current !== d.messageId) return;
    if (d.text) setBubble({ kind: 'text', text: bubbleText(d.text, max), error: !!d.error });
    showMood(d.mood, d.error);
  });
  useEvent('overlay:answer', (d) => { if (d?.answer) { setBubble({ kind: 'text', text: bubbleText(d.answer, max) }); showMood(d.mood, /^⚠️/.test(d.answer)); } });
  // Von dir geschlossen (× oder „mach die Sprechblase weg“) → closed zählt hoch (Desktop-Figur läuft zurück an den Rand)
  const [closed, setClosed] = useState(0);
  // Standby: Figur schläft, bis „Hey Jarvis“ oder eine neue Nachricht kommt
  const [standby, setStandby] = useState(false);
  useEffect(() => { rpc('voice.state').then((v) => setStandby(!!v?.standby)).catch(() => {}); }, []);
  useEvent('voice:standby', (d) => { setStandby(!!d.on); if (d.on) { msg.current = null; setBubble(null); } else showFlash('wave'); });
  const close = () => { msg.current = null; setBubble(null); clearTimeout(flashTimer.current); setFlash(null); setClosed((n) => n + 1); };
  useEvent('pet:clear', close);
  useEvent('pet:signal', (d) => {
    if (d.kind === 'speaking') setSpeaking(!!d.on);
    if (d.kind === 'listening') { setListening(!!d.on); if (d.on) { msg.current = null; setBubble(null); clearTimeout(flashTimer.current); setFlash(null); } }
  });

  const state = speaking ? 'talk' : standby ? 'sleep' : listening ? 'listen' : bubble?.kind === 'think' ? think : flash || 'idle';
  return { state, bubble, speaking, listening, flash, closed, close, standby, clear: () => setBubble(null) };
}
