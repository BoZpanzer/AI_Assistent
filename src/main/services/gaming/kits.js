'use strict';
/**
 * Spiel-Kits: pro Spiel passende Fragen, Spielstand-Kategorien, Checklisten-Vorlagen,
 * geprüfte Links/Wikis und ein Layout aus den festen Bausteinen (kein generierter Code).
 *
 * Regeln:
 * - Wikis/Links wurden geprüft (Stand Oktober 2026). Wiki-APIs, die nicht antworten,
 *   blendet JARVIS zur Laufzeit aus (dann bleibt die Recherche).
 * - Checklisten enthalten nur gesicherte Fakten (z. B. Bossnamen) oder sind als
 *   Vorlage formuliert; alles ist vom Nutzer änderbar.
 * - Fragen mit „…“ werden ins Eingabefeld gelegt (zum Ergänzen), alle anderen direkt gestellt.
 */

const steamNews = (appid) => ({ label: 'Patchnotes & News (Steam)', url: `https://store.steampowered.com/news/app/${appid}` });
const fandom = (sub, label) => ({ api: `https://${sub}.fandom.com/api.php`, label: `${label} (Fandom)` });
const wikigg = (sub, label) => ({ api: `https://${sub}.wiki.gg/api.php`, label: `${label} (wiki.gg)` });

/** Layouts je Genre – nur Widgets aus dem festen Baukasten. */
const GENRE_LAYOUTS = {
  survival: ['ask', 'progress', 'timers', 'checklist', 'links', 'wiki', 'notes', 'map', 'game-research', 'sources', 'other-games'],
  shooter: ['ask', 'progress', 'checklist', 'links', 'notes', 'wiki', 'game-research', 'map', 'sources', 'other-games'],
  racing: ['ask', 'progress', 'notes', 'links', 'checklist', 'game-research', 'sources', 'other-games'],
  sports: ['ask', 'progress', 'checklist', 'links', 'notes', 'game-research', 'sources', 'other-games'],
  builder: ['ask', 'progress', 'checklist', 'links', 'wiki', 'notes', 'timers', 'game-research', 'sources', 'other-games'],
  rpg: ['ask', 'progress', 'checklist', 'wiki', 'links', 'notes', 'map', 'game-research', 'sources', 'other-games'],
  training: ['ask', 'progress', 'checklist', 'notes', 'links', 'game-research', 'other-games'],
  casual: ['ask', 'notes', 'progress', 'links', 'game-research', 'other-games'],
};

/** Allgemeine Fragen je Genre (für Spiele mit wenig Spielzeit / unbekannte Spiele). */
const GENRE_QUESTIONS = {
  survival: ['Was sollte ich in den ersten Stunden zuerst machen?', 'Wo finde ich …?', 'Wie stelle ich … her?', 'Was ist im letzten Update neu?'],
  shooter: ['Welche Einstellungen (Grafik/Sensitivity) sind sinnvoll?', 'Welche Waffen/Loadouts sind gerade stark?', 'Was hat der letzte Patch geändert?', 'Tipps für die Map …'],
  racing: ['Wie stelle ich Lenkrad/Controller am besten ein?', 'Gutes Setup für …', 'Welches Fahrzeug lohnt sich für …?'],
  sports: ['Welche Taktik ist gerade stark?', 'Wie verbessere ich mich in …?'],
  builder: ['Womit sollte ich am Anfang anfangen?', 'Wie löse ich das Problem …?', 'Welche Forschung/Upgrades zuerst?'],
  rpg: ['Welcher Build passt zu mir?', 'Wie besiege ich …?', 'Wo finde ich …?'],
  training: ['Welche Routine für 15 Minuten täglich?'],
  casual: ['Tipps für Einsteiger?', 'Wie löse ich …?'],
};

