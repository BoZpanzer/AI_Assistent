# Lokale KI, automatische Privat-Erkennung, Buckets und Tarkov-Ziele

## Einrichtung auf deinem PC

1. Ollama installieren und ein **lokales Modell mit Tool Calling** herunterladen. Modellgröße passend zu RAM/VRAM wählen; JARVIS lädt selbst keine Modelle herunter.
2. Ollamas Cloud-Funktionen deaktivieren: `OLLAMA_NO_CLOUD=1` als Umgebungsvariable für den Ollama-Prozess setzen und Ollama neu starten. Alternativ `disable_ollama_cloud: true` in Ollamas `server.json`. Offizielle Anleitung: https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features
3. In JARVIS unter **Einstellungen → Lokale KI & Private** den lokalen Port einstellen (Standard 11434), **Lokale Modelle laden** und das installierte Modell wählen.
4. Einfach schreiben oder sprechen. Private Nachrichten beantwortet das lokale Modell (kein Gemini-Schlüssel nötig). Bei ausgeschaltetem Ollama erscheint ein Fehler; es gibt keinen Cloud-Fallback.

JARVIS spricht ausschließlich mit `127.0.0.1`, folgt keinen Redirects und verwendet keinen HTTP-Proxy für lokale KI. Modellnamen mit `cloud`, Remote-Modelle und Modelle ohne lokale Modellinformationen werden abgelehnt. Der lokale Ollama-Prozess muss tatsächlich auf deinem PC laufen; eine absichtlich eingerichtete Weiterleitung oder ein manipuliertes lokales Programm kann die Anwendung nicht ausschließen. Ollama/Modellqualität und Windows-Integration müssen auf dem Ziel-PC getestet werden.

## Welche Daten wohin gehen

- **Ab 5.0 gibt es keine Chat-Modi mehr.** JARVIS ordnet **jede Nachricht** selbst ein (ohne KI, sofort):
  - **privat → lokales Modell**: Termine, Finanzen, Familie, Gesundheit, „meine …“-Daten (Klausur, Aufgaben, Notizen …), Assistenz-Aktionen („erinner mich“, „trag … ein“, „merk dir“), Anhänge, eingefügte Bilder, `#Private`. Kurze Folgefragen direkt danach bleiben privat.
  - **nicht privat → Gemini**: Gaming, Uni-Wissen, allgemeine Fragen. Gemini bekommt dabei **nur die nicht privaten Nachrichten** des Gesprächs, keinen persönlichen Systemkontext und keinen Zugriff auf Brain, Kalender, Finanzen oder Dokumente.
  - Jede Antwort zeigt „🔒 lokal“ bzw. „☁ Gemini“. Im Zweifel `#Private` voranstellen.
- Die Erkennung arbeitet mit Wortlisten – sie ist eine Schranke, **keine verlässliche semantische Erkennung**. Alte Gespräche, die vor 5.0 als privat markiert waren, bleiben komplett lokal.
- Anhänge erzwingen lokale Verarbeitung. Bild- und Audioverarbeitung durch ein lokales Modell sind noch nicht enthalten. Text aus unterstützten Dokumenten wird lokal gelesen; Cloud-OCR ist gesperrt.
- Persönliche Hintergrundanalysen verwenden die lokale KI. Die ausdrücklich abgegrenzten Gaming-Funktionen (Spielseiten, LoL, Patch-News, Wiki-Listen) dürfen weiter Gemini nutzen, sofern kein Private-Kontext/Marker vorliegt.

## Bewusste Funktionsänderungen für Datenschutz

