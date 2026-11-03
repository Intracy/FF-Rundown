# Funktionsabgleich

Abgleich mit dem Funktionsumfang von Rundown Studio (Stand 02.11.2026), erhoben aus der öffentlichen Dokumentation, der normalen Bedienung eines echten Kontos (Menüs, Ausgabe-Dialog, Cue- und Spaltenmenüs eines eigens angelegten Test-Ablaufs) und den Zeiten des öffentlichen Demo-Ablaufs. Taktgeber übernimmt Funktionen, keine Texte, Grafiken oder Code.

Legende: ✅ umgesetzt · ◐ teilweise / anders gelöst · — nicht umgesetzt

## Ablauf und Timing

| Funktion | Taktgeber | Test |
|---|---|---|
| Cues mit Nummer, Start, Dauer, Titel, Untertitel | ✅ | e2e |
| Automatische Startzeiten | ✅ | Referenztest: alle 22 Startzeiten des Demo-Ablaufs identisch |
| Fixstart (feste Uhrzeit) vs. Start nach Vorgänger | ✅ | Unit |
| Lücken und Überschneidungen anzeigen | ✅ | Unit, e2e |
| „Beheben“: Cue verschieben, früheren Fixstart/Showbeginn verschieben, Dauer eines Cues darüber ändern, Cue einfügen | ✅ (zusätzlich: Fixstart aufheben) | e2e |
| Leiste „nächster Fixstart“ mit Countdown | ✅ | Sichtprüfung |
| Showende: geplant, berechnet, Über/Unter | ✅ | Referenztest: Ende 20:30, +9:30:00 |
| Auto-Start (nach Vorgänger und zur Uhrzeit) | ✅ (läuft zusätzlich auf dem Server) | Unit, API |
| Cue überspringen | ✅ | Unit |
| Gruppen mit Summe, Zeitfenster, Abweichung, Live-Laufzeit | ✅ | Referenztest, Sichtprüfung |
| Gelaufene Cues: Plan durchgestrichen, Ist-Zeit rot/grün | ✅ | e2e |
| Unter-Timer (Countdown/Stoppuhr, bei 0 stoppen/weiter, mit Cue, manuell, im Timer zeigen, bis 20 je Cue) | ✅ | Unit, API, e2e |
| Spalten anlegen, umbenennen, verschieben, Breite ziehen, löschen | ✅ | e2e |
| Spalten „für mich ausblenden“ | ✅ | e2e |
| Private Notizspalte | ✅ (gespeichert im Browser des Geräts) | e2e |
| Zellen: Text, Auswahl, Checklisten | ✅ | e2e |
| Rich Text mit Farben, Bilder und Datei-Upload in Zellen | ◐ (**fett**, ==markiert==, Links; keine Uploads) | – |
| Text-Variablen `$…` | ✅ | e2e, API |
| Erwähnungen `@…` mit Beschreibung | ✅ (Beschreibung als Text, ohne Bilder) | e2e |
| Papierkorb (Cues, Spalten, 30 Tage) | ✅ (auch Überschriften) | e2e |
| Zell-Verlauf mit Wiederherstellen | ✅ (ohne Personenangabe, da keine Benutzerkonten) | e2e |
| Mehrfachauswahl: alle, duplizieren, gruppieren, Gruppierung aufheben, verschieben, Farbe, löschen | ✅ | e2e |
| Rückgängig | ✅ | e2e |
| Mehrere Cues auf einmal anlegen | ✅ (1–50) | e2e |
| Cue ↔ Überschrift umwandeln | ✅ (Original des Cues landet im Papierkorb) | e2e |
| Zu Cue springen | ✅ (Suche nach Nummer oder Titel, Taste G bzw. Strg/Cmd+K) | e2e |
| Spaltenlayout zurücksetzen | ✅ | e2e |
| Eigene Farbpalette je Ablauf | ✅ | e2e |

## Einstellungen und Organisation

| Funktion | Taktgeber | Test |
|---|---|---|
| Datum, Zeitzone | ✅ | Unit (inkl. Zeitumstellung) |
| Uhrformat 24 h / 12 h mit und ohne AM/PM / Gerät | ✅ | e2e |
| Hervorhebung laufender Cue: Farbe behalten oder rot | ✅ | e2e |
| Nummerierung: Präfix, Startwert, Stellen | ✅ | Unit, e2e |
| Logo (Ablauf, Event, Ausgabe) | ✅ | Sichtprüfung |
| Events als Ordner, Event duplizieren | ✅ | e2e |
| Vorlagen | ✅ | e2e |
| Status eines Ablaufs | ✅ (Entwurf, Freigegeben, Archiviert) | e2e |
| Suche, Sortierung in der Übersicht | ✅ | e2e |

## Show fahren

| Funktion | Taktgeber | Test |
|---|---|---|
| Start, Pause, Weiter, Zurück, Ende, Reset | ✅ | Unit, API, e2e |
| ±1 min und Feinkorrektur | ✅ | Unit, API |
| Nächsten Cue vormerken | ✅ | Unit, API |
| Mitlaufen (Auto-Scroll) | ✅ | Sichtprüfung |
| Fortschrittsleiste über die ganze Show | ✅ | e2e |

## Ausgaben

