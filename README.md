# Taktgeber

Rundown- und Show-Timing-Tool für Live-Produktionen, gebaut mit React + TypeScript (Vite).
Läuft komplett im Browser; mit dem mitgelieferten Server synchronisieren sich beliebig viele Geräte in Echtzeit (Regie-Laptop, iPad der Aufnahmeleitung, Bühnen-Timer, Prompter).

## Funktionen

**Ablauf**
- Cues mit Nummer, Startzeit, Dauer, Titel, Untertitel, Skript
- Überschriften als Gruppen mit Gesamtdauer, Zeitfenster, Abweichung und Live-Laufzeit
- Eigene Spalten: Text (mit Checklisten `[ ]` / `[x]`) oder Auswahl mit Farben
- Startzeiten werden automatisch berechnet; **Fixstart** (feste Uhrzeit) pro Cue
- Lücken und Überschneidungen vor Fixstarts, mit „Beheben“-Optionen (Dauer anpassen, Fixstart verschieben, Puffer einfügen)
- Auto-Start: Soft-Cues starten nach dem Vorgänger, Fix-Cues zur Uhrzeit
- Cues überspringen, ohne sie zu löschen
- Zeilenfarben, Drag & Drop, Mehrfachauswahl (duplizieren, gruppieren, färben, überspringen, löschen)
- Rückgängig/Wiederholen, Sperren gegen versehentliche Änderungen
- Showende-Zusammenfassung: geplantes Ende, voraussichtliches Ende, Über/Unter
- Leiste „Nächster Fixstart“ mit Countdown und Lücke/Überschneidung

**Show fahren**
- Start, Pause, Nächster, Zurück, Ende, Reset
- ±1 min und Feinkorrektur (10 s … 10 min, eigener Wert) für den laufenden Cue
- Klick auf die Cue-Nummer merkt den Cue als Nächstes vor
- Mitlaufen (Auto-Scroll zum laufenden Cue)
- Tastenkürzel (Leertaste = Nächster, P = Pause, B = Zurück, +/− = ±1 min, `?` = Übersicht)

**Ausgaben**
- `#timer`: Bühnen-Timer mit Countdown, Überzeit, Fortschritt, nächstem Cue, Show-Abweichung, Nachricht an die Bühne (optional blinkend)
- `#prompter`: Teleprompter aus den Cue-Skripten, Tempo, Schriftgröße, Spiegeln, folgt der Show
- Bildschirm bleibt an (Wake Lock), Vollbild

**Import/Export**
- CSV-Export (Semikolon, Excel-tauglich) und CSV-Import aus Excel/Google Sheets
- JSON-Sicherung und -Wiederherstellung
- Drucken / PDF über den Browser

## Starten

```bash
git clone https://github.com/Intracy/ff-rundown.git
cd ff-rundown
npm install
npm start          # baut und startet den Server auf http://localhost:8787
```

Andere Geräte im Netz öffnen `http://<IP-des-Rechners>:8787`. Timer direkt: `/#timer`, Prompter: `/#prompter`.

Entwicklung mit Hot Reload:

```bash
npm run server     # Terminal 1: Sync-Server (Port 8787)
npm run dev        # Terminal 2: Vite (leitet /ws und /api an den Server weiter)
```

Ohne Server läuft die App lokal im Browser (Daten im localStorage; mehrere Tabs desselben Browsers bleiben synchron).

### Docker (z. B. Synology Container Manager)

```bash
docker compose up -d --build
```

Daten liegen in `./data/state.json`.

> Der Server hat keine Anmeldung. Im lokalen Netz ist das unkritisch; für Zugriff von außen bitte hinter einen Reverse Proxy mit Passwortschutz (z. B. Synology Reverse Proxy + Basic Auth) oder ein VPN stellen.

## Lese-API für Grafik und Automation

- `GET /api/rundowns` – Liste der Abläufe mit Status
- `GET /api/rundowns/:id` – Ablauf, Live-Zustand und Serverzeit (z. B. für CasparCG-/OBS-Overlays)

## Weitere Befehle

```bash
npm test               # Tests der Timing-Logik
npm run build:artifact # eine einzelne HTML-Datei (React über CDN) in dist-artifact/
```

## Aufbau

```
src/time.ts       Formatieren und Parsen von Dauer/Uhrzeit
src/live.ts       Show-Steuerung (Start, Pause, Weiter, Auto-Start …) als reine Funktionen
src/timing.ts     Berechnung: geplante/live Zeiten, Lücken, Gruppen, Über/Unter
src/store.ts      Zustand, Undo, Persistenz
src/sync.ts       WebSocket- und Tab-Synchronisation inkl. Uhrzeitabgleich
src/csv.ts        CSV/JSON Import & Export
src/ui/           React-Komponenten
server/index.mjs  Node-Server: liefert dist/ aus, WebSocket-Sync, Lese-API
```

Synchronisiert wird je Ablauf nach dem Prinzip „letzte Änderung gewinnt“. Bearbeiten zwei Personen gleichzeitig denselben Ablauf, kann die spätere Änderung die frühere überschreiben.
