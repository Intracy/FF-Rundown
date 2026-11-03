# Taktgeber

Rundown- und Show-Timing-Tool für Live-Produktionen, gebaut mit React + TypeScript (Vite).
Läuft komplett im Browser; mit dem mitgelieferten Server synchronisieren sich beliebig viele Geräte in Echtzeit (Regie-Laptop, iPad der Aufnahmeleitung, Bühnen-Timer, Prompter, Gäste).

Welche Funktionen einer typischen Rundown-Software abgedeckt sind und wie sie getestet werden, steht in [docs/funktionsabgleich.md](docs/funktionsabgleich.md).

## Funktionen

**Ablauf**
- Cues mit Nummer, Startzeit, Dauer, Titel, Untertitel, Skript; Überschriften als Gruppen mit Summen und Live-Laufzeit
- Eigene Spalten: Text (mit Checklisten `[ ]` / `[x]`, `**fett**`, `==markiert==`, Links) oder Auswahl mit Farben
- Spalten verschieben, per Ziehen verbreitern, **für mich ausblenden**, private Notizspalte (nur im eigenen Browser)
- Startzeiten automatisch; **Fixstart** pro Cue; Lücken/Überschneidungen mit „Beheben“ (Cue verschieben, früheren Fixstart bzw. Showbeginn verschieben, Dauer eines Cues darüber ändern, Puffer einfügen)
- Auto-Start (nach dem Vorgänger oder zur Uhrzeit), Cues überspringen, Zeilenfarben
- **Unter-Timer** je Cue (Countdown/Stoppuhr, bei 0 stoppen/weiterzählen, mit dem Cue verknüpft oder manuell, im Timer anzeigen)
- **Text-Variablen** (`$schluessel`) und **Erwähnungen** (`@name` mit Beschreibung beim Darüberfahren), Vorschläge beim Tippen
- **Papierkorb** für Cues, Überschriften und Spalten (30 Tage), **Zell-Verlauf** mit Wiederherstellen, Rückgängig/Wiederholen
- Drag & Drop, Mehrfachauswahl (duplizieren, gruppieren, Gruppierung aufheben, an Anfang/Ende, färben, überspringen, löschen)
- Mehrere Cues auf einmal anlegen, Cue ↔ Überschrift umwandeln, zu Cue springen (G oder Strg/Cmd+K), Spaltenlayout zurücksetzen, eigene Farbpalette je Ablauf
- Einstellungen: Datum, **Zeitzone**, 24-/12-h-Format, Nummerierung (Präfix, Startwert, Stellen), Logo, Hervorhebung des laufenden Cues, Warnschwelle, Status, Event, Vorlage

**Übersicht** (`#uebersicht`)
- Events als Ordner (umbenennen, mit allen Abläufen duplizieren, auflösen), Abläufe, Vorlagen, Archiv
- Suche, Sortierung, Status (Entwurf/Freigegeben/Archiviert), neuer Ablauf leer, aus Beispiel oder aus Vorlage

**Show fahren**
- Start, Pause, Nächster, Zurück, Ende, Reset; ±1 min und Feinkorrektur; Cue vormerken (Klick auf die Nummer)
- Gelaufene Cues zeigen geplante Zeiten durchgestrichen und Ist-Zeiten in Rot/Grün
- Fortschrittsleiste über die ganze Show, Mitlaufen (Auto-Scroll), Sperren
- Tastenkürzel (Leertaste = Nächster, P = Pause, B = Zurück, +/− = ±1 min, 0–3 = Ansichten, `?` = Übersicht)

**Ausgaben**
- `#timer`: Einzel-Cue oder Liste; Kopfzeile oben/unten mit Titel, Logo, Uhr, Cue-Timer, Über/Unter, Fortschritt, letzte 5 Sekunden; Cue-Felder wählbar; Spiegeln; Hintergrundfarbe oder transparent zum Keyen; Bühnennachricht (fett, unterstrichen, weiß/rot, blinkend)
- `#prompter`: Text aus Cue-Skript oder einer Textspalte, Tempo, Schrift, Rand, Lesemarke, Abdunkeln, Großbuchstaben, Farben umkehren, Spiegeln, Cue-Liste, Sprung an den Anfang bzw. zum laufenden Cue, Synchronisation zwischen Prompter-Geräten
- Bildschirm bleibt an (Wake Lock), Vollbild

**Teilen** (mit Server)
- Gast-Links „Nur ansehen“ (mit Spaltenauswahl, serverseitig gefiltert) oder „Bearbeiten“, jederzeit deaktivierbar
- Sechsstelliger **Schnellzugriffscode** (10 Minuten gültig), einzulösen unter `/#code`

