# Prüfung der Releases nach 3.34.0

Basis: Commit `183bb44` (PR #2, „automatic offline Tarkov Wiki map calibration (v3.34.0)“). **Ein Tag oder GitHub-Release 3.34.0 existiert nicht** – der Release-Trigger (`43168b0`) schlug fehl. 3.34.0 diente nur als Vergleichsbasis, nicht als „fehlerfrei“.

## Lücken in der Release-Historie

- Kein Tag `v3.34.0`; Tag `4.0.0` ohne „v“; `V4.0.1` mit großem „V“.
- `V4.0.1`, `v4.0.2` und `v4.1.0` zeigen auf **denselben Commit** `b2a4283` (drei Releases ohne Codeunterschied).
- `package.json` stand bis `v4.2.0` auf 3.32.0; die Version kommt beim Build aus dem Tag (`release.yml`), daher funktional unkritisch.
- Unveröffentlicht: Stand `main` = 4.3.0 (`11080ec`).

## Je Release

| Release (Commit) | Inhalt | Gefundene Probleme | Reparatur / Prüfung |
|---|---|---|---|
| 4.0.0 (`1020514`) | nur CI-Datei `release-request-v3.34.0.txt`; App-Code = 3.34.0 | Versionssprung ohne Funktionsänderung; einmalige Trigger-Dateien blieben liegen | Trigger-Dateien entfernt (`7cc7b6e`) |
| V4.0.1 / v4.0.2 / v4.1.0 (`b2a4283`, PR #3) | fünf Ollama-Stufen, Status, Modell-Download | Empfehlung bei 32 GB RAM = 9B-Modell, ohne jede Ressourcengrenze – konkurriert beim Spielen mit dem Spiel um RAM/VRAM | Empfehlung max. 4B; Ollama beim Spielen nur CPU, 2 Threads, sofort entladen, 1 Anfrage gleichzeitig (`066032e`), Tests |
| v4.1.1 (`6e5c4bf`, PRs #4–#12) | Benachrichtigungs-Cooldown, Backup-Aufbewahrung, winget-Ollama, Job-Status, Cache-Reparatur, Spiel-Widgets, Planer, Screenshot-Review, iOS-Gerüst, verschlüsselter Export, Google-Kalender-Export, Offline-Whisper, Live-Zustimmung | **Screenshot-Review (`102df1f`) konnte nie funktionieren**: Bildanfragen wurden seit 3.33 (#1, `f72261a`) an das lokale Modell geleitet, das keine Bilder kann. Lokale Spracheingabe nur in privaten Chats → beim Gaming blieb nur das teure Gemini Live. Whisper ohne Thread-Grenze. `mobile-sync.js` ist nirgends eingebunden (unvollständige Integration). | Bild-Routing repariert (`04b3c99`); lokale Spracheingabe für alle Chats, Whisper begrenzt (`066032e`); `mobile-sync.js` als Entscheidung offen (siehe unten) |
| v4.2.0 (`215efaf`, PRs #13–#16) | Whisper im Installer, LoL-Reconnect, Voice-Standby, Karten-Retry (4 Versuche, Backoff), serialisierter Kartenimport | Live-Sitzung ohne Zeit-/Kostengrenze; Spielsound verlängerte den Leerlauf-Timer (bestand schon vorher) | Live: Grenze 10 min / 0,10 €, Audio nur bei Sprache, 45 s Leerlauf (`04b3c99`, `066032e`) |
| 4.3.0 unveröffentlicht (`31e5c8d` #17, `11080ec` #18) | Mikrofon-Wiederherstellung, LoL-Cloud-Freigabe, Tarkov-Kartenstatus, Release-Vorbereitung | **Regression `31e5c8d`:** Das Tarkov-Widget „Raid-Status“ verwendete die LoL-Variable `cloudShare`, die dort nicht existiert → `ReferenceError`, Widget stürzt beim Anzeigen ab | entfernt + Regressionstest (`124b0fb`) |

Übergreifend (älter als 3.34, aber Ursache für Kosten): automatisches Durchprobieren von bis zu 5 Modellen inkl. Pro, automatisches Pro für „Analysen“, Hintergrund-KI ohne Nutzeraktion, Kostenbremse ohne Sperre und mit zu niedrigen Preisen → zentral neu gelöst (`04b3c99`).

## Tarkov-Kartenkalibrierung / „tarkov.dev antwortet mit 422“

- „dev“ = **tarkov.dev**, die Community-API `https://api.tarkov.dev/graphql`. Die Meldung stammt aus `Tarkov.gql()`; das Kartenwidget lädt darüber Exits, Schlösser und die Landmarken für die Drei-Punkt-Kalibrierung.
- `tarkov.js` ist **seit 3.29.0 unverändert** – keine Regression nach 3.34.0.
- Alle 15 Abfragen von JARVIS sind gegen das aktuelle Schema von tarkov.dev (`the-hideout/tarkov-api`, Stand 13.08.2026) **gültig** geprüft; Methode (POST), Content-Type (`application/json`) und Body entsprechen dem offiziellen tarkov.dev-Frontend.
- Der Code von tarkov.dev erzeugt selbst kein 422 (nur 200/400/404/405/500/503).
- **Die tatsächliche Ursache ist damit nicht belegt.** Wahrscheinlich liegt sie außerhalb von JARVIS (Zwischenstation wie Proxy/Virenscanner/DNS-Filter oder ein vorübergehender Zustand bei tarkov.dev). Ein Live-Abruf war aus der Entwicklungsumgebung nicht möglich; das Protokoll deines PCs lag nicht vor.
- Reparatur: verständliche Meldung (Kartenbild, Kalibrierung und Marker funktionieren weiter), **keine Wiederholungsschleife** (abgelehnte Abfrage 15 min gesperrt), gemeinsame Anfrage für gleichzeitige Aufrufe, 20-s-Zeitlimit, und im Diagnose-Protokoll Status, Content-Type, `cf-ray`, `server` und 300 Zeichen der Antwort (ohne Schlüssel). Damit lässt sich beim nächsten Auftreten die Quelle bestimmen.
- Kalibrierung selbst: Klicks erst nach bekannter Bildgröße, Speichern/Neustart/Laden, ungültige und kollineare Punkte, Kartenbindung – per Test geprüft.

## Offene Produktentscheidungen (nicht umgesetzt)

- **iOS-Begleit-App** (`ios/`, Workflows `ios.yml`, `ios-testflight.yml`) und `mobile-sync.js`/`mobile-sync-crypto.js`: in der Windows-App nicht eingebunden. Entfernen oder fertig integrieren?
- Viele Spezial-Integrationen (Factorio, Stardew, Assetto Corsa, PUBG, CS2 …) laufen nur bei Bedarf; ob alle gebraucht werden, entscheidest du.
