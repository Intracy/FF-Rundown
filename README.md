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

## Starten

```bash
git clone https://github.com/Intracy/ff-rundown.git
cd ff-rundown
npm install
npm start          # baut und startet den Server auf http://localhost:8787
```

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

## Steuer-API (Stream Deck, Bitfocus Companion, Grafik)

Alle Pfade unter `/api`, Antwort JSON. `:id` ist die Ablauf-ID (siehe `GET /api/rundowns`).

| Methode | Pfad | Wirkung |
|---|---|---|
| GET | `/api/rundowns` | Liste der Abläufe mit Status |
| GET | `/api/rundowns/:id` | Ablauf und Live-Zustand |
| GET | `/api/rundowns/:id/now` | Kompakt: aktueller/nächster Cue, Restzeit, Über/Unter, Nachricht, Unter-Timer |
| GET | `/api/rundowns/:id/events` | dasselbe als Server-Sent Events (jede Sekunde und bei jeder Änderung) |
| POST | `/api/rundowns/:id/start` · `pause` · `toggle` · `next` · `previous` · `end` · `reset` | Show-Steuerung |
| POST | `/api/rundowns/:id/adjust` `{ "ms": 60000 }` | Laufenden Cue verlängern (negativ: kürzen) |
| POST | `/api/rundowns/:id/cue/:cue/live` | Cue sofort live schalten (`:cue` = ID oder Nummer, z. B. `A03`) |
| POST | `/api/rundowns/:id/cue/:cue/next` | Cue als Nächstes vormerken |
| POST | `/api/rundowns/:id/message` `{ "text", "visible", "bold", "underline", "color": "white"\|"red", "flash" }` | Bühnennachricht |
| GET/PUT | `/api/rundowns/:id/variables` | Text-Variablen lesen / setzen (`null` löscht) |
| POST | `/api/rundowns/:id/subtimers/:timer/start` · `pause` · `reset` | Unter-Timer steuern |

Beispiel für einen Stream-Deck-Knopf „Nächster“ (Companion, Generic HTTP):
`POST http://nas:8787/api/rundowns/<id>/next` mit Header `Authorization: Bearer <passwort>`.

## Tests

```bash
npm test                 # Timing-Logik inkl. Referenzzeiten, Zeitzonen, Unter-Timer
npm run test:api         # Server: Sync, Anmeldung, Gast-Links, Codes, Steuer-API, Auto-Start
python3 scripts/e2e.py   # Oberfläche gegen laufenden Server (Playwright), siehe Kopf der Datei
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