const GENRE_PROGRESS = {
  survival: [['base', 'Basis', 'Hauptbasis', ''], ['item', 'Items & Ausrüstung', '', ''], ['achievement', 'Bosse & Ziele', '', 'geschafft'], ['other', 'Server & Welt', 'Server', '']],
  shooter: [['rank', 'Rang', 'Aktueller Rang', ''], ['loadout', 'Loadouts & Waffen', '', ''], ['settings', 'Einstellungen', 'Sensitivity', ''], ['goal', 'Ziele', '', '']],
  racing: [['vehicle', 'Fahrzeuge', '', ''], ['track', 'Strecken & Bestzeiten', '', ''], ['setup', 'Setups', '', ''], ['goal', 'Ziele', '', '']],
  sports: [['team', 'Team', '', ''], ['mode', 'Modi & Ränge', '', ''], ['goal', 'Ziele', '', '']],
  builder: [['map', 'Spielstände & Karten', '', ''], ['research', 'Forschung', '', ''], ['goal', 'Ziele', '', '']],
  rpg: [['build', 'Build & Level', 'Level', ''], ['item', 'Waffen & Ausrüstung', '', ''], ['achievement', 'Bosse', '', 'besiegt'], ['quest', 'Quests', '', '']],
  training: [['score', 'Bestwerte', '', ''], ['goal', 'Ziele', '', '']],
  casual: [['goal', 'Fortschritt', '', ''], ['other', 'Sonstiges', '', '']],
};

const ARK_BOSSES = ['Broodmother Lysrix', 'Megapithecus', 'Dragon', 'Overseer (Tek-Höhle)'];
const ARK_ARTIFACTS = ['Artifact of the Hunter', 'Artifact of the Pack', 'Artifact of the Massive', 'Artifact of the Clever', 'Artifact of the Skylord', 'Artifact of the Devourer', 'Artifact of the Immune', 'Artifact of the Strong', 'Artifact of the Cunning', 'Artifact of the Brute'];
const ARK_QUESTIONS = ['Wie zähme ich … am schnellsten (Futter, Betäubung)?', 'Wie funktioniert Zucht und Imprinting?', 'Was brauche ich für den Broodmother-Kampf (Tiere, Artefakte, Tribute)?', 'Wo finde ich auf The Island Metall, Kristall und Obsidian?', 'Welche Tiere sind für das Farmen von … am besten?', 'Welches Kibble mag …?', 'Wie baue ich eine sichere Basis gegen Raids?'];
const ARK_PROGRESS = [['creature', 'Zähmungen', 'Rex', 'Level 220'], ['base', 'Basis', 'Hauptbasis', 'Red Obelisk'], ['item', 'Items & Engramme', 'Tek-Rüstung', ''], ['achievement', 'Bosse & Artefakte', 'Broodmother', 'besiegt']];

