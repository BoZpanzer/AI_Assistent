# Spielstatistiken – Definitionen

Alle Kennzahlen werden im Code berechnet (`src/main/services/gaming/stats.js`), ohne Sprachmodell, lokal gespeichert.

## Zeiträume

| Zeitraum | Definition |
|---|---|
| Sitzung | aktuelle Spielsitzung laut Prozesserkennung (seit Spielstart); läuft das Spiel nicht: die zuletzt beendete Sitzung |
| Heute | lokaler Kalendertag des PCs (Zeitzone des PCs, Wechsel um 00:00) |
| Gesamt | alle gespeicherten Daten |

## Escape from Tarkov

Quelle: Raid-Start und -Ende aus den Log-Dateien des Spiels (nur lesend, wie TarkovMonitor; kein Zugriff auf den Spielprozess, kein Anti-Cheat-Bereich). Das Log enthält **kein Raid-Ergebnis und keine Kills** – diese trägst du ein (Widget „Statistiken“ oder per Sprache/Chat, z. B. „Raid überlebt, 2 Kills und 5 Scavs“). Solche Einträge sind als „manuell“ bzw. „Log + manuell“ gekennzeichnet.

| Kennzahl | Definition | ohne Daten |
|---|---|---|
| Raids | erfasste Raids (Log oder manuell) | 0 |
| Überlebensrate | (überlebt + Run-Through) / Raids mit eingetragenem Ergebnis | „–“ (nicht 0 %) |
| Tode | Raids mit Ergebnis „gestorben“ (KIA); MIA und „verlassen“ zählen nicht als Tod | „–“ ohne Ergebnis |
| PMC-Kills / KI-Kills | Summe über Raids, in denen die Zahl eingetragen wurde | „–“ (nicht 0) |
| K/D (PMC) | PMC-Kills / Tode, nur über Raids mit eingetragenen PMC-Kills und Ergebnis | „–“; ohne Tode „– (keine Tode)“ |

Die Überlebensrate ist **keine Winrate**. Fragt man nach einer Tarkov-Winrate, sagt JARVIS das dazu.

Doppelte Ereignisse: ein Raid wird über Raid-ID + Tag einmalig erfasst (wiederholte Log-Zeilen, Neustarts, erneutes Einlesen erzeugen keinen zweiten Raid). Eine Eintragung ohne Raid-Angabe ergänzt den jüngsten Log-Raid ohne Ergebnis der letzten 3 Stunden; gibt es keinen, entsteht ein manueller Raid. Korrigieren/Entfernen: Liste „Letzte Raids“ im Widget.

## League of Legends

Quelle: gespeicherte Matches aus dem League-Client bzw. der Riot-API (in der Regel Ranked Solo/Duo).

| Kennzahl | Definition |
|---|---|
| Siege / Niederlagen | Anzahl gespeicherter Spiele mit Sieg / ohne Sieg |
| Winrate | Siege / Spiele (ohne Spiele: „–“) |
| KDA | (Kills + Assists) / max(1, Tode) |
| Konter | eigene Bilanz gegen den Lane-Gegner aus analysierten Spielen (Riot-Timeline): ohne Gegner die schwierigsten Lane-Gegner (mind. 2 Duelle), mit Gegner deine Champions mit der besten Bilanz. Unter 5 Spielen als „wenig Daten“ markiert. **Eigene Daten, keine Community-Statistik.** |

**Rolle:** aus Riot-Position (falls vorhanden), sonst Smite (Jungle), Support-Item (Support), Teamaufteilung und – bei doppelten Rollen – den Positionen der Minuten 3–10. Die Lane-Schätzung des League-Clients zählt nur als letzter Hinweis.

**Champion-Empfehlung (Championauswahl):** Kandidaten nur aus deinem Pool (gespeicherte Spiele, bevorzugt auf deiner Rolle). Punktzahl = geglättete Siegquote (Siege+2)/(Spiele+4) + kleiner Erfahrungsbonus + Bilanz gegen genau diese Gegner aus analysierten Spielen. Gebannte und vergebene Champions fallen weg. Die KI-Begründung (Sparmodell) darf nur Champions aus dem Pool nennen.

Die Matchup-Karte (Spielphasen, Win-Condition, Gefahren) ist eine **KI-Einschätzung** (Gemini, pro Matchup und Patch einmal erzeugt) und ausdrücklich nicht statistisch belegt.

## Sprachbefehle (ohne KI beantwortet)

- „Wie ist meine Überlebensrate heute?“ · „… diese Sitzung?“ · „… insgesamt?“
- „Wie viele Kills habe ich diese Sitzung?“ · „Wie ist meine K/D?“ · „Wie viele Raids heute?“
- „Raid überlebt, 3 Kills“ · „Raid gestorben“ · „Run-Through“ (letztere kurz, während Tarkov aktiv ist)
- „Wie ist meine Winrate in LoL heute?“ · „Konter gegen Draven in LoL“ · „Schwierigste Gegner in LoL“

Antworten auf Spracheingaben werden mit der eingestellten Stimme (KI-Stimme bzw. beim Zocken Google-Stimme) vorgelesen (abschaltbar: Einstellungen → Sprache). Automatische Statistik-Ansagen gibt es nicht.
