# Updates & Releases (GitHub)

JARVIS aktualisiert sich über **GitHub Releases** deines Repos. Sobald ein neues Release existiert,
erscheint oben in der Titelleiste **„Aktualisieren auf x.y.z“** (zusätzlich Tray-Eintrag und
Benachrichtigung). Ein Klick zeigt den Changelog. „Jetzt aktualisieren“ macht dann Folgendes:

1. lädt `JARVIS_Setup.exe` herunter (Fortschritt im Button),
2. prüft **SHA-256** und die **Ed25519-Signatur** von `update.json`,
3. legt eine **Datensicherung** an (`%APPDATA%\JARVIS\backups\vor-update-x.y.z.zip`),
4. startet den Installer **still** (`/S /RELAUNCH`). Er ersetzt nur die Programmdateien.
   Deine Daten in `%APPDATA%\JARVIS` bleiben unberührt.
5. JARVIS startet automatisch neu.

Geprüft wird beim Start (nach 2 Min.) und danach alle 6 Stunden, **nie während eines Spiels**.
Installiert wird **nur auf Klick**. Ein Update ohne gültige Signatur zeigt JARVIS gar nicht als
Button an, und die automatische Installation ist dann gesperrt.

## Einmalige Einrichtung

### 1. Schlüsselpaar erzeugen (in Git Bash, im Repo-Ordner)

```bash
openssl genpkey -algorithm ed25519 -out update-private-key.pem
openssl pkey -in update-private-key.pem -pubout -out build/update-public-key.pem
```

- `build/update-public-key.pem` → **committen** (wird in die App eingebaut).
- `update-private-key.pem` → **niemals committen** (steht in `.gitignore`). Bewahre es sicher
  auf, z. B. im Passwortmanager. Geht es verloren, brauchst du ein neues Paar, und die bereits
  installierte Version muss einmal manuell aktualisiert werden.

### 2. Privaten Schlüssel als GitHub-Secret hinterlegen

Repo → **Settings → Secrets and variables → Actions → New repository secret**

- Name: `UPDATE_PRIVATE_KEY`
- Wert: den kompletten Inhalt von `update-private-key.pem` einfügen, inklusive der Zeilen
  `-----BEGIN PRIVATE KEY-----` und `-----END PRIVATE KEY-----`.

### 3. Privates Repo? Token in JARVIS eintragen

Bei einem **öffentlichen** Repo ist nichts weiter nötig.

Bei einem **privaten** Repo braucht JARVIS Lesezugriff:
GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → *Generate new token*

- Repository access: *Only select repositories* → dein JARVIS-Repo
- Permissions → Repository → **Contents: Read-only** (sonst nichts)

Den Token trägst du in JARVIS unter **Einstellungen → Daten, Sicherung & Updates →
GitHub-Token** ein. Er wird mit Windows-DPAPI verschlüsselt und nur an `api.github.com`
gesendet, nicht an den Download-Speicher, auf den GitHub weiterleitet.

## Ein Release veröffentlichen

1. In `CHANGELOG.md` einen Abschnitt `## 3.3.1 – Titel` mit den Änderungen anlegen und committen.
   Er wird zum Changelog im Update-Dialog.
2. Tag setzen und pushen:

   ```bash
   git tag v3.3.1
   git push origin v3.3.1
   ```

   Alternativ geht es ohne Terminal: GitHub → **Actions → „Release (Windows)“ → Run workflow** → Version eingeben.
3. Die Action `.github/workflows/release.yml` (Windows-Runner, ca. 15–20 Min.) erledigt dann alles Weitere:
   - übernimmt die Version aus dem Tag (in `package.json` musst du nichts ändern),
   - baut die Update-Quelle (`owner/repo`) ein,
   - führt alle Tests aus, baut `JARVIS.exe` + `JARVIS_Setup.exe` und macht den Smoke-Test,
   - signiert `update.json` und **prüft dabei**, ob der Schlüssel zu `build/update-public-key.pem` passt,
   - veröffentlicht das Release mit `JARVIS_Setup.exe`, `update.json` und `SHA256SUMS.txt`.

Spätestens 6 Stunden danach zeigt jede installierte JARVIS-Version den Button. Sofort geht es über
Einstellungen → „Jetzt nach Updates suchen“.

## Die allererste Installation

Ältere Versionen (z. B. 3.2.0 aus dem Chat) kennen weder dein Repo noch deinen Schlüssel.
Installiere deshalb **einmal manuell** das erste Release aus GitHub
(`JARVIS_Setup.exe` aus dem Release herunterladen und ausführen, deine Daten bleiben erhalten).
Ab dann laufen alle weiteren Updates über den Button.

## Hinweise

- **Code-Signatur (Authenticode)** der EXE ist davon unabhängig und braucht ein kostenpflichtiges
  Zertifikat. Ohne sie zeigt Windows SmartScreen beim ersten manuellen Start „Unbekannter
  Herausgeber“ (→ „Weitere Informationen“ → „Trotzdem ausführen“). Stille Updates aus der App
  heraus sind davon nicht betroffen.
- **Kosten:** Für öffentliche Repos sind GitHub Actions kostenlos. Bei privaten Repos sind
  2.000 Minuten/Monat frei, und Windows-Minuten zählen doppelt. Ein Release kostet also etwa
  30–40 Freiminuten. Die Tests bei jedem Push laufen auf Linux (`tests.yml`, ca. 2 Min.). Der
  volle Windows-Installationstest (`windows.yml`) läuft nur bei Pull Requests oder per Hand.
- **Altes Verfahren** (eigene Manifest-URL im Feld „Update-Kanal“) wird weiterhin unterstützt.