const KITS = {
  // ------------------------------------------------------------------ Survival
  ark: {
    genre: 'survival', questions: ARK_QUESTIONS, progressCats: ARK_PROGRESS,
    checklists: [{ name: 'Bosse (The Island)', items: ARK_BOSSES }, { name: 'Artefakte (The Island)', items: ARK_ARTIFACTS }],
    links: [{ label: 'Dododex – Zähm- & Zuchtrechner', url: 'https://www.dododex.com/' }, steamNews(346110)],
  },
  ark_asa: {
    genre: 'survival', questions: ARK_QUESTIONS, progressCats: ARK_PROGRESS,
    checklists: [{ name: 'Bosse (The Island)', items: ARK_BOSSES }],
    links: [{ label: 'Dododex – Zähm- & Zuchtrechner', url: 'https://www.dododex.com/' }, steamNews(2399830)],
  },
  pixark: {
    genre: 'survival', wiki: fandom('pixark', 'PixARK Wiki'),
    questions: ['Wie zähme ich … in PixARK?', 'Wo finde ich …?', 'Wie stelle ich … her?', 'Welche Kreaturen sind am Anfang nützlich?'],
    links: [steamNews(593600)],
  },
  rust: {
    genre: 'survival', wiki: fandom('rust', 'Rust Wiki'),
    questions: ['Wie viel Schwefel/Sprengstoff brauche ich, um … zu raiden?', 'Was mache ich direkt nach dem Wipe zuerst?', 'Welche Keycards brauche ich für welche Monumente?', 'Wie baue ich eine kompakte Starter-Base mit Airlock?', 'Wie funktioniert Elektrizität (Solar, Batterien, Turrets)?', 'Was ist im aktuellen Monats-Update neu?', 'Wie schütze ich meine Basis gegen Decay und Offline-Raids?'],
    progressCats: [['base', 'Basis', 'Hauptbase', 'Steinwände, 2x2'], ['blueprint', 'Blueprints', 'AK-47', 'gelernt'], ['server', 'Server & Wipe', 'Server', ''], ['resource', 'Ressourcen', 'Schwefel', '']],
    checklists: [{ name: 'Nach dem Wipe', items: ['Steinwerkzeuge & Schlafsack', 'Startplatz wählen', 'Basis mit Tool Cupboard', 'Codeschloss an jede Tür', 'Ofen & Werkbank Stufe 1', 'Schrott für Werkbank Stufe 2 sammeln'] }],
    schedule: { label: 'Monatlicher Force-Wipe', rule: 'first-thursday', utc: '19:00', note: 'erster Donnerstag im Monat, meist gegen 19:00 UTC – kann sich verzögern' },
    links: [{ label: 'RustMaps – Karten & Heatmaps', url: 'https://rustmaps.com/' }, { label: 'RustClash Wiki – Items & Crafting-Rechner', url: 'https://wiki.rustclash.com/' }, { label: 'Rust – offizielle Seite (Facepunch)', url: 'https://rust.facepunch.com/' }, steamNews(252490)],
  },
  palworld: {
    genre: 'survival', wiki: wikigg('palworld', 'Palworld Wiki'),
    questions: ['Welche Eltern brauche ich, um … zu züchten?', 'Wo finde ich …?', 'Welche Arbeitsfähigkeiten hat …?', 'Wie besiege ich den Turm-Boss …?', 'Welche passiven Skills sind am besten für Kampf/Arbeit?', 'Wie baue ich eine effiziente Basis (Pals, Nahrung, Produktion)?'],
    progressCats: [['pal', 'Pals', 'Anubis', 'Level 40'], ['base', 'Basis', 'Hauptbasis', ''], ['tech', 'Technologie', '', ''], ['achievement', 'Turm-Bosse', 'Zoe & Grizzbolt', 'besiegt']],
    checklists: [{ name: 'Turm-Bosse', items: ['Zoe & Grizzbolt (Rayne Syndicate)', 'Lily & Lyleen (Free Pal Alliance)', 'Axel & Orserk (Brothers of the Eternal Pyre)', 'Marcus & Faleris (PIDF)', 'Victor & Shadowbeak (PAL Genetic Research Unit)', 'Saya & Selyne (Sakurajima)', 'Bjorn & Bastigor (Feybreak)'] }],
    links: [{ label: 'paldb.cc – Pals, Zucht, Items', url: 'https://paldb.cc/de/' }, steamNews(1623730)],
  },
  raft: {
    genre: 'survival', wiki: fandom('raft', 'Raft Wiki'),
    questions: ['Was brauche ich für Empfänger, Antenne und Navigationstisch?', 'Wie komme ich zur nächsten Story-Insel?', 'Wie bekomme ich Titan?', 'Wie fange und halte ich Lama, Ziege und Huhn?', 'Wie schütze ich das Floß vor dem Hai?', 'Was brauche ich für Motor und Steuerrad?'],
    progressCats: [['story', 'Story-Inseln', 'Radio Tower', 'erledigt'], ['raft', 'Floß', 'Größe/Ausbau', ''], ['item', 'Items & Forschung', '', '']],
    checklists: [{ name: 'Story-Inseln', items: ['Radio Tower', 'Vasagatan', 'Balboa Island', 'Caravan Town', 'Tangaroa', 'Varuna Point', 'Temperance', 'Utopia'] }],
    links: [steamNews(648800)],
  },
  grounded: {
    genre: 'survival', wiki: wikigg('grounded', 'Grounded Wiki'),
    questions: ['Wo finde ich …?', 'Wie stelle ich Werkzeuge der Stufe 2/3 her?', 'Welche Rüstung hilft gegen Spinnen?', 'Wie besiege ich den Boss …?', 'Welche Analyse-Ergebnisse (BURG.L) schalten was frei?'],
    links: [steamNews(962130)],
  },
  theforest: {
    genre: 'survival', wiki: fandom('theforest', 'The Forest Wiki'),
    questions: ['Wo finde ich Kletteraxt, Rebreather und Moderne Axt?', 'Wie baue ich eine sichere Basis gegen Kannibalen?', 'Was brauche ich, um das Spiel zu beenden?', 'Wie bleibe ich satt und hydriert?'],
    links: [steamNews(242760)],
  },
  theisle: {
    genre: 'survival',
    questions: ['Welche Dinos sind in Evrima aktuell spielbar?', 'Wie wächst mein … am schnellsten?', 'Was frisst …, und wo finde ich Nahrung?', 'Wie funktionieren Mutationen?', 'Wie funktioniert die Migration (Zonen, Patrouillen)?', 'Was hat der letzte Patch geändert?'],
    progressCats: [['dino', 'Dinos', 'Carnotaurus', 'Wachstum 75 %'], ['mutation', 'Mutationen', '', ''], ['group', 'Gruppe/Herde', '', ''], ['server', 'Server', '', '']],
    links: [steamNews(376210)],
  },
  hytale: {
    genre: 'survival', wiki: wikigg('hytale', 'Hytale Wiki'),
    questions: ['Wie stelle ich … her?', 'Wo finde ich das Erz …?', 'Wie zähme oder halte ich Tiere?', 'Was ist im letzten Early-Access-Update neu?', 'Wie richte ich einen Server oder Mods ein?'],
    links: [{ label: 'Hytale – offizielle Seite & News', url: 'https://hytale.com/' }],
  },

  // ------------------------------------------------------------------ Shooter
  cs2: {
    genre: 'shooter', wiki: fandom('counterstrike', 'Counter-Strike Wiki'),
    questions: ['Welche Smokes und Flashes brauche ich auf Mirage für A und B?', 'Wie funktioniert die Economy (Eco, Force-Buy, Full-Buy)?', 'Wie verbessere ich Spray-Control bei AK und M4?', 'Wie funktioniert Premier und das CS Rating?', 'Welche Crosshair- und Videoeinstellungen sind sinnvoll?', 'Was ändert das letzte CS2-Update?', 'Callouts für die Map …'],
    progressCats: [['rank', 'Rang', 'Premier-Rating', ''], ['map', 'Maps', 'Mirage', ''], ['settings', 'Einstellungen', 'Crosshair-Code', ''], ['goal', 'Ziele', '', '']],
    checklists: [{ name: 'Aufwärmen', items: ['10 Min. Aim-Training', 'Deathmatch', 'Spray-Übung (AK/M4)', 'Utility der Map durchgehen'] }],
    links: [{ label: 'Leetify – Match-Analyse', url: 'https://leetify.com/' }, steamNews(730)],
  },
  apexlegends: {
    genre: 'shooter', wiki: wikigg('apexlegends', 'Apex Legends Wiki'),
    questions: ['Welche Map ist gerade in Rotation?', 'Welche Legenden sind aktuell stark?', 'Wie spiele ich … richtig?', 'Welche Waffenkombination ist gerade gut?', 'Was hat der letzte Patch geändert?', 'Wie funktioniert Ranked (Punkte, Abzüge)?'],
    progressCats: [['rank', 'Rang', 'Ranked', ''], ['legend', 'Legenden', 'Main', ''], ['loadout', 'Waffen', '', ''], ['goal', 'Ziele', '', '']],
    links: [{ label: 'Apex Legends Status – aktuelle Map', url: 'https://apexlegendsstatus.com/current-map' }, steamNews(1172470)],
  },
  sandstorm: {
    genre: 'shooter',
    questions: ['Welches Loadout passt zur Klasse …?', 'Wie funktionieren Supply-Punkte?', 'Taktiken für Checkpoint (Angriff/Verteidigung)?', 'Wann rufe ich Artillerie oder Drohne?'],
    links: [steamNews(581320)],
  },
  readyornot: {
    genre: 'shooter', wiki: wikigg('readyornot', 'Ready or Not Wiki'),
    questions: ['Wie bekomme ich auf … einen S-Rang?', 'Wie gehe ich richtig mit Verdächtigen und Zivilisten um?', 'Welche Ausrüstung passt für die Mission …?', 'Wie steuere ich mein KI-Team gut?'],
    progressCats: [['mission', 'Missionen', '', 'Rang'], ['loadout', 'Loadouts', '', ''], ['goal', 'Ziele', '', '']],
    links: [steamNews(1144200)],
  },
  arma3: {
    genre: 'shooter', wiki: { api: 'https://community.bistudio.com/wikidata/api.php', label: 'Bohemia Community Wiki' },
    questions: ['Welche Mods (z. B. ACE) brauche ich für Server …?', 'Wie fliege ich einen Helikopter sauber?', 'Wie baue ich im Editor einen Trigger?', 'Welche Steuerung/Haltungen sind wichtig?'],
    links: [steamNews(107410)],
  },
  tfd: {
    genre: 'shooter',
    questions: ['Wie farme ich den Descendant …?', 'Wo droppt …?', 'Guter Build für …?', 'Wie funktionieren Module und Katalysatoren?'],
    links: [{ label: 'GamesLantern – TFD-Datenbank & Builds', url: 'https://tfd.gameslantern.com/' }, steamNews(2074920)],
  },
  pubg: { genre: 'shooter', links: [steamNews(578080)] },
  tabg: { genre: 'casual', links: [steamNews(823130)] },
  overwatch: { genre: 'shooter', questions: ['Welche Helden passen zu meiner Rolle …?', 'Welche Helden sind aktuell stark?', 'Was hat der letzte Patch geändert?'], links: [steamNews(2357570)] },
  vigor: { genre: 'shooter' },

  // ------------------------------------------------------------------ Training
  aimlabs: {
    genre: 'training',
    questions: ['Welche Aufgaben trainieren Flicks, Tracking und Switching?', 'Wie übertrage ich meine CS2-Sensitivity?', 'Welche Routine für 15 Minuten täglich?'],
    progressCats: [['score', 'Bestwerte', 'Gridshot', ''], ['settings', 'Sensitivity', 'cm/360', ''], ['goal', 'Ziele', '', '']],
    checklists: [{ name: 'Tägliche Routine', items: ['Flicks', 'Tracking', 'Target Switching', 'Präzision'] }],
    links: [{ label: 'Aimlabs', url: 'https://www.aimlabs.com/' }, steamNews(714010)],
  },

  // ------------------------------------------------------------------ Racing
  assettocorsa: {
    genre: 'racing',
    questions: ['Wie stelle ich das Force Feedback am Lenkrad ein?', 'Gutes Setup für … auf …?', 'Wie richte ich Content Manager und Custom Shaders Patch ein?', 'Wie fahre ich die Ideallinie auf …?'],
    links: [{ label: 'Content Manager (Launcher & Mods)', url: 'https://acstuff.club/app/' }, steamNews(244210)],
  },
  raceroom: { genre: 'racing', links: [steamNews(211500)] },
  mxbikes: {
    genre: 'racing',
    questions: ['Wie stelle ich die Federung für Sprünge ein?', 'Wie lerne ich Scrubs und Whips?', 'Gute Controller-Einstellungen für MX Bikes?', 'Wo finde ich Strecken und Bikes (Mods)?', 'Wie fahre ich sauber durch Spurrillen (Ruts)?'],
    progressCats: [['vehicle', 'Bikes', '', ''], ['track', 'Strecken & Bestzeiten', '', ''], ['setup', 'Setups', '', ''], ['goal', 'Ziele', '', '']],
    links: [{ label: 'MX Bikes – offizielle Seite & Forum', url: 'https://mx-bikes.com/' }, steamNews(655500)],
  },
  thecrew2: {
    genre: 'racing',
    questions: ['Wie verdiene ich schnell Bucks und Follower?', 'Welche Fahrzeuge sind pro Disziplin am besten?', 'Wie funktionieren Performance-Teile und Pro Settings?', 'Wie steige ich im Icon-Level auf?'],
    progressCats: [['vehicle', 'Fahrzeuge', '', ''], ['discipline', 'Disziplinen', 'Street Race', ''], ['goal', 'Icon-Level & Ziele', '', '']],
    links: [steamNews(646910)],
  },
  nfsheat: {
    genre: 'racing',
    questions: ['Wie steige ich schnell im Ruf (REP) auf?', 'Bestes Auto zum Driften und für Rennen?', 'Wie bekomme ich Ultimate- und Ultimate+-Teile?', 'Wie verdiene ich am Tag schnell Geld (Bank)?'],
    checklists: [{ name: 'Sammelobjekte & Aktivitäten', items: ['Street Art', 'Werbetafeln', 'Flamingos', 'Driftzonen', 'Speed Traps', 'Speed Runs', 'Sprünge'] }],
    links: [steamNews(1222680)],
  },

  // ------------------------------------------------------------------ Sport
  ea_fc: {
    genre: 'sports',
    questions: ['Welche SBCs lohnen sich gerade?', 'Wie baue ich ein starkes Team mit … Coins?', 'Welche Formation und Taktik sind aktuell stark?', 'Wie funktioniert die Chemie?', 'Welche Skill Moves lohnen sich wirklich?', 'Was bringen die aktuellen Promos?'],
    progressCats: [['team', 'Ultimate Team', 'Teamwert', ''], ['mode', 'Rivals & Champions', 'Division', ''], ['career', 'Karriere', 'Verein', ''], ['goal', 'Ziele', '', '']],
    checklists: [{ name: 'Wöchentlich', items: ['Division Rivals spielen', 'Champions-Quali', 'Aufgaben/Objectives', 'Lohnende SBCs prüfen'] }],
    links: [{ label: 'FUTBIN – Preise, SBCs, Squad Builder', url: 'https://www.futbin.com/' }],
  },

  // ------------------------------------------------------------------ Aufbau & Simulation
  jwe: {
    genre: 'builder', wiki: fandom('jurassicworld-evolution', 'Jurassic World Evolution Wiki'),
    questions: ['Wie erhöhe ich das Wohlbefinden meiner Dinos?', 'Welche Dinos vertragen sich in einem Gehege?', 'Wie bekomme ich 5 Sterne auf …?', 'Wie verbessere ich Genome und Lebensdauer?', 'Was tun bei Sturm und Stromausfall?'],
    progressCats: [['island', 'Inseln', 'Isla Matanceros', '5 Sterne'], ['dino', 'Dinos', '', ''], ['research', 'Forschung', '', '']],
    checklists: [{ name: 'Inseln', items: ['Isla Matanceros', 'Isla Muerta', 'Isla Tacaño', 'Isla Pena', 'Isla Sorna', 'Isla Nublar'] }],
    links: [steamNews(648350)],
  },
  jwe2: {
    genre: 'builder', wiki: fandom('jurassicworld-evolution', 'Jurassic World Evolution Wiki'),
    questions: ['Welche Dinos vertragen sich in einem Gehege?', 'Wie halte ich die Besucher zufrieden?', 'Wie funktioniert Chaos Theory?', 'Welche Forschung zuerst?'],
    links: [steamNews(1244460)],
  },
  timberborn: {
    genre: 'builder', wiki: wikigg('timberborn', 'Timberborn Wiki'),
    questions: ['Wie überstehe ich die Dürre (Wasser speichern)?', 'Wie viel Nahrung und Wasser brauchen meine Biber?', 'Folktails oder Iron Teeth – was ist der Unterschied?', 'Wie baue ich Dämme und Schleusen?', 'Was tun gegen verseuchtes Wasser (Badwater)?', 'Welche Wissenschaft zuerst?'],
    progressCats: [['colony', 'Kolonie', 'Folktails', ''], ['map', 'Karten', '', ''], ['research', 'Wissenschaft', '', '']],
    links: [steamNews(1062090)],
  },
  stardew: {
    genre: 'builder',
    wiki: { api: 'https://de.stardewvalleywiki.com/mediawiki/api.php', label: 'Stardew Valley Wiki (deutsch)', fallback: [{ api: 'https://stardewvalleywiki.com/mediawiki/api.php', label: 'Stardew Valley Wiki' }] },
    questions: ['Was verschenke ich am besten an …?', 'Welche Pflanzen lohnen sich in dieser Jahreszeit?', 'Was fehlt mir noch für das Gemeinschaftszentrum?', 'Wann hat … Geburtstag?', 'Wo und wann fange ich …?', 'Wie komme ich in der Mine schneller nach unten?'],
    progressCats: [['friend', 'Freundschaften', '', 'Herzen'], ['farm', 'Farm', '', ''], ['bundle', 'Gemeinschaftszentrum', '', ''], ['mine', 'Mine & Höhle', 'Ebene', '']],
    checklists: [{ name: 'Gemeinschaftszentrum', items: ['Vorratskammer (Pantry)', 'Handwerksraum (Crafts Room)', 'Aquarium (Fish Tank)', 'Kesselraum (Boiler Room)', 'Pinnwand (Bulletin Board)', 'Tresor (Vault)'] }],
    links: [{ label: 'Stardew Valley Wiki (deutsch)', url: 'https://de.stardewvalleywiki.com/' }, steamNews(413150)],
  },
  supermarket: { genre: 'builder', questions: ['Wie verdiene ich am Anfang am schnellsten?', 'Welche Preise sollte ich setzen?', 'Welche Upgrades zuerst?'], links: [steamNews(2709570)] },
  supremacyww3: { genre: 'builder', questions: ['Wie baue ich am Anfang die Wirtschaft auf?', 'Welche Einheiten sind gegen … gut?'] },

  // ------------------------------------------------------------------ RPG
  eldenring: {
    genre: 'rpg', wiki: wikigg('eldenring', 'Elden Ring Wiki'),
    questions: ['Wie besiege ich …?', 'Welcher Build passt zu meinen Attributen?', 'Wo finde ich Schmiedesteine für meine Waffe?', 'Wo finde ich den Talisman …?', 'In welcher Reihenfolge spiele ich die Gebiete?', 'Welche NPC-Questreihe läuft gerade und was ist der nächste Schritt?'],
    progressCats: [['build', 'Build & Level', 'Level', ''], ['item', 'Waffen & Talismane', '', ''], ['achievement', 'Bosse', 'Margit', 'besiegt'], ['quest', 'NPC-Quests', '', '']],
    checklists: [{ name: 'Hauptbosse', items: ['Margit, das Grausame Mal', 'Godrick der Verpflanzte', 'Rennala, Königin des Vollmonds', 'Sternengeißel Radahn', 'Rykard, Fürst der Blasphemie', 'Morgott, der Omenkönig', 'Feuerriese', 'Gottlosen-Duo', 'Maliketh, die Schwarze Klinge', 'Godfrey / Hoarah Loux', 'Radagon & Elden-Bestie', 'Malenia (optional)', 'Mohg, Fürst des Blutes (optional)'] }],
    links: [{ label: 'Interaktive Karte (Fextralife)', url: 'https://eldenring.wiki.fextralife.com/Interactive+Map' }, steamNews(1245620)],
  },
  throneandliberty: { genre: 'rpg', questions: ['Welche Waffenkombination passt zu mir?', 'Wie levele ich am schnellsten?', 'Was lohnt sich täglich und wöchentlich?'], links: [steamNews(2429640)] },

  // ------------------------------------------------------------------ Casual & Party
  humanfallflat: { genre: 'casual', questions: ['Wie löse ich das Level …?', 'Wo sind die versteckten Erfolge im Level …?'], links: [steamNews(477160)] },
  shellshock: { genre: 'casual', questions: ['Wie schätze ich Winkel und Kraft besser ein?', 'Welche Waffen lohnen sich?'], links: [steamNews(326460)] },
  vrchat: { genre: 'casual', questions: ['Wie lade ich einen eigenen Avatar hoch?', 'Gute Welten für …?'], links: [steamNews(438100)] },
  otter: { genre: 'casual' },
  onearmedcook: { genre: 'casual' },
};

