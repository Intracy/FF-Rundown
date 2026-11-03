"""Oberflächentest für Benutzerkonten, Rollen, API-Dialog, QR, Ansicht, Block-Ende und Handy-Karten.

Aufruf: python3 scripts/e2e-accounts.py [BASIS-URL] [SCREENSHOT-ORDNER]
Erwartet einen frisch gestarteten Server OHNE ADMIN_PASSWORD und mit leerem Datenordner.
"""
import asyncio
import re
import sys

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8788'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
failed = 0


def ok(cond, msg):
    global failed
    print(('ok  ' if cond else 'FAIL'), msg)
    if not cond:
        failed += 1


async def shot(page, name):
    if SHOTS:
        await page.screenshot(path=f'{SHOTS}/{name}.png')


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        errors = []
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        A = await ctx.new_page()
        A.on('pageerror', lambda e: errors.append(str(e)))

        # Einrichtung
        await A.goto(BASE + '/')
        await A.wait_for_selector('#login-email')
        ok(await A.get_by_role('heading', name='Taktgeber einrichten').count() == 1, 'Erster Start zeigt die Einrichtung')
        await A.fill('#login-name', 'Tobias')
        await A.fill('#login-email', 'admin@example.org')
        await A.fill('#login-pw', 'admin-passwort')
        await A.get_by_role('button', name='Admin-Konto anlegen').click()
        await A.wait_for_selector('.row.cue')
        ok('admin' in (await A.inner_text('.user-btn')).lower(), 'Admin angemeldet, Rolle im Kopf')

        # Benutzer anlegen
        await A.locator('.user-btn').click()
        await A.get_by_role('button', name='Benutzer verwalten').click()
        await A.fill('#nu-name', 'Regie')
        await A.fill('#nu-email', 'op@example.org')
        await A.select_option('#nu-role', 'operator')
        await A.fill('#nu-pw', 'operator-pw-1')
        await A.get_by_role('button', name='Anlegen').click()
        await A.wait_for_selector('.note-box')
        ok(await A.locator('.user-list li').count() == 2, 'Operator-Konto angelegt')
        await A.keyboard.press('Escape')

        # API-Dialog
        await A.locator('button[aria-label="Weitere Funktionen"]').click()
        await A.get_by_role('button', name='API & Integrationen').click()
        await A.wait_for_selector('.api-url code')
        ok('••••' in await A.inner_text('.api-url code'), 'Token ist zunächst verborgen')
        await A.get_by_role('tab', name='Auslesen').click()
        await A.locator('.ep-list li', has_text='Status').get_by_role('button', name='Abrufen').click()
        await A.wait_for_selector('.api-resp pre')
        ok('"state"' in await A.inner_text('.api-resp pre'), 'API-Test zeigt die Antwort von /status')
        await A.get_by_role('tab', name='Sicherheit').click()
        ok(await A.get_by_role('button', name='Token sperren & neu erzeugen').is_disabled(), 'Neu erzeugen erst nach Eingabe von NEU')
        await shot(A, 'api_dialog')
        await A.keyboard.press('Escape')

        # Gast-Link mit QR-Code
        await A.locator('button[aria-label="Weitere Funktionen"]').click()
        await A.get_by_role('button', name='Gäste einladen').click()
        await A.get_by_role('button', name='Link erstellen').click()
        await A.get_by_role('button', name='QR-Code').first.click()
        ok(await A.locator('.qr-img svg').count() == 1, 'QR-Code für den Gast-Link')
        await A.keyboard.press('Escape')

        # Ansicht: kompakt, erledigte ausblenden, Darstellung
        await A.locator('button[aria-label="Ansicht"]').click()
        await A.get_by_role('radio', name='Hell').click()
        await A.locator('label[for="v-compact"]').click()
        await A.locator('label[for="v-hidedone"]').click()
        await A.keyboard.press('Escape')
        ok(await A.evaluate("document.documentElement.getAttribute('data-theme')") == 'light', 'Darstellung manuell auf Hell')
        ok(await A.locator('.grid.compact.hide-done').count() == 1, 'Kompakte Zeilen und Erledigte ausblenden')

        # Block-Ende und eigene Farbe
        n_end = await A.locator('.row.heading.block-end').count()
        await A.get_by_role('button', name='Block-Ende').click()
        ok(await A.locator('.row.heading.block-end').count() == n_end + 1, 'Block-Ende eingefügt')
        await A.locator('.row.cue').first.locator('button[aria-label="Cue-Optionen"]').click()
        await A.locator('input[aria-label="Eigene Farbe"]').fill('#12ab34')
        await A.keyboard.press('Escape')
        ok(await A.locator('.row.cue[data-tint="custom"]').count() == 1, 'Eigene Farbe für einen Cue')

        # Show mit Restzeit setzen und Schrittweite
        await A.keyboard.press('p')
        await A.wait_for_timeout(400)
        await A.locator('button[aria-label="Zeit genau anpassen"]').click()
        rest = A.locator('input[aria-label="Restzeit setzen"]')
        await rest.click()
        await rest.fill('3:00')
        await rest.press('Enter')
        await A.get_by_role('radio', name='30s').click()
        await A.keyboard.press('Escape')
        await A.wait_for_timeout(300)
        t = await A.inner_text('.big-timer')
        ok(t in ('03:00', '02:59'), f'Restzeit auf 3:00 gesetzt ({t})')
        ok(await A.get_by_role('button', name='+30s').count() == 1, 'Schrittweite der ±-Knöpfe umgestellt')
        ok(await A.locator('.live-since').count() == 1, '„Live seit“ wird angezeigt')
        await shot(A, 'ablauf_hell')

        # Operator: darf steuern, aber nicht bearbeiten
        octx = await b.new_context(viewport={'width': 1300, 'height': 860})
        O = await octx.new_page()
        O.on('pageerror', lambda e: errors.append('O: ' + str(e)))
        await O.goto(BASE + '/')
        await O.fill('#login-email', 'op@example.org')
        await O.fill('#login-pw', 'falsch-falsch')
        await O.get_by_role('button', name='Anmelden').click()
        await O.wait_for_selector('.login .error')
        ok('falsch' in (await O.inner_text('.login .error')).lower(), 'Falsches Passwort wird gemeldet')
        await O.fill('#login-pw', 'operator-pw-1')
        await O.get_by_role('button', name='Anmelden').click()
        await O.wait_for_selector('.row.cue')
        await O.wait_for_timeout(400)
        ok('operator' in (await O.inner_text('.user-btn')).lower(), 'Operator angemeldet')
        ok(await O.locator('.title-input').first.get_attribute('readonly') is not None, 'Operator kann den Ablauf nicht bearbeiten')
        ok(await O.locator('.controls').count() == 1, 'Operator hat die Show-Steuerung')
        before = await O.inner_text('.now-title')
        await O.locator('.ctl.go').click()
        await A.wait_for_timeout(600)
        ok(await A.inner_text('.now-title') != before, 'Operator schaltet weiter, Regie sieht es sofort')
        await O.locator('button[aria-label="Weitere Funktionen"]').click()
        ok(await O.get_by_role('button', name='API & Integrationen').count() == 0, 'Operator sieht keinen API-Dialog')
        await O.keyboard.press('Escape')

        # Abmelden
        await O.locator('.user-btn').click()
        await O.get_by_role('button', name='Abmelden').click()
        await O.wait_for_selector('#login-email')
        ok(True, 'Abmelden führt zur Anmeldung')

        # Handy: Karten und Steuerleiste unten
        m = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        M = await m.new_page()
        M.on('pageerror', lambda e: errors.append('M: ' + str(e)))
        await M.goto(BASE + '/')
        await M.fill('#login-email', 'admin@example.org')
        await M.fill('#login-pw', 'admin-passwort')
        await M.get_by_role('button', name='Anmelden').click()
        await M.wait_for_selector('.row.cue')
        await M.wait_for_timeout(500)
        sw = await M.evaluate('document.documentElement.scrollWidth')
        ok(sw <= 390, f'Handy ohne seitliches Scrollen ({sw}px)')
        pos = await M.locator('.transport .controls').evaluate('e => getComputedStyle(e).position')
        ok(pos == 'fixed', 'Steuerleiste unten fixiert')
        card = M.locator('.row.cue').nth(1)
        visible_cells = await card.locator('.c-cell:visible').count()
        await card.locator('.expand-btn').click()
        ok(await card.locator('.c-cell:visible').count() >= visible_cells, 'Karte lässt sich aufklappen')
        await shot(M, 'handy_karten')

        # Umsortieren per Finger
        titles = await M.locator('.row.cue .title-input').evaluate_all('els => els.map(e => e.value)')
        await M.set_viewport_size({'width': 390, 'height': 1600})
        await M.locator('.row.cue').nth(1).evaluate("e => e.scrollIntoView({ block: 'center' })")
        await M.wait_for_timeout(200)
        grip = M.locator('.row.cue').nth(1).locator('.grip')
        gb = await grip.bounding_box()
        target = await M.locator('.row.cue').nth(2).bounding_box()
        await M.evaluate(
            """([x, y, ty]) => {
              const g = document.elementFromPoint(x, y)?.closest('.grip');
              if (!g) throw new Error('Griff nicht gefunden bei ' + x + ',' + y);
              const ev = (type, cy) => new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: cy, isPrimary: true });
              g.dispatchEvent(ev('pointerdown', y));
              g.dispatchEvent(ev('pointermove', y + 20));
              g.dispatchEvent(ev('pointermove', ty));
              g.dispatchEvent(ev('pointerup', ty));
            }""",
            [gb['x'] + gb['width'] / 2, gb['y'] + gb['height'] / 2, target['y'] + target['height'] * 0.56],
        )
        await M.wait_for_timeout(300)
        after = await M.locator('.row.cue .title-input').evaluate_all('els => els.map(e => e.value)')
        ok(after != titles and after[1] == titles[2], 'Umsortieren per Finger')

        ok(not errors, 'Keine Skriptfehler: ' + '; '.join(errors[:3]))
        await b.close()


asyncio.run(main())
print('Fehlgeschlagen:', failed) if failed else print('Alle Konto- und Mobil-Tests bestanden')
sys.exit(1 if failed else 0)
