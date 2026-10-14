'use strict';
const { spawn } = require('node:child_process');
const { id, nowIso } = require('../../core/util');
const log = require('../../core/logger').scope('ac');

/**
 * Assetto Corsa – Fahranalyse aus der offiziellen Telemetrie (Shared Memory „acpmf_*“ von Kunos).
 * Nur lesend über PowerShell/.NET (kein Eingriff ins Spiel), 10 Messungen pro Sekunde, nur solange AC läuft.
 * Pro Runde: Zeit, Sektoren, Geschwindigkeit/Gas/Bremse über die Strecke → Konstanz und wo du gegenüber
 * deiner besten Runde Zeit verlierst (20 Streckenabschnitte).
 */
const SEGMENTS = 20;
const PS_READER = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Core
function Open($n) { try { [System.IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting($n) } catch { $null } }
function WStr($v, $off, $len) { $b = New-Object byte[] ($len * 2); [void]$v.ReadArray($off, $b, 0, $b.Length); ([Text.Encoding]::Unicode.GetString($b)).Split([char]0)[0] }
while ($true) { $g = Open 'Local\acpmf_graphics'; $p = Open 'Local\acpmf_physics'; $s = Open 'Local\acpmf_static'; if ($g -and $p -and $s) { break }; Start-Sleep -Milliseconds 3000 }
$gv = $g.CreateViewAccessor(); $pv = $p.CreateViewAccessor(); $sv = $s.CreateViewAccessor(); $n = 0
while ($true) {
  if ($n % 50 -eq 0) { [Console]::Out.WriteLine((@{ t = 'static'; car = (WStr $sv 68 33); track = (WStr $sv 134 33) } | ConvertTo-Json -Compress)) }
  $o = @{ t = 's'; st = $gv.ReadInt32(4); lap = $gv.ReadInt32(132); cur = $gv.ReadInt32(140); last = $gv.ReadInt32(144); best = $gv.ReadInt32(148); pit = $gv.ReadInt32(160); sec = $gv.ReadInt32(164); lsec = $gv.ReadInt32(168); pos = $gv.ReadSingle(248); spd = $pv.ReadSingle(28); gas = $pv.ReadSingle(4); brk = $pv.ReadSingle(8); gear = $pv.ReadInt32(16) }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); $n++; Start-Sleep -Milliseconds 100
}`;

/** Zeit (ms) an Streckenposition x (0..1) aus den Messpunkten einer Runde (linear interpoliert). */
function timeAt(samples, x) {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]; const b = samples[i];
    if (a.pos <= x && b.pos >= x && b.pos > a.pos) return a.cur + (x - a.pos) / (b.pos - a.pos) * (b.cur - a.cur);
  }
  return null;
}

/** Session-Auswertung (reine Rechnung). laps: [{ n, time, sectors, samples:[{pos,cur,spd,gas,brk}], valid }] */
function analyze(laps) {
  const ok = laps.filter((l) => l.valid && l.time > 0);
  if (!ok.length) return { laps: laps.length, valid: 0 };
  const best = ok.reduce((a, b) => (b.time < a.time ? b : a));
  const times = ok.map((l) => l.time); const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const sd = Math.sqrt(times.reduce((a, b) => a + (b - avg) ** 2, 0) / times.length);
  const secCount = Math.max(0, ...ok.map((l) => l.sectors?.length || 0));
  const sectors = Array.from({ length: secCount }, (_, i) => {
    const v = ok.map((l) => l.sectors?.[i]).filter((x) => x > 0);
    return v.length ? { best: Math.min(...v), avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length) } : null;
  });
  // Abschnitte: durchschnittlicher Zeitverlust gegenüber der besten Runde + Mindestgeschwindigkeit
  const seg = Array.from({ length: SEGMENTS }, (_, i) => ({ from: i / SEGMENTS, to: (i + 1) / SEGMENTS, loss: [], minSpd: null, bestMin: null }));
  const segTimes = (l) => seg.map((s) => { const a = s.from === 0 ? 0 : timeAt(l.samples, s.from); const b = s.to === 1 ? l.time : timeAt(l.samples, s.to); return a != null && b != null ? b - a : null; });
  const minSpd = (l, s) => { const v = l.samples.filter((p) => p.pos >= s.from && p.pos < s.to).map((p) => p.spd); return v.length ? Math.min(...v) : null; };
  const bt = best.samples?.length > 20 ? segTimes(best) : null;
  if (bt) {
    for (const l of ok) {
      if (l === best || !(l.samples?.length > 20)) continue;
      const t = segTimes(l);
      t.forEach((v, i) => { if (v != null && bt[i] != null) seg[i].loss.push(v - bt[i]); });
      seg.forEach((s) => { const m = minSpd(l, s); if (m != null) s.minSpd = s.minSpd == null ? m : (s.minSpd + m) / 2; });
    }
    seg.forEach((s) => { s.bestMin = minSpd(best, s); });
  }
  const sections = seg.map((s, i) => ({ i, from: Math.round(s.from * 100), to: Math.round(s.to * 100), avgLossMs: s.loss.length ? Math.round(s.loss.reduce((a, b) => a + b, 0) / s.loss.length) : null, minSpd: s.minSpd != null ? Math.round(s.minSpd) : null, bestMinSpd: s.bestMin != null ? Math.round(s.bestMin) : null }));
  const worst = sections.filter((s) => s.avgLossMs != null && s.avgLossMs > 50).sort((a, b) => b.avgLossMs - a.avgLossMs).slice(0, 3);
  const findings = worst.map((s) => `Abschnitt ${s.from}–${s.to} % der Runde: Ø ${(s.avgLossMs / 1000).toFixed(2)} s langsamer als deine Bestzeit${s.minSpd != null && s.bestMinSpd != null ? ` (Kurvenspeed ${s.minSpd} statt ${s.bestMinSpd} km/h)` : ''}`);
  if (ok.length >= 4) findings.push(`Konstanz: ±${(sd / 1000).toFixed(2)} s um den Schnitt (${ok.length} gültige Runden).`);
  return { laps: laps.length, valid: ok.length, best: best.time, bestLap: best.n, avg: Math.round(avg), sd: Math.round(sd), sectors, sections, findings };
}

const fmtLap = (ms) => (ms == null ? '–' : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`);