/**
 * Was der Screenshot-Hotkey in einem Spiel zusätzlich tun soll (Anweisung an das Chat-Modell, nur Werkzeuge
 * aus dem festen Satz). Genre-Standard + spielspezifisch. Timer → add_game_timer, Werte → update_game_progress.
 */
const TIMER_RULE = 'Sind Restzeiten sichtbar (Bau, Forschung, Training, Zucht, Craft, Abklingzeit …), lege für jede eine Erinnerung mit add_game_timer an (Bezeichnung wie im Spiel, Restzeit exakt abgelesen; unsichere Werte nicht anlegen, sondern nachfragen) und nenne sie kurz.';
const PROGRESS_RULE = 'Sichtbare Werte meines Spielstands (Level, Stufen, Ränge, Ausrüstung) speichere mit update_game_progress.';
const GENRE_SCREEN = {
  survival: TIMER_RULE + ' ' + PROGRESS_RULE,
  builder: TIMER_RULE + ' ' + PROGRESS_RULE,
  rpg: PROGRESS_RULE + ' Bei Fragen zu Bossen/Quests: Hilfe in Stufen (erst Hinweis, Lösung nur auf Nachfrage).',
  shooter: 'Ist ein Scoreboard oder eine Match-Zusammenfassung zu sehen, lies meine Werte (Rang, KDA/Kills, Schaden, Platzierung) exakt ab und speichere Rang/Rating mit update_game_progress.',
  racing: 'Sind Rundenzeiten oder Ergebnisse sichtbar, lies sie exakt ab und speichere Bestzeiten pro Strecke mit update_game_progress.',
  sports: PROGRESS_RULE,
};
const SCREEN = {
  rok: TIMER_RULE + ' Rise of Kingdoms: Kommandanten (Sterne, Level, Skills), Gebäudestufen, Forschung und VIP mit update_game_progress speichern. Ist ein Speedup-Inventar zu sehen, die Anzahl je Typ und Dauer mit rok_speedups (set) übernehmen.',
  minecraft: 'Ist der F3-Bildschirm offen, lies die XYZ-Koordinaten und die Dimension exakt ab und speichere sie mit update_game_progress (Kategorie „Wegpunkte“, Name aus meiner Frage oder „Wegpunkt“).',
  ark: TIMER_RULE + ' ARK: Ist ein Stat-Fenster einer Kreatur zu sehen, speichere Art, Level und Werte (HP, Ausdauer, Gewicht, Nahkampf, Mutationen) mit update_game_progress; bei Babys: ark_baby (add) mit abgelesener Reife-Restzeit und Zeit bis zur nächsten Prägung.',
  ark_asa: TIMER_RULE + ' ARK: Ist ein Stat-Fenster einer Kreatur zu sehen, speichere Art, Level und Werte (HP, Ausdauer, Gewicht, Nahkampf, Mutationen) mit update_game_progress; bei Babys: ark_baby (add) mit abgelesener Reife-Restzeit und Zeit bis zur nächsten Prägung.',
  supremacyww3: TIMER_RULE + ' Supremacy: auch Ankunftszeiten von Einheiten und Bauaufträge als Timer.',
  palworld: TIMER_RULE + ' Palworld: Pals aus dem Paldeck/der Box mit Level und passiven Skills mit update_game_progress speichern.',
  eldenring: PROGRESS_RULE + ' Elden Ring: Werte vom Statusbildschirm (Level, Attribute, Waffe) speichern. Hilfe zu Bossen und NPC-Quests in Stufen.',
};
function screenHint(p) {
  if (!p) return '';
  const kit = KITS[p.id] || {};
  const genre = kit.genre || p.genre;
  return SCREEN[p.id] || kit.screen || (genre ? GENRE_SCREEN[genre] || '' : TIMER_RULE + ' ' + PROGRESS_RULE);
}