**Import/Export**
- CSV-Export (Semikolon, Excel-tauglich, Variablen eingesetzt) und CSV-Import aus Excel/Google Sheets
- JSON-Sicherung und -Wiederherstellung; Drucken / PDF über den Browser

**Benutzer & Rollen** (mit Server)
- Anmeldung mit E-Mail und Passwort, beim ersten Start wird das Admin-Konto im Browser angelegt
- Rollen: **Admin** (alles, inkl. Benutzerverwaltung), **Editor** (Abläufe bearbeiten, Gäste einladen, API), **Operator** (ansehen und Show steuern), **Viewer** (nur ansehen)
- Benutzerverwaltung mit erzeugten Startpasswörtern, Passwort zurücksetzen, eigenes Passwort ändern; Rollenwechsel meldet bestehende Sitzungen ab
- Login-Drosselung, Passwörter mit scrypt, signierte Sitzungstokens

**Aus FF Rundown übernommen**
- Block-Ende (schließt eine Gruppe), freie Farbe pro Cue und Überschrift
- Restzeit setzen, Dauer nur für diesen Durchlauf setzen, Schrittweite der ±-Knöpfe (10 s bis 10 min), „Live seit“
- Ansicht: kompakte Zeilen, erledigte Cues ausblenden, laufenden Cue oben oder mittig halten, Darstellung Hell/Dunkel/System
- Übersicht als Liste oder Kacheln, gruppiert nach Live / Heute / Kommend / Vergangen mit „in 3 Tagen“
- Handy: Cues als Karten (leere Felder ausgeblendet, aufklappbar), feste Steuerleiste unten mit großem „Nächster“, Umsortieren per Finger
- QR-Code für Gast-Links (Vollbild, PNG/SVG)
- API-Token pro Ablauf (Companion-kompatibel, siehe unten) mit Test direkt im Dialog und Sperren/Neu erzeugen
- Als App installierbar (PWA), Hinweis „Neue Version verfügbar“, Start- und Installationsskripte für Mac, Linux/Raspberry Pi und Windows
- Import aller Daten aus FF Rundown inkl. Benutzern und Companion-Tokens

## Starten

```bash
git clone https://github.com/Intracy/ff-rundown.git
cd ff-rundown
npm install
npm start          # baut und startet den Server auf http://localhost:8787
```

Beim ersten Aufruf legst du im Browser das Admin-Konto an.

Ohne Terminal:
- **Mac:** `start-mac.command` doppelklicken (öffnet den Browser). Dauerhaft im Hintergrund: `./install-mac-autostart.sh` (entfernen mit `--remove`).
- **Linux / Raspberry Pi:** `sudo ./install-linux.sh` richtet den Dienst `taktgeber` ein (erneut ausführen = Update). Nur ausprobieren: `./start.sh`.
- **Windows:** `start-windows.bat` doppelklicken.

Einstellungen über Umgebungsvariablen oder eine `.env`-Datei (Vorlage: `.env.example`): `PORT`, `HOST`, `DATA_DIR`, `TRUST_PROXY`, `SESSION_SECRET`, `ADMIN_PASSWORD`.

### Umzug von FF Rundown

```bash
# FF Rundown stoppen, dann (Node.js ≥ 22.13):
node scripts/import-ff-rundown.mjs /pfad/zu/ff-rundown/data/rundown.db
npm start
```

Übernommen werden Benutzer (Passwörter bleiben gültig), Abläufe, Spalten, Programmpunkte, Blöcke und Block-Enden, Farben, öffentliche Links (als Gast-Links „Nur ansehen“ mit denselben öffentlichen Spalten) und die Companion-Tokens. In Companion nur Host und Port ändern: `http://<server>:8787/api/v1/<TOKEN>`.

Andere Geräte im Netz öffnen `http://<IP-des-Rechners>:8787`. Timer: `/#timer`, Prompter: `/#prompter`, Code eingeben: `/#code`.

Entwicklung mit Hot Reload:

```bash
npm run server     # Terminal 1: Sync-Server (Port 8787)
npm run dev        # Terminal 2: Vite (leitet /ws und /api an den Server weiter)
```

Ohne Server läuft die App lokal im Browser (Daten im localStorage; mehrere Tabs desselben Browsers bleiben synchron).

### Passwortschutz

```bash
ADMIN_PASSWORD='ein-langes-passwort' npm start
```

Dann fragt die Regie-Oberfläche nach dem Passwort, und die API erwartet `Authorization: Bearer <passwort>`. Gast-Links und Schnellzugriffscodes funktionieren ohne Passwort, sehen aber nur ihren Ablauf. Für Zugriff aus dem Internet zusätzlich HTTPS über einen Reverse Proxy (z. B. Synology) verwenden.

