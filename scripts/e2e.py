"""Oberflächentest aller Funktionen gegen einen laufenden Taktgeber-Server.

Aufruf: python3 scripts/e2e.py [BASIS-URL] [PASSWORT] [SCREENSHOT-ORDNER]
Erwartet einen frisch gestarteten Server (leerer Datenordner), z. B.:
  DATA_DIR=/tmp/tg ADMIN_PASSWORD=geheim node server/index.mjs
"""
import asyncio
import re
import sys

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8787'
PW = sys.argv[2] if len(sys.argv) > 2 else 'geheim'
SHOTS = sys.argv[3] if len(sys.argv) > 3 else None
CHROME = '/usr/bin/google-chrome'

failed = 0


def ok(cond, msg):
    global failed
    if cond:
        print('ok  ', msg)
    else:
        failed += 1
        print('FAIL', msg)


async def shot(page, name):
    if SHOTS:
        await page.screenshot(path=f'{SHOTS}/{name}.png')


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        errors = []

        def watch(page, tag):
            page.on('pageerror', lambda e: errors.append(f'{tag}: {e}'))

        ctx = await b.new_context(viewport={'width': 1500, 'height': 950}, color_scheme='dark')
        A = await ctx.new_page()
        watch(A, 'A')

        # 1) Anmeldung
        await A.goto(BASE + '/')
        await A.wait_for_selector('#login-pw')
        ok(True, 'Anmeldemaske erscheint bei gesetztem Passwort')
        await A.fill('#login-pw', 'falsch')
        await A.get_by_role('button', name='Anmelden').click()
        await A.wait_for_timeout(500)
        ok(await A.locator('.login .error').count() == 1, 'Falsches Passwort wird abgelehnt')
        await A.fill('#login-pw', PW)
        await A.get_by_role('button', name='Anmelden').click()
        await A.wait_for_selector('.row.cue')
        await A.wait_for_timeout(600)
        ok('Verbunden' in await A.inner_text('.sync-chip'), 'Angemeldet und verbunden')

        # 2) Variablen und Erwähnungen im Beispiel
        ok(await A.locator('.cell-view .var', has_text='12.480 €').count() >= 1, 'Text-Variable $spendenstand zeigt ihren Wert')
        ok(await A.locator('.cell-view .mention', has_text='Bühne links').count() >= 1, 'Erwähnung @buehne-links wird als Chip gezeigt')
        await A.locator('button[aria-label="Weitere Funktionen"]').click()
        await A.get_by_role('button', name='Text-Variablen').click()
        val = A.locator('input[aria-label="Wert von spendenstand"]')
        await val.fill('15.000 €')
        await A.fill('#var-key', 'saal')
        await A.fill('#var-val', 'Großer Saal')
        await A.get_by_role('button', name='Anlegen').click()
        ok(await A.locator('code', has_text='$saal').count() == 1, 'Neue Variable angelegt')
        await A.keyboard.press('Escape')
        await A.wait_for_timeout(200)
        ok(await A.locator('.cell-view .var', has_text='15.000 €').count() >= 1, 'Geänderter Variablenwert erscheint überall')

        # 3) Zelle bearbeiten mit Vorschlägen + Zell-Verlauf
        notes_cell = A.locator('.row.cue').nth(2).locator('.c-cell').nth(4).locator('.cell-view')
        await notes_cell.dblclick()
        ta = A.locator('textarea.cell-edit')
        await ta.press('End')
        await ta.type(' Ort: $sa')
        await A.wait_for_selector('.suggest')
        ok(await A.locator('.suggest button', has_text='$saal').count() == 1, 'Vorschlagsliste zeigt passende Variable')
        await ta.press('Enter')
        await ta.press('Control+Enter')
        await A.wait_for_timeout(300)
        ok(await A.locator('.row.cue').nth(2).locator('.var', has_text='Großer Saal').count() == 1, 'Variable per Vorschlag eingefügt und gespeichert')
        hist = A.locator('.row.cue').nth(2).locator('.cell-hist').first
        ok(await hist.count() == 1, 'Zell-Verlauf-Knopf erscheint nach Änderung')
        await A.locator('.row.cue').nth(2).locator('.c-cell').nth(4).hover()
        await hist.click()
        await A.get_by_role('button', name='Wiederherstellen').first.click()
        await A.wait_for_timeout(300)
        ok(await A.locator('.row.cue').nth(2).locator('.var', has_text='Großer Saal').count() == 0, 'Alter Zellinhalt wiederhergestellt')

        # 4) Einstellungen: Nummerierung, 12-h-Format, Zeitzone
        await A.locator('button[aria-label="Weitere Funktionen"]').click()
        await A.get_by_role('button', name='Einstellungen').click()
        await A.get_by_placeholder('z. B. A').fill('A')
        dig = A.locator('.set-field', has_text='Stellen').locator('input')
        await dig.fill('2')
        await A.get_by_role('radio', name='12 h AM/PM').click()
        await A.locator('select.text-input').first.select_option('America/New_York')
        await A.keyboard.press('Escape')
        await A.wait_for_timeout(300)
        first_num = await A.locator('.row.cue .num-btn').first.inner_text()
        ok(first_num == 'A01', f'Cue-Nummer mit Präfix und Stellen ({first_num})')
        clock = await A.inner_text('.clock')
        ok(re.search(r'(AM|PM)$', clock) is not None, f'Uhr im 12-h-Format ({clock})')
        ok('new york' in (await A.inner_text('.rd-meta')).lower(), 'Zeitzone im Kopf angezeigt')
        # zurück auf 24 h / Berlin für die weiteren Tests
        await A.locator('button[aria-label="Weitere Funktionen"]').click()
        await A.get_by_role('button', name='Einstellungen').click()
        await A.get_by_role('radio', name='24 h').click()
        await A.locator('select.text-input').first.select_option('Europe/Berlin')
        await A.get_by_role('radio', name='Eigene Farbe behalten').click()
        await A.keyboard.press('Escape')

        # 5) Spalten: für mich ausblenden, private Notizen, Breite
        heads_before = await A.locator('.row.head .col-head').count()
        await A.locator('.row.head .col-name', has_text='Ton').click()
        await A.get_by_role('button', name='Für mich ausblenden').click()
        ok(await A.locator('.row.head .col-head').count() == heads_before - 1, 'Spalte für mich ausgeblendet')
        await A.locator('button[aria-label="Spalten ein- oder ausblenden"]').click()
        await A.locator('label[for^="private-"]').click()
        await A.get_by_role('button', name='Alle Spalten zeigen').click()
        await A.keyboard.press('Escape')
        ok(await A.locator('.col-head.private').count() == 1, 'Private Notizspalte eingeblendet')
        ok(await A.locator('.row.head .col-head').count() == heads_before + 1, 'Ausgeblendete Spalte wieder sichtbar')
        handle = A.locator('.col-resize').first
        box = await handle.bounding_box()
        w_before = (await A.locator('.row.head .col-head').first.bounding_box())['width']
        await A.mouse.move(box['x'] + 4, box['y'] + 10)
        await A.mouse.down()
        await A.mouse.move(box['x'] + 84, box['y'] + 10, steps=5)
        await A.mouse.up()
        await A.wait_for_timeout(300)
        w_after = (await A.locator('.row.head .col-head').first.bounding_box())['width']
        ok(w_after > w_before + 60, f'Spaltenbreite per Ziehen geändert ({w_before:.0f} → {w_after:.0f})')

        # 6) Lücke beheben (vor dem Fixstart 19:00)
        gaps_before = await A.locator('.row.gap').count()
        await A.locator('.row.gap').first.get_by_role('button', name=re.compile('beheben')).click()
        opts = await A.locator('.fix-list > button').all_inner_texts()
        ok(any('Diesen Cue verschieben' in o for o in opts) and any('Showbeginn verschieben' in o for o in opts) and any('Neuen Cue einfügen' in o for o in opts), 'Alle Lösungswege werden angeboten')
        ok(sum(1 for o in opts if '→' in o) >= 2, 'Dauer-Änderung für mehrere Cues darüber wählbar')
        await A.locator('.fix-list > button', has_text='Neuen Cue einfügen').click()
        await A.wait_for_timeout(300)
        ok(await A.locator('.row.gap').count() == gaps_before - 1, 'Puffer-Cue füllt die Lücke')

        # 7) Papierkorb
        cues_before = await A.locator('.row.cue').count()
        await A.locator('.row.cue').nth(1).locator('button[aria-label="Cue-Optionen"]').click()
        await A.get_by_role('button', name='In den Papierkorb').click()
        ok(await A.locator('.row.cue').count() == cues_before - 1, 'Cue in den Papierkorb gelegt')
        await A.locator('button[aria-label="Weitere Funktionen"]').click()
        await A.get_by_role('button', name=re.compile('Papierkorb')).click()
        await A.get_by_role('button', name='Wiederherstellen').click()
        await A.keyboard.press('Escape')
        ok(await A.locator('.row.cue').count() == cues_before, 'Cue aus dem Papierkorb wiederhergestellt')

        # 8) Mehrfachauswahl: ans Ende verschieben
        last_title = await A.locator('.row.cue .title-input').nth(cues_before - 1).input_value()
        await A.locator('.row.cue .grip').nth(0).click()
        await A.get_by_role('button', name='Verschieben', exact=True).click()
        await A.get_by_role('button', name='Ans Ende').click()
        moved = await A.locator('.row.cue .title-input').nth(cues_before - 1).input_value()
        ok(moved != last_title, 'Auswahl ans Ende verschoben')
        await A.locator('button[aria-label="Auswahl aufheben"]').click()
        await A.keyboard.press('Control+z')
        await A.wait_for_timeout(200)
        ok(await A.locator('.row.cue .title-input').nth(cues_before - 1).input_value() == last_title, 'Rückgängig stellt die Reihenfolge wieder her')

        # 9) Unter-Timer anlegen, Show fahren
        row = A.locator('.row.cue').nth(1)
        await row.hover()
        await row.locator('.add-sub').click()
        ok(await row.locator('.subtimer').count() == 1, 'Unter-Timer angelegt')
        await A.keyboard.press('p')
        await A.wait_for_timeout(500)
        await A.keyboard.press('Space')
        await A.wait_for_timeout(1500)
        ok(await A.locator('.row.cue.st-current').count() == 1, 'Show läuft, ein Cue ist live')
        ok(await A.locator('.row.cue.st-done .planned-strike').count() >= 2, 'Gelaufener Cue zeigt Plan durchgestrichen und Ist-Zeit')
        cur = A.locator('.row.cue.st-current')
        if await cur.locator('.subtimer').count():
            ok(await cur.locator('.subtimer.running').count() >= 1, 'Mit dem Cue verknüpfter Unter-Timer läuft')
        ok(await A.locator('.strip .seg-cue.st-current').count() == 1, 'Fortschrittsleiste markiert den laufenden Cue')
        ok(await A.locator('.grid.hl-color').count() == 1, 'Hervorhebung „eigene Farbe“ aktiv')
        await shot(A, 'ablauf_live')

        # 10) Timer-Ansicht: Nachricht, Listenlayout, Konfiguration
        await A.locator('button[aria-label="Nachricht an die Bühne"]').click()
        await A.fill('#stage-message', 'Noch 2 Minuten')
        await A.get_by_role('radio', name='Rot').click()
        await A.get_by_role('button', name='Anzeigen', exact=True).click()
        T = await ctx.new_page()
        watch(T, 'T')
        await T.goto(BASE + '/#timer')
        await T.wait_for_selector('.out-timer, .out-subs')
        ok(await T.locator('.out-msg.c-red', has_text='Noch 2 Minuten').count() == 1, 'Rote Bühnennachricht im Timer')
        await T.hover('.output')
        await T.get_by_role('button', name=re.compile('Anzeige')).click()
        await T.get_by_role('radio', name='Liste').click()
        await T.locator('label[for="oc-cueStart"]').click()
        await T.wait_for_timeout(300)
        ok(await T.locator('.out-list .out-row.current').count() == 1, 'Listenlayout zeigt laufenden Cue hervorgehoben')
        await T.locator('label[for="oc-mirrorH"]').click()
        tf = await T.locator('.out-frame').evaluate('e => e.style.transform')
        ok('scaleX(-1)' in tf, 'Spiegeln wirkt')
        await T.locator('label[for="oc-transparent"]').click()
        ok(await T.locator('.output.keying').count() == 1, 'Transparenter Hintergrund zum Keyen')
        await shot(T, 'timer_liste')
        await T.get_by_role('button', name='Auf Standard zurücksetzen').click()
        await T.close()

        # 11) Prompter
        await A.keyboard.press('3')
        await A.wait_for_selector('.p-scroll')
        await A.get_by_role('button', name=re.compile('Optionen')).click()
        await A.locator('label[for="p-upper"]').click()
        await A.locator('label[for="p-blackout"]').click()
        await A.keyboard.press('Escape')
        ok(await A.locator('.p-text.upper').count() == 1 and await A.locator('.p-blackout').count() == 1, 'Prompter: Großbuchstaben und Abdunkeln')
        await A.get_by_role('button', name=re.compile('^Cues')).click()
        ok(await A.locator('.p-cue-list button').count() >= 10, 'Prompter: Cue-Liste zum Springen')
        await A.keyboard.press('Escape')
        await A.keyboard.press('ArrowRight')
        ok(await A.locator('.p-val').first.inner_text() == '50', 'Prompter: Tempo per Pfeiltaste')
        await A.keyboard.press('1')
        await A.wait_for_selector('.row.cue')

        # 12) Gast-Link „Nur ansehen“ mit ausgeblendeter Spalte + Schnellzugriffscode
        await A.locator('button[aria-label="Weitere Funktionen"]').click()
        await A.get_by_role('button', name='Gäste einladen').click()
        await A.locator('.share-new .check', has_text='Notizen').locator('input').uncheck()
        await A.get_by_role('button', name='Link erstellen').click()
        await A.wait_for_selector('.share-link')
        link = await A.locator('.share-link').first.inner_text()
        await A.get_by_role('button', name='Schnellzugriffscode').first.click()
        await A.wait_for_selector('.code-digits')
        code = (await A.inner_text('.code-digits')).replace(' ', '')
        ok(re.fullmatch(r'\d{6}', code) is not None, 'Schnellzugriffscode angezeigt')
        await A.keyboard.press('Escape')

        gctx = await b.new_context(viewport={'width': 1300, 'height': 900})
        G = await gctx.new_page()
        watch(G, 'G')
        await G.goto(link)
        await G.wait_for_selector('.row.cue')
        await G.wait_for_timeout(500)
        ok(await G.locator('.status-pill.s-view').count() == 1, 'Gast sieht „Nur ansehen“')
        ok(await G.locator('.controls').count() == 0, 'Gast hat keine Show-Steuerung')
        heads = await G.locator('.row.head .col-name').all_inner_texts()
        ok(not any('Notizen' in h for h in heads), 'Ausgeschlossene Spalte fehlt beim Gast')
        ok(await G.locator('.row.cue.st-current').count() == 1, 'Gast sieht den laufenden Cue live')
        ok(await G.locator('.title-input').first.get_attribute('readonly') is not None, 'Felder beim Gast schreibgeschützt')
        await G.close()

        cctx = await b.new_context(viewport={'width': 420, 'height': 800})
        C = await cctx.new_page()
        watch(C, 'C')
        await C.goto(BASE + '/#code')
        await C.fill('#access-code', code)
        await C.get_by_role('button', name='Öffnen').click()
        await C.wait_for_selector('.row.cue')
        ok('share=' in C.url and await C.locator('.status-pill.s-view').count() == 1, 'Code öffnet die Gastansicht')
        sw = await C.evaluate('document.documentElement.scrollWidth')
        ok(sw <= 420, f'Gastansicht am Handy ohne seitliches Scrollen ({sw}px)')
        await C.close()

        # 12b) Mehrere Cues, Sprung, Umwandeln, Spaltenlayout, Farbpalette
        n0 = await A.locator('.row.cue').count()
        await A.fill('#add-count', '3')
        await A.get_by_role('button', name='3 Cues').click()
        ok(await A.locator('.row.cue').count() == n0 + 3, 'Drei Cues auf einmal angelegt')
        await A.keyboard.press('Control+z')
        await A.fill('#add-count', '1')
        await A.locator('body').click(position={'x': 5, 'y': 400})
        await A.keyboard.press('g')
        await A.wait_for_selector('#jump-input')
        await A.fill('#jump-input', 'Spendenaufruf')
        await A.keyboard.press('Enter')
        await A.wait_for_timeout(400)
        ok(await A.locator('.grid[data-flash]').count() == 1 and await A.locator('#jump-input').count() == 0, 'Sprung zu Cue per Titel')
        h0 = await A.locator('.row.heading').count()
        last = A.locator('.row.cue').last
        await last.locator('button[aria-label="Cue-Optionen"]').click()
        await A.get_by_role('button', name='In Überschrift umwandeln').click()
        ok(await A.locator('.row.heading').count() == h0 + 1, 'Cue in Überschrift umgewandelt')
        await A.locator('.row.heading').last.locator('button[aria-label="Optionen der Überschrift"]').click()
        await A.get_by_role('button', name='In Cue umwandeln').click()
        ok(await A.locator('.row.heading').count() == h0, 'Überschrift zurück in Cue umgewandelt')
        await A.locator('button[aria-label="Spalten ein- oder ausblenden"]').click()
        await A.get_by_role('button', name='Spaltenlayout zurücksetzen').click()
        widths = await A.locator('.row.head .col-head:not(.private)').evaluate_all('els => els.map(e => Math.round(e.getBoundingClientRect().width))')
        ok(len(set(widths)) == 1 and widths[0] == 180, f'Spaltenlayout zurückgesetzt ({widths})')
        await A.locator('button[aria-label="Weitere Funktionen"]').click()
        await A.get_by_role('button', name='Einstellungen').click()
        await A.locator('input[aria-label="Farbe Violett"]').fill('#ff00aa')
        await A.keyboard.press('Escape')
        await A.wait_for_timeout(300)
        var = await A.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--tint-violet').trim()")
        ok(var.lower() == '#ff00aa', f'Eigene Farbpalette wirkt ({var})')

        # 13) Übersicht: Event, Vorlage, Archiv, Suche
        await A.keyboard.press('0')
        await A.wait_for_selector('.dash')
        await A.get_by_role('button', name='Neues Event').click()
        await A.wait_for_selector('.event-card')
        await A.locator('.event-card').first.click()
        await A.locator('input[aria-label="Name des Events"]').fill('MFY Test-Event')
        await A.get_by_role('button', name='Neuer Ablauf').click()
        await A.get_by_role('button', name='Leerer Ablauf').click()
        await A.wait_for_selector('.row.cue')
        ok('MFY Test-Event' in await A.inner_text('.crumb'), 'Neuer Ablauf liegt im Event')
        await A.locator('button[aria-label="Weitere Funktionen"]').click()
        await A.get_by_role('button', name='Einstellungen').click()
        await A.locator('label[for="is-template"]').click()
        await A.keyboard.press('Escape')
        await A.keyboard.press('0')
        await A.get_by_role('tab', name='Vorlagen').click()
        ok(await A.locator('.rd-row').count() == 1, 'Vorlage erscheint unter „Vorlagen“')
        await A.get_by_role('tab', name='Abläufe').click()
        await A.get_by_role('button', name='Neuer Ablauf').click()
        ok(await A.locator('.pop button', has_text='Neuer Ablauf').count() == 1, 'Vorlage beim Anlegen wählbar')
        await A.locator('.pop button', has_text='Neuer Ablauf').click()
        await A.wait_for_selector('.row.cue')
        await A.keyboard.press('0')
        await A.fill('input[aria-label="Suchen"]', 'Benefiz')
        ok(await A.locator('.rd-row').count() == 1, 'Suche findet den Beispielablauf')
        await shot(A, 'uebersicht')

        # 14) Handy-Breite der Regie
        m = await b.new_context(viewport={'width': 400, 'height': 860}, color_scheme='light')
        M = await m.new_page()
        watch(M, 'M')
        await M.goto(BASE + '/')
        await M.fill('#login-pw', PW)
        await M.get_by_role('button', name='Anmelden').click()
        await M.wait_for_selector('.row.cue, .dash')
        sw = await M.evaluate('document.documentElement.scrollWidth')
        ok(sw <= 400, f'Regie am Handy ohne seitliches Scrollen ({sw}px)')

        ok(not errors, 'Keine Skriptfehler: ' + '; '.join(errors[:3]))
        await b.close()


asyncio.run(main())
print('Fehlgeschlagen:', failed) if failed else print('Alle Oberflächentests bestanden')
sys.exit(1 if failed else 0)