| Funktion | Taktgeber | Test |
|---|---|---|
| Layout Einzel-Cue und Liste | ✅ | e2e |
| Kopfzeile: Titel, Logo, Uhr, Cue-Timer, Über/Unter, Fortschritt, letzte 5 Sekunden, oben/unten | ✅ | e2e |
| Cue-Felder: Nummer, Titel, Untertitel, Farben, Dauer, Start, Ende, nächster Cue, große Uhr | ✅ | e2e |
| Hintergrundfarbe, transparent zum Keyen, Spiegeln horizontal/vertikal | ✅ | e2e |
| Bühnennachricht mit Fett, Unterstrichen, Weiß/Rot, Ein/Aus | ✅ (zusätzlich Blinken) | e2e, API |
| Mehrere gespeicherte Ausgabe-Konfigurationen je Ablauf | ◐ (eine gemeinsame Timer-Konfiguration je Ablauf) | – |
| Prompter: Spalte wählen, Tempo, Rand, Schrift, Marke, Start/Stopp, Sprung Anfang/aktiver Cue, Cue-Liste | ✅ | e2e |
| Prompter: Cue-Details, Abdunkeln, Großbuchstaben, Invertieren, Auto-Scroll, Synchronisation | ✅ | e2e |
| Prompter-Tasten (Leertaste, ←/→, Umschalt) | ✅ | e2e |

## Teilen, Export, Schnittstellen

| Funktion | Taktgeber | Test |
|---|---|---|
| Gast-Link nur ansehen, mit Spaltenauswahl | ✅ (Spalten serverseitig gefiltert) | API, e2e |
| Gast-Link bearbeiten | ✅ | API |
| Links deaktivieren | ✅ | API |
| Schnellzugriffscode, 10 Minuten | ✅ | API, e2e |
| QR-Code, Link per E-Mail | — | – |
| Team-Mitglieder mit eigenen Konten | ◐ (ein Regie-Passwort plus Gast-Links) | API |
| CSV-Export, CSV-Import | ✅ | Unit |
| PDF-Export | ◐ (Drucken/PDF über den Browser) | – |
| HTTP-API zur Steuerung | ✅ | API |
| Live-Updates für Overlays | ✅ (Server-Sent Events + WebSocket) | API |
| Companion-Modul, fertige Integrationen (OBS, ProPresenter, QLab) | ◐ (über die generische HTTP-API) | – |

## Testumfang

- `npm test`: 42 Prüfungen der Timing-Logik, darunter der Referenzablauf mit 22 Cues und 8 Gruppen
- `npm run test:api`: 62 Prüfungen von Server, Sync, Benutzern und Rollen, Gast-Links, Codes, Token-API und Auto-Start
- `python3 scripts/e2e-accounts.py`: 26 Prüfungen für Konten, Rollen, API-Dialog, QR und Handy
- `python3 scripts/e2e.py`: 58 Prüfungen der Oberfläche in Chrome (Desktop, Gast, Handy)

Die vorhandenen Produktions-Abläufe wurden nur angesehen, nicht verändert. Für den Abgleich der Menüs wurde im Event „MFY MUC 2026“ der Ablauf „Taktgeber Funktionstest“ angelegt.

## Übernommen aus FF Rundown v1.9.1

Die eigenständige Fassung „FF Rundown“ (Node + SQLite) wurde gestartet, durchgeklickt und mit Taktgeber abgeglichen. Alles, was Taktgeber noch fehlte, ist jetzt enthalten:

| Funktion | Taktgeber | Test |
|---|---|---|
| Benutzerkonten mit E-Mail/Passwort, Rollen Admin/Editor/Operator/Viewer, Einrichtung beim ersten Start | ✅ (gleiches scrypt-Format, Konten lassen sich übernehmen) | API, e2e-accounts |
| Benutzerverwaltung, Passwort ändern/zurücksetzen, Login-Drosselung | ✅ | API, e2e-accounts |
| API-Token pro Ablauf, GET und POST, `/status`, `/text/<feld>`, `/cue`, `/rundown`, Sperren mit „NEU“ | ✅ (Pfade kompatibel, inkl. `/api/companion/…`) | API |
| Restzeit setzen, Dauer für den Durchlauf setzen | ✅ (UI und API) | API, e2e-accounts |
| Schrittweite der ±-Knöpfe, „Live seit“ | ✅ | e2e-accounts |
| API-Dialog mit Kopieren, Test und Integrations-Anleitung | ✅ | e2e-accounts |
| Block-Ende | ✅ | e2e-accounts |
| Freie Farbe pro Punkt/Block | ✅ | e2e-accounts |
| Kompakte Zeilen, erledigte ausblenden, Mitlaufen oben | ✅ | e2e-accounts |
| Hell/Dunkel umschaltbar | ✅ | e2e-accounts |
| Übersicht als Kacheln/Liste, Gruppen Live/Heute/Kommend/Vergangen | ✅ | Sichtprüfung |
| Handy: Karten, aufklappbar, feste Steuerleiste unten, Touch-Umsortieren | ✅ | e2e-accounts |
| QR-Code für öffentliche Links (Vollbild, PNG/SVG) | ✅ (QR-Encoder aus FF Rundown) | e2e-accounts |
| PWA (installierbar), Update-Hinweis, `/api/health` mit Version | ✅ | API |
| Start-/Installationsskripte Mac, Linux/Pi, Windows, systemd, `.env` | ✅ | – |
| Datenübernahme | ✅ `scripts/import-ff-rundown.mjs` | manuell mit Test-Datenbank |