### Docker (z. B. Synology Container Manager)

```bash
ADMIN_PASSWORD='ein-langes-passwort' docker compose up -d --build
```

Daten liegen in `./data/state.json`.

## API (Stream Deck, Bitfocus Companion, Grafik)

### Token-API pro Ablauf (ohne Anmeldung)

Im Ablauf unter **Mehr → API & Integrationen** steht die Basis-URL `http://<server>:8787/api/v1/<TOKEN>` mit Kopier-Knopf und Test. Alle Aktionen gehen per **GET oder POST**, Parameter als Query oder JSON-Body. Die Pfade entsprechen FF Rundown, alte Adressen `/api/companion/<TOKEN>/…` funktionieren weiter.

| Pfad | Wirkung |
|---|---|
| `/start` (optional `?item=<Nummer oder ID>`) · `/next` · `/prev` · `/goto?item=…` · `/toggle` · `/pause` · `/stop` · `/reset` | Show steuern |
| `/plus?seconds=60` · `/minus?seconds=60` · `/add?seconds=-30` | Zeit am laufenden Cue |
| `/set?time=05:00` | Restzeit setzen |
| `/setduration?time=10:00` | Dauer des laufenden Cues für diesen Durchlauf |
| `/message?text=…&color=red&visible=true` | Bühnennachricht |
| `/status` | flache Werte für Companion-Variablen (`title`, `next`, `remaining`, `remaining_sec`, `delta`, `state`, `projected_end`, `progress`, `item_number`, `clock` …) |
| `/text/<feld>` | Einzelwert als Klartext, z. B. `/text/remaining` |
| `/cue` · `/rundown` | aktueller Cue bzw. kompletter Ablauf als JSON |
| `/events` | Server-Sent Events für Overlays |

Zeitangaben: `seconds=90`, `minutes=1.5` oder `time=01:30`. Ohne laufenden Cue antworten die Zeit-Endpunkte mit 409. Den Token im Notfall unter „Sicherheit“ sperren und neu erzeugen (Bestätigung mit „NEU“).

### Mit Benutzer-Anmeldung

`POST /api/auth/login` mit `{ "email", "password" }` liefert ein Token für `Authorization: Bearer …`. Dann u. a.:
`GET /api/rundowns`, `GET /api/rundowns/:id/now|status|export|events`, ab Rolle Operator `POST /api/rundowns/:id/<aktion>` (dieselben Aktionen wie oben, dazu `cue/:cue/live`, `cue/:cue/next`, `subtimers/:timer/start|pause|reset`), ab Editor `GET/PUT /api/rundowns/:id/variables`.

## Tests

```bash
npm test                 # Timing-Logik inkl. Referenzzeiten, Zeitzonen, Unter-Timer
npm run test:api         # Server: Sync, Benutzer & Rollen, Gast-Links, Codes, Token-API, Auto-Start
python3 scripts/e2e.py            # Oberfläche gegen laufenden Server mit ADMIN_PASSWORD (Playwright)
python3 scripts/e2e-accounts.py   # Konten, Rollen, API-Dialog, QR, Handy-Karten (Server ohne ADMIN_PASSWORD)
```

## Weitere Befehle

```bash
npm run build:artifact   # eine einzelne HTML-Datei (React über CDN) in dist-artifact/
npm run build:core       # Show-Logik für den Server bündeln (server/core.mjs)
```

## Aufbau

```
src/time.ts       Dauer/Uhrzeit, Zeitzonen, 12/24 h
src/live.ts       Show-Steuerung und Unter-Timer als reine Funktionen (auch vom Server genutzt)
src/timing.ts     Berechnung: geplante/live Zeiten, Lücken, Gruppen, Über/Unter, Nummern
src/model.ts      Standardwerte, Migration älterer Daten, Kopieren mit neuen IDs
src/store.ts      Zustand, Undo, Persistenz, Gast-Modus
src/sync.ts       WebSocket- und Tab-Synchronisation inkl. Uhrzeitabgleich und Anmeldung
src/csv.ts        CSV/JSON Import & Export
src/ui/           React-Komponenten (Ablauf, Übersicht, Timer, Prompter, Dialoge)
server/index.mjs  Node-Server: liefert dist/ aus, WebSocket-Sync, Gast-Links, Codes, API, Auto-Start
```

Synchronisiert wird je Ablauf nach dem Prinzip „letzte Änderung gewinnt“. Bearbeiten zwei Personen gleichzeitig denselben Ablauf, kann die spätere Änderung die frühere überschreiben.
