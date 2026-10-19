# Sprache in JARVIS: lokal in allen Chats, Gemini Live nur auf Wunsch

> **Aktueller Stand (ab Branch `fix/kalibrierung-kosten-lokal`):** Die lokale Spracherkennung gilt jetzt für **alle** Chats, nicht nur private. Nur der erkannte Text folgt dem normalen Weg des Chats (Uni/Gaming: Gemini, sofern erlaubt). Gemini Live ist standardmäßig aus, mit 10 min / 0,10 € Grenze je Sitzung, und sendet Audio nur bei lokal erkannter Sprache. Die Aufnahme endet nach einer Sprechpause automatisch. Details: [KOSTEN_UND_DATENSCHUTZ.md](KOSTEN_UND_DATENSCHUTZ.md).

## Warum das Mikrofon vorher blockiert war

Die bestehende Gemini-Live-Funktion wurde bisher in jedem Chatmodus sofort gesperrt, um private Gesprächsdaten zu schützen. Diese Änderung teilt die Aufnahme nach Gesprächsmodus auf.

## Private · lokal

**Keine zusätzliche Installation erforderlich.** Ab der neuen Windows-Version liefert
\`JARVIS_Setup.exe\` die lokale Whisper-Spracherkennung bereits mit:

- CPU-kompatible offizielle **whisper.cpp**-Engine (gepinnt auf b5130).
- Mehrsprachiges deutschtaugliches **ggml-base.bin**-Modell (ca. 148 MB).
- SHA-256-Prüfung **beim Release-Build** für beide Downloads. Wenn Download oder Prüfung fehlschlägt, wird **kein Installer veröffentlicht**.
- Gespeichert unter \`resources/voice\` im Installationsverzeichnis, außerhalb des Electron-ASAR; kein Modelldownload beim ersten Start.

Beim Öffnen von JARVIS → **Einstellungen → Sprache** erscheint automatisch „Whisper bereits im JARVIS-Installer enthalten – einsatzbereit“. Im privaten Chat: Mikrofon drücken, sprechen (bis zu 30 Sekunden), erneut drücken. Whisper verarbeitet die Audiodaten ausschließlich lokal und JARVIS entfernt temporäre WAV- und Transkriptdateien. Es gibt keinen Cloud-Fallback.

Fortgeschrittene können weiterhin eine eigene ausführbare Datei oder ein anderes Modell auswählen; wenn diese Dateien fehlen, wird auf das geprüfte Bundle zurückgegriffen.

Der Installer wird entsprechend größer (über 150 MB zusätzliche Dateien vor Kompression). Die CI-Build-Maschine benötigt Internetzugriff zum Abrufen der geprüften Artefakte, **dein PC bei der Spracheingabe nicht**. Der reguläre Textmodus von JARVIS funktioniert unverändert ohne Mikrofon. Ein normaler Windows-Build überprüft die Bundle-Dateien und testet die Installation; eine echte gesprochene Deutschaufnahme sollte nach Installation einmal manuell ausprobiert werden.

## Uni · Cloud und Gaming · Cloud

Vor jeder neuen Live-Sitzung fragt JARVIS ausdrücklich:

- Das Mikrofon-Audio wird an **Google Gemini** übertragen.
- Antworten und freigegebene Chat-Historie werden cloudbasiert verarbeitet.
- Erst nach Zustimmung wird das Mikrofon für Gemini Live gestartet.

Der Hauptprozess erlaubt Gemini Live ausschließlich für Gesprächsmodi `study` und `gaming` und verlangt `cloudAudioApproved === true`. Ein Wechsel der aktiven Unterhaltung beendet die laufende Übertragung auf Renderer-Seite; ein Wechsel der Sitzung selbst zu `private` beendet sie außerdem im Hauptprozess. Direkte IPC-Aufrufe können diese Prüfungen nicht umgehen.

## Tests

- Privater Modus / fehlende Cloud-Zustimmung erzeugen **keine** Live-Verbindung.
- Auch während einer bestehenden Live-Sitzung bleibt der Datenschutz-Check aktiv.
- Bei nachträglichem Private-Tag wird die Cloud-Sitzung beendet und keine weiteren Audio-Frames werden gesendet.
- Lokales PCM16 / WAV: Samplingrate, Begrenzungen, fehlerhafte Daten.
- Whisper-Aufruf mit `shell:false`, temporäre WAV-Datei, Transkript und Aufräumen nach Erfolg oder Fehler.

Die CI-Tests verwenden für die lokale Engine einen Mock-Prozess. Ein vollständiger Mikrofon- und Deutsch-Erkennungstest erfordert eine echte Windows-Installation mit whisper.cpp-Modell.
