'use strict';
const { spawn } = require('node:child_process');
const log = require('./core/logger').scope('fullscreen');

/**
 * Vollbild-Erkennung (nur Windows): ein kleiner, dauerhaft laufender PowerShell-Prozess meldet alle 2,5 s
 * - den Windows-Status „Vollbild-App/Präsentation/Direct3D-Vollbild“ (SHQueryUserNotificationState),
 * - Prozessname und Fensterrechteck des Vordergrundfensters (randlose Vollbild-Spiele).
 * Daraus: fullscreen (Figur ausblenden) und gameLike (unbekanntes Spiel → zählt als Zocken: Google-Stimme, KI-Stimme entladen).
 * Browser, Videoplayer & Co. im Vollbild sind kein Spiel – dann verschwindet nur die Figur.
 */
const NON_GAME = new Set(['chrome', 'msedge', 'firefox', 'opera', 'opera_gx', 'brave', 'vivaldi', 'arc', 'iexplore', 'vlc', 'mpc-hc', 'mpc-hc64', 'mpc-be', 'mpc-be64', 'potplayermini', 'potplayermini64', 'wmplayer', 'video.ui', 'microsoft.media.player', 'mpv', 'kodi', 'plex', 'netflix', 'spotify', 'discord', 'obs64', 'obs', 'teams', 'ms-teams', 'zoom', 'powerpnt', 'winword', 'excel', 'acrord32', 'acrobat', 'code', 'explorer', 'applicationframehost', 'searchhost', 'searchapp', 'shellexperiencehost', 'startmenuexperiencehost', 'lockapp', 'textinputhost', 'jarvis', 'electron', 'idle', 'photos', 'microsoft.photos', 'steamwebhelper']);

const SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
$sig = @'
[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
public struct RECT { public int L; public int T; public int R; public int B; }
'@
Add-Type -MemberDefinition $sig -Name W -Namespace JarvisFs
while ($true) {
  $s = 0; [void][JarvisFs.W]::SHQueryUserNotificationState([ref]$s)
  $h = [JarvisFs.W]::GetForegroundWindow(); $p = 0; [void][JarvisFs.W]::GetWindowThreadProcessId($h, [ref]$p)
  $n = ''; try { $n = (Get-Process -Id $p).ProcessName } catch {}
  $r = New-Object JarvisFs.W+RECT; [void][JarvisFs.W]::GetWindowRect($h, [ref]$r)
  [Console]::Out.WriteLine("$s|$n|$($r.L),$($r.T),$($r.R),$($r.B)"); [Console]::Out.Flush()
  Start-Sleep -Milliseconds 2500
}`;

/** Eine Zeile auswerten. displays: [{x,y,width,height}] (Pixel wie GetWindowRect, also physisch). */
function parseLine(line, displays = []) {
  const [st, procRaw = '', rect = ''] = String(line).trim().split('|');
  const state = Number(st) || 0;
  const proc = procRaw.trim().toLowerCase();
  const [L, T, R, B] = rect.split(',').map(Number);
  const covers = Number.isFinite(L) && displays.some((d) => Math.abs(L - d.x) <= 2 && Math.abs(T - d.y) <= 2 && Math.abs(R - (d.x + d.width)) <= 2 && Math.abs(B - (d.y + d.height)) <= 2);
  // Desktop/Startmenü/JARVIS selbst zählen nie (der Desktop ist auch „bildschirmfüllend“)
  const own = !proc || ['explorer', 'jarvis', 'electron', 'searchhost', 'searchapp', 'shellexperiencehost', 'startmenuexperiencehost', 'lockapp', 'textinputhost', 'applicationframehost'].includes(proc);
  // 2 = Vollbild-App/„beschäftigt“, 3 = Direct3D-Vollbild, 4 = Präsentationsmodus
  const fullscreen = !own && (state === 2 || state === 3 || state === 4 || covers);
  const gameLike = fullscreen && !NON_GAME.has(proc) && state !== 4;
  return { fullscreen, gameLike, proc, d3d: state === 3 };
}

class FullscreenWatch {
  constructor({ onChange, displays = () => [], platform = process.platform, run = spawn }) {
    this.onChange = onChange; this.displays = displays; this.platform = platform; this.run = run;
    this.proc = null; this.last = { fullscreen: false, gameLike: false, proc: '' }; this.buf = ''; this.restarts = 0;
  }
  start() {
    if (this.platform !== 'win32' || this.proc) return;
    try {
      const p = this.proc = this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', SCRIPT], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', (d) => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1); if (l.trim()) this.handle(l); } });
      p.on('exit', () => { this.proc = null; if (!this.stopped && this.restarts++ < 5) setTimeout(() => this.start(), 15000); });
    } catch (e) { log.info('Vollbild-Erkennung nicht verfügbar: ' + e.message); }
  }
  handle(line) {
    const r = parseLine(line, this.displays());
    if (r.fullscreen === this.last.fullscreen && r.gameLike === this.last.gameLike && (!r.gameLike || r.proc === this.last.proc)) return;
    this.last = r;
    log.info(r.fullscreen ? `Vollbild: ${r.proc}${r.gameLike ? ' (als Spiel gezählt)' : ''}` : 'Kein Vollbild mehr');
    try { this.onChange(r); } catch (e) { log.debug('onChange', e); }
  }
  stop() { this.stopped = true; try { this.proc?.kill(); } catch { /* ignore */ } this.proc = null; }
}

module.exports = { FullscreenWatch, parseLine, NON_GAME };
