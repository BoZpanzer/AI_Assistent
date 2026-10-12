# Umstieg von JARVIS 1.x / Native 2.0 (Python)

JARVIS 3 ist ein vollständiger Neubau und läuft **neben** der alten Version – nichts wird überschrieben.

| | Alt (Native 2.0) | Neu (JARVIS 3) |
|---|---|---|
| Programm | PyInstaller-Ordner | `%LOCALAPPDATA%\Programs\JARVIS\JARVIS.exe` |
| Daten | `%LOCALAPPDATA%\JARVIS\local\jarvis.sqlite3` | `%APPDATA%\JARVIS\jarvis.sqlite3` |
| Secrets | Windows-Anmeldeinformationsverwaltung (keyring) | DPAPI-verschlüsselt (`secrets.json`) |

**Übernahme:** Einrichtungsassistent Schritt 1 oder Einstellungen → *Import* → „Alte JARVIS-Datenbank“. Die alte Datei wird nur gelesen; vorher wird die neue Datenbank gesichert. Ein zweiter Import derselben Datei wird erkannt und übersprungen.

Übernommen werden: Aufgaben (inkl. Wiederholung „daily/weekly/monthly“ und Priorität), Erinnerungen (`memories` → Brain), Gesprächsverlauf (als Gespräch „Import aus JARVIS 2.0“), lokale/ICS-Kalendertermine, Recherche-Notizen.

Nicht übernommen (bitte neu einrichten): API-Schlüssel und Google-Tokens (aus Sicherheitsgründen nicht auslesbar), Schulindex (wird aus dem OneDrive-Ordner automatisch neu und schneller aufgebaut), LoL-Live-Samples.

Danach kann die alte Version über „Apps & Features“ entfernt werden.

## Schema-Migrationen in JARVIS 3

Die Datenbank ist versioniert (`PRAGMA user_version`). Vor jeder Migration legt JARVIS automatisch eine Kopie unter `%APPDATA%\JARVIS\backups` an. Eine Datenbank aus einer neueren Version wird nicht geöffnet (Schutz vor Datenverlust beim Downgrade).
