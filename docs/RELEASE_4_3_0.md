# Release-Checkliste – JARVIS v4.3.0

Stand: vorbereitet auf `main` nach Merge von PR #17. Dieses Dokument ist **kein** veröffentlichtes Release.

## Umfang

- Mikrofon-Geräteausfall und verspätete Aufnahme-/Wiedergabeereignisse robuster behandeln (PR #17).
- League-of-Legends-Matchanalyse: Detailabdeckung, Timeline, Chat-Freigabe und korrekte Matchzuordnung (PR #17).
- Tarkov: verständlicher Kartenlade-/Kalibrierungsstatus und manuelle Wiederholung (PR #17).
- Standby-Hänger, verspätete automatische LoL-Reviews und Tarkov-Retry aus PR #16 waren schon in v4.2.0 enthalten.
- Whisper inklusive deutschtauglichem Basismodell wird wie bisher im Installer mitgeliefert.

**Nicht in v4.3.0 versprechen:** parallel beschriebene, aber noch nicht eingecheckte Verbesserungen wie automatische Sprechpausen-Erkennung, geführter lokaler Modell-Start oder neue Vorleseabläufe. Erst nach eigenem PR, erfolgreicher CI und bewusstem Einschluss neu planen.

## Freigabe-Gates

- [ ] Release-Vorbereitungs-PR ist in `main` gemergt.
- [ ] Linux-Tests auf dem finalen `main`-Commit grün.
- [ ] Windows Build & Test auf dem finalen `main`-Commit grün (EXE, Installer, eingepacktes Whisper, Installation, Start, Deinstallation).
- [ ] `CHANGELOG.md` enthält `## 4.3.0`, `package.json` und `package-lock.json` haben dieselbe Version.
- [ ] Echtes Windows-UX-Smoke-Testing nach Möglichkeit: Mikrofon abziehen/wiederverbinden, lokale Sprache, gemischte LoL-Daten mit/ohne Cloud-Freigabe und Tarkov-Karten nach kurzzeitigen Ladefehlern. CI simuliert Geräte und APIs, aber nicht diese Hardware.
- [ ] Für die Veröffentlichung ist das GitHub-Secret `UPDATE_PRIVATE_KEY` gültig, passend zu `build/update-public-key.pem`.

## Veröffentlichung (separater, expliziter Schritt)

GitHub → **Actions** → **Release (Windows)** → **Run workflow** auf `main`, Eingabe: `v4.3.0`.

Der Workflow prüft die Version, testet, baut, überprüft das mitgelieferte Offline-Whisper, installiert und startet den Setup-Build, deinstalliert ihn, signiert `update.json` per Ed25519 und veröffentlicht die Assets im Release. **Nicht den Test-Installer aus dem PR als endgültige Version verteilen.**

Danach prüfen:

1. Neues Release `v4.3.0` mit `JARVIS_Setup.exe`, `SHA256SUMS.txt` und `update.json`.
2. `update.json`: `version=4.3.0`, gültige Ed25519-Signatur, SHA-256 identisch zum Installer; der Signaturschritt blockiert fehlerhafte Schlüssel.
3. In einer bestehenden JARVIS-v4.2.0-Installation „Nach Updates suchen“ testen und lokale Einstellungen und Daten nach Update kontrollieren.
4. Den neuen Release erst dann an andere verteilen.

## Wenn etwas fehlschlägt

- Fehlgeschlagene Tests/Installationsprüfung: keinen Release veröffentlichen, sondern Code reparieren und den `main`-Build wiederholen.
- Fehlendes/ungültiges `UPDATE_PRIVATE_KEY`: das Release blockieren, niemals unsignierte Updates als erfolgreich markieren.
- Noch nicht eingecheckte Änderungen von parallel arbeitenden Personen nicht stillschweigend als Bestandteil von v4.3.0 deklarieren.