/** Profile + Kit + Genre-Standardwerte zusammenführen. */
function applyKit(p) {
  const kit = KITS[p.id] || {};
  const genre = kit.genre || p.genre;
  if (!genre) return p;
  return {
    ...p, genre,
    wiki: p.wiki || kit.wiki,
    questions: kit.questions || p.questions || GENRE_QUESTIONS[genre] || [],
    progressCats: kit.progressCats || p.progressCats || GENRE_PROGRESS[genre],
    checklists: kit.checklists || p.checklists || [],
    links: kit.links || p.links || [],
    schedule: kit.schedule || p.schedule,
    kit: true,
  };
}

/** Widget-Layout für ein generisches Spiel mit Kit. */
function kitLayout(p) {
  const types = GENRE_LAYOUTS[p.genre] || GENRE_LAYOUTS.casual;
  const out = [];
  for (const t of types) {
    if (t === 'checklist') { for (const c of p.checklists || []) out.push({ type: 'checklist', params: { name: c.name } }); continue; }
    if (t === 'links' && !(p.links || []).length && !p.schedule) continue;
    if (t === 'wiki' && !p.wiki) continue;
    if (t === 'timers') { out.push({ type: 'timers', params: p.timerKinds ? { kinds: p.timerKinds } : {} }); continue; }
    if (t === 'game-research') { out.push({ type: 'game-research', params: { query: '' } }); continue; }
    out.push({ type: t, params: {} });
  }
  return out;
}

module.exports = { KITS, GENRE_LAYOUTS, GENRE_QUESTIONS, GENRE_PROGRESS, applyKit, kitLayout, screenHint, GENRE_SCREEN };