- Neue Termine werden immer im lokalen Kalender angelegt. Importierte Google-/Feed-Termine sind zum Bearbeiten schreibgeschützt; ausstehende Google-Schreibvorgänge werden blockiert. Bereits früher synchronisierte Daten werden nicht aus Google gelöscht.
- Drive-Backups enthalten private Daten und werden deshalb als drei getrennte Dateien (Einstellungen *.jarvis-settings, Schlüssel *.jarvis-keys, komplett *.jarvisbak) vor dem Hochladen mit dem eigenen Backup-Passwort verschlüsselt (scrypt + AES-256-GCM). Ohne Backup-Passwort gibt es kein Drive-Backup. Wiederherstellen über „Wiederherstellen…“ mit dem Passwort.
- Cloud-Embeddings sind gesperrt; die lokale Volltextsuche bleibt verfügbar.
- Sprache läuft komplett lokal: Erkennung mit Whisper, Antworten mit OmniVoice. Beim Zocken spricht die Google-Stimme nur nicht-private Antworten; private erscheinen dann nur als Text im Overlay. Gemini Live gibt es seit 5.1 nicht mehr.
- Automatische Fahrplanung anhand privater Terminorte ist deaktiviert. Manuell abgefragte öffentliche Fahrplandaten bleiben verfügbar.
- Private Tools dürfen keine externen Zugriffe ausführen, auch nicht nach Bestätigung. Eine explizite Tool-Freigabeliste und ein asynchroner Netzwerk-Kontext verhindern, dass ein lokales Modell private Daten durch Web-/Browser-/Cloud-Tools versendet.

## Buckets

Unter **Alltag → Buckets** Geld je Zweck und Monat verplanen (Name, Plan-Betrag, Monat). Ausgaben lassen sich direkt hineinbuchen – im Bucket, über „→ Bucket“ beim normalen Erfassen oder per Chat („15 € aus dem Kino-Bucket“). Das Säulendiagramm zeigt je Bucket geplant (Umriss) und ausgegeben (Füllung, rot wenn überzogen). Vom freien Geld wird nur der offene Rest abgezogen. **Rest bezahlt** bucht den offenen Rest; beim Löschen eines Buckets bleiben die Ausgaben erhalten.

## Tarkov-Ziel

Im Raid-Planer Karte wählen, Ziel beschreiben und **Ziel speichern & Karte** klicken. Auf der Karte **Mein Ziel setzen** aktivieren und einen Kartenpunkt oder vorhandenen Marker anklicken. Das Ziel bleibt pro Karte inklusive Stockwerk gespeichert, kann ersetzt oder entfernt werden. Im Routenmodus kann **Ziel an Route anhängen** den Zielpunkt ergänzen. Die Route danach wie bisher speichern; ihr Endpunkt wird beschriftet angezeigt. Dies sind manuelle Routen, keine berechneten begehbaren Wege durch die Karte.

## Kartenkalibrierung

Die zwölf mitgelieferten Wiki-Bilder sind offline nutzbar. Unter „Kalibrieren“ drei weit auseinanderliegende Punkte auf der Hauptkarte zuordnen; bekannte Exits können aus der Liste gewählt werden. Die Umrechnung wird daraus berechnet und berücksichtigt auch Spiegelung. Separat gezeichnete Stockwerke dürfen nicht als Referenz dienen. Die Bilder sind noch nicht mit geprüften Standardreferenzen vorkalibriert; ohne Referenzen bleiben Spielpositionen ausgeblendet.

## Validierung

- `npm run test:ci`: 118 Tests bestanden, keine Fehler, keine übersprungenen Tests; inklusive echter ONNX-Wake-Word-Erkennung und vollständiger PDF-/Audio-Fixtures.
- Renderer-Build erfolgreich. Zusätzlicher gezielter Lauf für Kartenkalibrierung und Migration: 8/8 erfolgreich.
- Cloud-Kalender-Schreiben, vollständige Cloud-Backups und Cloud-Audio werden in den Regressionstests ausdrücklich als gesperrt geprüft. Tests für private Aufgaben und Kalenderaktionen verwenden einen separaten lokalen Modell-Fake; ein Loopback-HTTP-Test prüft zusätzlich das Ollama-Protokoll und die Sperre entfernter Modelle/Redirects.
- GitHub Actions prüft Linux sowie Windows-Build, Smoke-Test und Installation/Deinstallation am jeweiligen PR-Commit. Den aktuellen Status zeigt PR #1.
- Kein echter Ollama-Modelllauf auf deiner Hardware und kein vollständiger Electron-UI-End-to-End-Lauf in dieser Arbeitsumgebung durchgeführt.