class AcTelemetry {
  constructor(s) {
    this.s = s; this.proc = null; this.sess = null; this.buf = '';
    s.bus.on('game:running', ({ started = [], stopped = [] } = {}) => { if (started.includes('assettocorsa')) this.start(); if (stopped.includes('assettocorsa')) this.stop(); });
  }
  enabled() { return this.s.settings.get('gaming')?.acTelemetry !== false; }
  start() {
    if (this.proc || !this.enabled() || process.platform !== 'win32') return false;
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_READER], { windowsHide: true });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); if (line) { try { this.onSample(JSON.parse(line)); } catch { /* Zeile kaputt */ } } } });
    this.proc.on('exit', () => { this.proc = null; });
    this.proc.stderr.on('data', (d) => log.debug('ps', String(d).slice(0, 200)));
    log.info('Assetto-Corsa-Telemetrie aktiv');
    return true;
  }
  stop() { try { this.proc?.kill(); } catch { /* ignore */ } this.proc = null; this.finish(); }

  /** Ein Messwert vom Leser. Plausibilitätsprüfung, Runden schneiden, Sektoren merken. */
  onSample(x) {
    if (x.t === 'static') { if (x.track && x.car && (!this.sess || this.sess.track !== x.track || this.sess.car !== x.car)) { this.finish(); this.sess = { id: id('ac'), car: x.car, track: x.track, startedAt: nowIso(), laps: [], cur: null, lastLapCount: null }; } return; }
    const s = this.sess; if (!s) return;
    if (!(x.st === 2) || !(x.spd >= 0 && x.spd < 500) || !(x.pos >= 0 && x.pos <= 1)) return; // nur LIVE und plausibel
    if (s.lastLapCount == null) s.lastLapCount = x.lap;
    if (!s.cur) s.cur = { n: x.lap + 1, samples: [], sectors: [], lastSec: x.sec, pit: !!x.pit };
    const c = s.cur;
    if (x.sec !== c.lastSec && x.lsec > 0) { c.sectors[c.lastSec] = x.lsec; c.lastSec = x.sec; }
    if (x.pit) c.pit = true;
    if (x.lap > s.lastLapCount) { // Runde beendet
      const lap = { n: c.n, time: x.last, sectors: c.sectors.filter((v) => v > 0), samples: c.samples, valid: !c.pit && c.samples.length > 50 && x.last > 0 };
      s.laps.push(lap); s.lastLapCount = x.lap;
      s.cur = { n: x.lap + 1, samples: [], sectors: [], lastSec: x.sec, pit: !!x.pit };
      this.s.bus.emit('game:data', { game: 'assettocorsa' });
      return;
    }
    if (!c.samples.length || x.pos >= c.samples[c.samples.length - 1].pos) c.samples.push({ pos: Math.round(x.pos * 10000) / 10000, cur: x.cur, spd: Math.round(x.spd), gas: Math.round(x.gas * 100) / 100, brk: Math.round(x.brk * 100) / 100 });
  }

  finish() {
    const s = this.sess; this.sess = null;
    if (!s || !s.laps.length) return null;
    const a = analyze(s.laps);
    const pb = this.personalBest(s.car, s.track);
    const rec = { id: s.id, car: s.car, track: s.track, startedAt: s.startedAt, endedAt: nowIso(), laps: s.laps.map((l) => ({ n: l.n, time: l.time, sectors: l.sectors, valid: l.valid })), analysis: a };
    const list = this.sessions(); list.unshift(rec);
    this.s.gaming.context.setState('ac:sessions', list.slice(0, 40));
    // Bestzeit pro Auto+Strecke als Spielstand
    if (a.best) {
      if (!pb || a.best < pb) this.s.gaming.progress.upsert('assettocorsa', { category: 'achievement', name: `Bestzeit ${s.track} · ${s.car}`, value: fmtLap(a.best), source: 'api' });
    }
    this.s.notifications.push({ category: 'gaming', origin: 'system', game: 'assettocorsa', dedupeKey: 'ac:' + s.id, title: `Assetto Corsa: ${s.track}`, body: [`${a.valid} gültige Runden, Bestzeit ${fmtLap(a.best)}`, ...(a.findings || []).slice(0, 2)].join(' · ') });
    this.s.bus.emit('game:data', { game: 'assettocorsa' });
    return rec;
  }
  personalBest(car, track) { const v = this.sessions().filter((x) => x.car === car && x.track === track && x.analysis?.best).map((x) => x.analysis.best); return v.length ? Math.min(...v) : null; }
  sessions() { try { return JSON.parse(this.s.gaming.context.getState('ac:sessions') || '[]'); } catch { return []; } }
}

module.exports = { AcTelemetry, analyze, timeAt, fmtLap, PS_READER };
