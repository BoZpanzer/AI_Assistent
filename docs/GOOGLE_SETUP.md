# Google Kalender verbinden (einmalig, ca. 10 Minuten)

JARVIS nutzt das offizielle OAuth-Verfahren für Desktop-Apps (Loopback + PKCE). JARVIS ist kein
von Google verifiziertes Produkt. Deshalb legst du dir einen **eigenen OAuth-Client** an. Deine
Daten fließen dann nur zwischen deinem PC und Google.

## 1. Projekt anlegen
<https://console.cloud.google.com> → oben **Projekt auswählen → Neues Projekt** → Name „JARVIS“ → Erstellen → das Projekt oben auswählen.

## 2. Calendar API aktivieren
Suche oben „Google Calendar API“ (oder **APIs & Dienste → Bibliothek**) → **Aktivieren**.

## 3. Google Auth Platform einrichten
Menü → **Google Auth Platform** (früher „OAuth-Zustimmungsbildschirm“) → **Jetzt starten**:
- **App-Informationen:** Name `JARVIS`, Support-E-Mail = deine Adresse
- **Zielgruppe:** **Extern**
- **Kontaktdaten:** deine E-Mail → Richtlinie akzeptieren → **Erstellen**

## 4. Dich als Testnutzer eintragen
Google Auth Platform → **Zielgruppe (Audience)** → **Testnutzer → + Nutzer hinzufügen** → dein Google-Konto, dessen Kalender JARVIS nutzen soll.

## 5. OAuth-Client erstellen
Google Auth Platform → **Clients → + Client erstellen**
- Anwendungstyp: **Desktop-App**, Name: `JARVIS Desktop` → **Erstellen**
- Im Dialog **JSON herunterladen**. Die Datei enthält Client-ID und Client-Secret. Bei Desktop-Apps gilt das Secret laut Google nicht als echtes Geheimnis, trotzdem nicht öffentlich teilen.

## 6. In JARVIS verbinden
**Einstellungen → Kalender & Google → „JSON-Datei laden“** (oder im Einrichtungsassistenten) → **Im Browser anmelden** → Konto wählen.
Bei „Google hat diese App nicht überprüft“ → **Erweitert → Weiter zu JARVIS (unsicher)**. Das ist hier in Ordnung, weil es dein eigener Client ist. Danach Kalenderzugriff erlauben → „Verbunden“.

## 7. Wichtig: dauerhaft verbunden bleiben
Solange die App im Status **„Testen“** ist, laufen Googles Anmelde-Tokens **nach 7 Tagen** ab, und du müsstest dich wöchentlich neu anmelden. Deshalb:
Google Auth Platform → **Zielgruppe → App veröffentlichen → Bestätigen** (Status „In Produktion“).
Für den Eigengebrauch ist **keine Verifizierung** nötig. Google zeigt beim Anmelden nur weiter den Hinweis aus Schritt 6, und es gilt ein Limit von 100 Nutzern.

## Rechte und Datenschutz
- `calendar` (Termine lesen/schreiben) und `openid email` (Anzeige, welches Konto verbunden ist). Nichts weiter.
- Das Refresh-Token und das Client-Secret werden mit **Windows-DPAPI** verschlüsselt gespeichert.
- **Trennen** in den Einstellungen widerruft das Token bei Google.
- Synchronisiert wird alle 15 Minuten (einstellbar). Neue Termine aus Chat/Sprache landen nach deiner Bestätigung sofort in Google.

## Häufige Fehler
| Meldung | Lösung |
|---|---|
| `Error 403: access_denied` | Du bist nicht als Testnutzer eingetragen (Schritt 4) oder hast ein anderes Konto gewählt. |
| `Google Calendar API has not been used in project …` | Schritt 2 vergessen, oder falsches Projekt ausgewählt. |
| `invalid_client` / `redirect_uri_mismatch` | Der Client ist nicht vom Typ **Desktop-App**. Lege einen neuen an (Schritt 5). |
| Nach einer Woche „Neu anmelden“ | Die App steht noch auf „Testen“ → Schritt 7. |
