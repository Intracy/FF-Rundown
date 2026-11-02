import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Rundown } from '../types';
import { Timeline } from '../timing';
import { fmtDate } from '../time';
import { AppState, store } from '../store';
import { blankRundown, makeSample } from '../sample';
import { fromCsv, fromJson, toCsv } from '../csv';
import { Icon, copyText } from './common';

/* ---------- Abläufe wechseln / anlegen ---------- */
export function RundownSwitcher({ app, close }: { app: AppState; close: () => void }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const list = Object.values(app.rundowns).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const active = app.rundowns[app.activeId];
  return (
    <div className="menu-body">
      <span className="eyebrow">Abläufe</span>
      <ul className="rd-list">
        {list.map((r) => {
          const st = app.live[r.id]?.status ?? 'idle';
          return (
            <li key={r.id}>
              <button
                className={r.id === app.activeId ? 'on' : ''}
                onClick={() => {
                  store.setActive(r.id);
                  close();
                }}
              >
                <span className={`dot st-${st}`} aria-hidden="true" />
                <span className="rd-name">{r.title || 'Ohne Titel'}</span>
                <span className="rd-date num">{fmtDate(r.date)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="menu-list">
        <button onClick={() => (store.addRundown(blankRundown()), close())}>
          <Icon name="plus" size={14} /> Neuer Ablauf
        </button>
        <button onClick={() => (store.addRundown(makeSample()), close())}>
          <Icon name="plus" size={14} /> Neu aus Beispiel
        </button>
        <button
          onClick={() => {
            const t = Date.now();
            store.addRundown({ ...JSON.parse(JSON.stringify(active)), id: Math.random().toString(36).slice(2, 10), title: `${active.title} (Kopie)`, createdAt: t, updatedAt: t });
            close();
          }}
        >
          <Icon name="copy" size={14} /> „{active.title}“ duplizieren
        </button>
        {!confirmDel ? (
          <button className="danger" onClick={() => setConfirmDel(true)}>
            <Icon name="trash" size={14} /> „{active.title}“ löschen
          </button>
        ) : (
          <div className="confirm">
            <span>Der Ablauf wird {app.syncStatus === 'online' ? 'auf allen Geräten' : 'in diesem Browser'} gelöscht.</span>
            <button
              className="btn danger-fill small"
              onClick={() => {
                store.deleteRundown(active.id);
                close();
              }}
            >
              Löschen
            </button>
            <button className="btn small" onClick={() => setConfirmDel(false)}>
              Abbrechen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Modal ---------- */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Import / Export ---------- */
export function ImportExport({ r, tl, onClose }: { r: Rundown; tl: Timeline; onClose: () => void }) {
  const [tab, setTab] = useState<'csv' | 'json' | 'import'>('csv');
  const [note, setNote] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState('');
  const out = useRef<HTMLTextAreaElement>(null);
  const content = tab === 'csv' ? toCsv(r, tl) : tab === 'json' ? JSON.stringify(r, null, 2) : '';
  const fileBase = (r.title || 'ablauf').replace(/[^\wäöüÄÖÜß-]+/g, '_').slice(0, 60);

  const doImport = (text: string, name: string) => {
    try {
      const trimmed = text.trim();
      const rd = trimmed.startsWith('{') ? fromJson(trimmed) : fromCsv(trimmed, name.replace(/\.(csv|txt|json)$/i, '') || 'Importierter Ablauf');
      store.addRundown(rd);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Datei konnte nicht gelesen werden.');
    }
  };

  return (
    <Modal title="Import & Export" onClose={onClose}>
      <div className="seg tabs" role="tablist">
        {(
          [
            ['csv', 'CSV exportieren'],
            ['json', 'Sicherung (JSON)'],
            ['import', 'Importieren'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => (setTab(id), setNote(''), setError(''))}>
            {label}
          </button>
        ))}
      </div>

      {tab !== 'import' ? (
        <div className="modal-body">
          <p className="hint">
            {tab === 'csv'
              ? 'Semikolon-getrennt, öffnet direkt in Excel, Numbers oder Google Sheets. Mit geplanten Start- und Endzeiten.'
              : 'Vollständige Sicherung inklusive Spalten, Farben und Skripten. Lässt sich hier wieder importieren.'}
          </p>
          <textarea ref={out} className="export-box" readOnly value={content} aria-label="Exportinhalt" />
          <div className="menu-actions">
            <button
              className="btn primary"
              onClick={async () => {
                const ok = await copyText(content, out.current);
                setNote(ok ? 'In die Zwischenablage kopiert.' : 'Text ist markiert, bitte mit Strg/Cmd+C kopieren.');
              }}
            >
              <Icon name="copy" size={14} /> Kopieren
            </button>
            {!__ARTIFACT__ && (
              <button
                className="btn"
                onClick={() => {
                  const blob = new Blob([tab === 'csv' ? '﻿' + content : content], { type: tab === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = `${fileBase}.${tab}`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                }}
              >
                <Icon name="io" size={14} /> Herunterladen
              </button>
            )}
            {note && <span className="hint">{note}</span>}
          </div>
        </div>
      ) : (
        <div className="modal-body">
          <p className="hint">
            CSV aus Excel oder Google Sheets mit einer Spalte „Titel“ (optional „Dauer“, „Untertitel“, „Fixstart“, „Typ“, „Skript“; weitere Spalten werden übernommen) oder eine Taktgeber-Sicherung. Es entsteht ein neuer Ablauf.
          </p>
          <label className="file-drop" htmlFor="import-file">
            <Icon name="io" />
            <span>Datei wählen (.csv, .json)</span>
            <input
              id="import-file"
              type="file"
              accept=".csv,.json,.txt,text/csv,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const rd = new FileReader();
                rd.onload = () => doImport(String(rd.result), f.name);
                rd.readAsText(f);
              }}
            />
          </label>
          <label className="eyebrow" htmlFor="import-paste">
            Oder Inhalt einfügen
          </label>
          <textarea id="import-paste" className="export-box small" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Titel;Dauer;Kamera\nBegrüßung;3:00;Totale'} />
          <div className="menu-actions">
            <button className="btn primary" disabled={!paste.trim()} onClick={() => doImport(paste, 'Importierter Ablauf')}>
              Importieren
            </button>
            {error && <span className="error">{error}</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Tastenkürzel ---------- */
export function Help({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Leertaste', 'Nächster Cue (startet die Show, wenn sie noch nicht läuft)'],
    ['P', 'Pause / Fortsetzen'],
    ['B', 'Zurück zum vorherigen Cue'],
    ['+ / −', 'Aktuellen Cue um 1 Minute verlängern / kürzen'],
    ['Umschalt + E', 'Show beenden'],
    ['F', 'Mitlaufen an / aus'],
    ['L', 'Ablauf sperren / entsperren'],
    ['1 · 2 · 3', 'Ablauf · Timer · Prompter'],
    ['Strg/Cmd + Z', 'Rückgängig (Umschalt für Wiederholen)'],
    ['Doppelklick', 'Zelle bearbeiten, Strg/Cmd + Enter speichert, Esc verwirft'],
    ['Klick auf die Nummer', 'Cue als Nächstes vormerken'],
    ['Prompter: Leertaste · ↑ ↓', 'Scrollen starten/stoppen · Tempo'],
  ];
  return (
    <Modal title="Tastenkürzel" onClose={onClose}>
      <div className="modal-body">
        <dl className="keys">
          {rows.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
    </Modal>
  );
}
