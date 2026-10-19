# Lokale KI beim Gaming – Auswahl und Einrichtung

**Status: vorläufig.** Zielhardware laut Angabe: Windows 11, AMD Ryzen 5 5600X (6 Kerne/12 Threads), 32 GB RAM, NVIDIA RTX 2070 SUPER (8 GB VRAM). Diese Werte wurden **nicht gemessen**; Leistungs- und FPS-Messungen auf dem Gaming-PC stehen aus (siehe unten). Keine der folgenden Komponenten ist als „gaming-tauglich getestet“ zu verstehen.

## Grundsatz

Kein Modell, wo Regeln, Rechnen oder Datenbankabfragen reichen (Statistiken, Kalibrierung, Zähler, einfache Befehle). Kein Modell dauerhaft auf der GPU. „Lokal“ ist nicht automatisch effizienter: Ein lokales Modell kostet CPU, RAM, VRAM und Strom – deshalb wird es beim Spielen begrenzt oder pausiert.

## Auswahl

| Aufgabe | Lösung | Lizenz | Ressourcen | Begründung |
|---|---|---|---|---|
| Spracherkennung | **whisper.cpp + ggml-base** (im Installer, ca. 148 MB) | MIT | CPU, ca. 0,4 GB RAM nur während der Erkennung; beim Spielen 2 Threads, niedrige Priorität | Deutsch brauchbar, kurze Befehle, kein GPU-Bedarf. Optional `ggml-small` (ca. 470 MB, besseres Deutsch, langsamer) über Einstellungen → Sprache |
| Sprachausgabe | **Windows-Stimme** (lokale SAPI/OneCore-Stimme über `speechSynthesis`) | Teil von Windows | vernachlässigbar | kein Download, keine GPU; JARVIS nutzt nur lokale Stimmen, nie Online-Stimmen |
| Einfache Dialoge, private Chats | **Ollama + Qwen3.5 4B** („Ausgewogen“, Empfehlung) oder 2B („Leicht“) | Apache-2.0 (Qwen3.5) | Q4-Modell, einige GB Download; beim Spielen nur CPU (`num_gpu 0`), 2 Threads, sofort entladen | gute Mehrsprachigkeit in kleiner Größe, Werkzeugaufrufe; 9B/27B bleiben wählbar, konkurrieren aber stark mit dem Spiel |
| Bildauswertung | **keine lokale Lösung** (Tarkov-Itemscan: nur Mauszeiger-Ausschnitt an Gemini) | – | – | ein lokales Bildmodell würde dauerhaft VRAM brauchen; Vorschlag: klassische OCR für Itemnamen prüfen (offen) |
| Statistiken, Kennzahlen, Statistikfragen | **Code** | – | – | deterministisch, exakt |

Qwen3.5-4B: veröffentlicht 2.3.2026, Apache-2.0, multimodal (Text/Bild) laut Modellübersicht. Die tatsächliche Downloadgröße zeigt Ollama vor dem Herunterladen an.

## Einrichtung

1. Ollama installieren: Einstellungen → Lokale KI → „Ollama installieren (Windows)“ (winget, nur nach Klick) oder <https://ollama.com>.
2. Optional, empfohlen: Umgebungsvariable `OLLAMA_HOST=127.0.0.1:11434` setzen (nur lokal erreichbar). JARVIS warnt, wenn Ollama im Netzwerk erreichbar ist.
3. Stufe „Ausgewogen (qwen3.5:4b)“ wählen und **ausdrücklich** „Ausgewähltes Modell herunterladen“ klicken. JARVIS lädt nie ungefragt Modelle.
4. „Während ein Spiel läuft“: *Nur CPU, 2 Threads, sofort entladen* (Standard) oder *Hintergrundaufgaben pausieren*.
5. Spracherkennung ist im Installer enthalten; Mikrofon drücken, sprechen, nach einer kurzen Pause wird automatisch erkannt.

## Ressourcensteuerung (umgesetzt)

- Lokales Modell: höchstens 1 Anfrage gleichzeitig, Warteschlange max. 3, Hintergrundaufgaben werden bei Belegung übersprungen; `num_ctx` 4 096, `num_thread` 4 (Spielen: 2), `keep_alive` 2 min (Spielen: sofort entladen), Spielen: nur CPU.
- Whisper: `-t 4` (Spielen: `-t 2`), Prozesspriorität „niedriger als normal“ während eines Spiels, max. 30 s Audio.
- Gemini-Aufrufe: max. 2 parallel, Hintergrund wird übersprungen statt nachgeholt.
- Schwere Hintergrundjobs pausieren beim Spielen (bestehender Scheduler, `reduceWhileGaming`).
- Bei Ressourcenknappheit wird **nicht** auf die Cloud ausgewichen.

## Messungen – offen

In der Entwicklungsumgebung (Linux-Container, ohne GPU, ohne Spiel) sind keine aussagekräftigen Messungen möglich. Auf dem Gaming-PC bitte einmal:

1. Spiel ohne JARVIS: FPS/Frametimes (z. B. CapFrameX oder NVIDIA-Overlay), 5 min gleiche Szene.
2. Mit JARVIS im Leerlauf (Wake-Word aus/an).
3. Mit 5 lokalen Spracheingaben und 2 lokalen Chatantworten während des Spiels.
4. Je Durchlauf: CPU-/RAM-/VRAM-Auslastung (Task-Manager), Antwortlatenz.

Erst danach kann die Modellwahl als getestet gelten.
