# Lokale KI, Private-Tags, geplante Ausgaben und Tarkov-Ziele

## Einrichtung auf deinem PC

1. Ollama installieren und ein **lokales Modell mit Tool Calling** herunterladen. Modellgröße passend zu RAM/VRAM wählen; JARVIS lädt selbst keine Modelle herunter.
2. Ollamas Cloud-Funktionen deaktivieren: `OLLAMA_NO_CLOUD=1` als Umgebungsvariable für den Ollama-Prozess setzen und Ollama neu starten. Alternativ `disable_ollama_cloud: true` in Ollamas `server.json`. Offizielle Anleitung: https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features
3. In JARVIS unter **Einstellungen → Lokale KI & Private** den lokalen Port einstellen (Standard 11434), **Lokale Modelle laden** und das installierte Modell wählen.
4. Einen **Private · lokal**-Chat starten. Dieser braucht keinen Gemini-Schlüssel. Bei ausgeschaltetem Ollama erscheint ein Fehler; es gibt keinen Cloud-Fallback.

JARVIS spricht ausschließlich mit `127.0.0.1`, folgt keinen Redirects und verwendet keinen HTTP-Proxy für lokale KI. Modellnamen mit `cloud`, Remote-Modelle und Modelle ohne lokale Modellinformationen werden abgelehnt. Der lokale Ollama-Prozess muss tatsächlich auf deinem PC laufen; eine absichtlich eingerichtete Weiterleitung oder ein manipuliertes lokales Programm kann die Anwendung nicht ausschließen. Ollama/Modellqualität und Windows-Integration müssen auf dem Ziel-PC getestet werden.

## Welche Daten wohin gehen

- Bestehende und neue Standardgespräche sind **Private**. Finanzen, Termine, Familie, persönliches Gedächtnis, Anhänge und gemischte Gespräche bleiben lokal.
- Der **Private-Tag** in der Eingabeleiste markiert ein ganzes Gespräch dauerhaft als privat. Auch `#Private` / `[Private]` im Nachrichtentext funktionieren. Im Brain gibt es eine Private-Checkbox beim Bearbeiten; das Brain bleibt grundsätzlich lokal.
- **Uni · Cloud** und **Gaming · Cloud** erstellen getrennte, leere Gespräche. Nur ausdrücklich dafür freigegebene Inhalte dort eingeben. Diese Gespräche bekommen weder persönlichen Systemkontext noch Zugriff auf Brain, Kalender, Finanzen oder Dokumente. Die Cloud-Werkzeuge sind zunächst auf vier geprüfte Tarkov-Abfragen begrenzt.
- Häufige private Begriffe schalten einen Cloud-Chat zusätzlich auf lokal. Das ist nur eine zusätzliche Schranke, **keine verlässliche semantische Erkennung aller privaten Inhalte**. Private Daten deshalb immer im Private-Chat eingeben. Ein nachträglicher Tag kann frühere Cloud-Übertragungen nicht zurückholen.
- Anhänge erzwingen lokale Verarbeitung. Bild- und Audioverarbeitung durch ein lokales Modell sind noch nicht enthalten. Text aus unterstützten Dokumenten wird lokal gelesen; Cloud-OCR ist gesperrt.
- Persönliche Hintergrundanalysen verwenden die lokale KI. Die ausdrücklich abgegrenzten Gaming-Funktionen (Spielseiten, LoL, Patch-News, Wiki-Listen) dürfen weiter Gemini nutzen, sofern kein Private-Kontext/Marker vorliegt.

## Bewusste Funktionsänderungen für Datenschutz

- Neue Termine werden immer im lokalen Kalender angelegt. Importierte Google-/Feed-Termine sind zum Bearbeiten schreibgeschützt; ausstehende Google-Schreibvorgänge werden blockiert. Bereits früher synchronisierte Daten werden nicht aus Google gelöscht.
- Vollständige Drive-Backups werden gesperrt, weil sie private Daten enthalten. Lokale Sicherungen bleiben verfügbar. Bereits vorhandene Cloud-Backups bleiben bestehen.
- Cloud-Embeddings sind gesperrt; die lokale Volltextsuche bleibt verfügbar.
- Gemini Live bleibt deaktiviert, weil Sprache sonst vor einer Klassifizierung übertragen würde. Lokale Spracherkennung ist ein separater Ausbau. Vorlesen verwendet ausschließlich als lokal gekennzeichnete Systemstimmen.
- Automatische Fahrplanung anhand privater Terminorte ist deaktiviert. Manuell abgefragte öffentliche Fahrplandaten bleiben verfügbar.
- Private Tools dürfen keine externen Zugriffe ausführen, auch nicht nach Bestätigung. Eine explizite Tool-Freigabeliste und ein asynchroner Netzwerk-Kontext verhindern, dass ein lokales Modell private Daten durch Web-/Browser-/Cloud-Tools versendet.

## Geplante Ausgaben

Unter **Alltag → Geplante Ausgaben · Buckets** einen Namen, Betrag und Zielmonat eintragen. Reservierungen reduzieren das freie Geld und das verbleibende Monatsbudget, zählen aber nicht als ausgegebener Betrag. Bearbeiten verschiebt oder ändert die Reservierung, **Freigeben** entfernt sie. **Bezahlt → buchen** erfasst nach Bestätigung eine echte Ausgabe mit dem heutigen Datum und entfernt die Reservierung in einer Transaktion. Wiederholtes Buchen derselben Reservierung wird abgelehnt. Reservierungen sind einmalig pro Zielmonat, kein automatischer monatlicher Sparplan.

## Tarkov-Ziel

Im Raid-Planer Karte wählen, Ziel beschreiben und **Ziel speichern & Karte** klicken. Auf der Karte **Mein Ziel setzen** aktivieren und einen Kartenpunkt oder vorhandenen Marker anklicken. Das Ziel bleibt pro Karte inklusive Stockwerk gespeichert, kann ersetzt oder entfernt werden. Im Routenmodus kann **Ziel an Route anhängen** den Zielpunkt ergänzen. Die Route danach wie bisher speichern; ihr Endpunkt wird beschriftet angezeigt. Dies sind manuelle Routen, keine berechneten begehbaren Wege durch die Karte.

## Validierung

- Renderer-Build erfolgreich.
- `node --test tests/private-features.test.js tests/gamebase.test.js`: 23/23 erfolgreich. Einschließlich lokalem HTTP-Testserver, Remote-Modell-/Redirect-Sperre, Tool-Loop, Cloud-Kontexttrennung, Fehler ohne Cloud-Fallback, Bucket-Transaktion und Kartenvalidierung.
- Gesamtsuite: 93/117 erfolgreich, 24 fehlgeschlagen. Sie ist noch **nicht grün**: viele ältere Tests erwarten ausdrücklich die jetzt gesperrten Cloud-Kalender-/Backup-/Embedding-/Voice-Pfade oder Gemini als Standardmodell. Weitere Fixture-Tests konnten in dieser Arbeitskopie mangels binärer PDF-/Wakeword-Fixtures nicht laufen. Die zwei Tests mit fest erwarteter alter Schema-Version brauchen Anpassung an v9.
- Kein echter Modelllauf mit deiner Hardware und kein Windows-Electron-End-to-End-Test durchgeführt. Daher als Draft-PR zur weiteren Integration, nicht als ungeprüftes Release.
