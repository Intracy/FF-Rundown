import React, { useEffect, useMemo, useState } from 'react';
import { now as clockNow, store, useApp } from '../store';
import { computeTimeline } from '../timing';
import * as L from '../live';
import { normalizeLive } from '../live';
import { setDisplay } from '../time';
import { RundownView } from './RundownView';
import { DialogId, TopBar, VIEWS, View } from './TopBar';
import { OutputView } from './OutputView';
import { PrompterView } from './PrompterView';
import { Dashboard } from './Dashboard';
import { CodeEntry, Help, ImportExport, LoginScreen, MentionsDialog, SettingsDialog, ShareDialog, TrashDialog, VariablesDialog } from './Dialogs';
import { TextContext } from './common';

function useClock(interval = 250) {
  const [t, setT] = useState(clockNow());
  useEffect(() => {
    const id = window.setInterval(() => setT(clockNow()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return t;
}

const ALL_VIEWS: View[] = ['uebersicht', 'ablauf', 'timer', 'prompter', 'code'];
const isView = (v: string): v is View => (ALL_VIEWS as string[]).includes(v);

function useHashView(): [View, (v: View) => void] {
  const read = (): View => {
    const h = location.hash.replace('#', '');
    return isView(h) ? h : 'ablauf';
  };
  const [view, setView] = useState<View>(read);
  useEffect(() => {
    const on = () => setView(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [
    view,
    (v) => {
      if (location.hash !== '#' + v) location.hash = v;
      setView(v);
    },
  ];
}

export function App() {
  const app = useApp();
  const [rawView, setView] = useHashView();
  const view: View = app.share && rawView === 'uebersicht' ? 'ablauf' : rawView;
  if (view === 'code') return <CodeEntry />;
  if (app.authRequired) return <LoginScreen error={app.authError} />;
  return <Main app={app} view={view} setView={setView} />;
}

function Main({ app, view, setView }: { app: ReturnType<typeof useApp>; view: View; setView: (v: View) => void }) {
  const r = app.rundowns[app.activeId];
  const live = app.live[r.id] ?? normalizeLive(null);
  const now = useClock();
  const [dialog, setDialog] = useState<null | DialogId>(null);
  const readonly = app.share?.mode === 'view';
  setDisplay(r.settings.timezone, r.settings.clock);
  const tl = useMemo(() => computeTimeline(r, live, now), [r, live, now]);
  const textCtx = useMemo(() => ({ variables: r.variables, mentions: r.mentions }), [r.variables, r.mentions]);

  // Eigene Farbpalette des Ablaufs auf alle Ansichten (auch Popover) anwenden
  useEffect(() => {
    const root = document.documentElement;
    const ids = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'grey'] as const;
    for (const id of ids) {
      const v = r.palette[id];
      if (v) root.style.setProperty(`--tint-${id}`, v);
      else root.style.removeProperty(`--tint-${id}`);
    }
  }, [r.palette]);

  // Automatisches Weiterschalten (Auto-Start)
  useEffect(() => {
    if (readonly) return;
    const nxt = L.autoTick(r, live, now);
    if (nxt) store.setLive(r.id, () => nxt);
  }, [now, r, live, readonly]);

  useEffect(() => {
    document.title = view === 'uebersicht' ? 'Übersicht · Taktgeber' : view === 'ablauf' ? `${r.title} · Taktgeber` : `${VIEWS.find((v) => v.id === view)?.label} · ${r.title}`;
  }, [view, r.title]);

  // Tastenkürzel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (dialog || t.closest('input, textarea, select, [contenteditable="true"], .pop, .out-config')) return;
      const mod = e.metaKey || e.ctrlKey;
      const s = store.get();
      const id = s.activeId;
      const set = (fn: Parameters<typeof store.setLive>[1]) => store.setLive(id, fn);
      const rd = s.rundowns[id];
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (s.ui.locked) return;
        e.shiftKey ? store.redo(id) : store.undo(id);
        return;
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (view === 'ablauf') window.dispatchEvent(new Event('tg-jump'));
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (!s.ui.locked) store.redo(id);
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === '0' && !s.share) return setView('uebersicht');
      if (e.key === '1' || e.key === '2' || e.key === '3') return setView(VIEWS[+e.key - 1].id);
      if (view === 'prompter' || view === 'uebersicht') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          set((l) => L.next(rd, l, clockNow()));
          break;
        case 'p':
        case 'P':
          set((l) => L.togglePlay(rd, l, clockNow()));
          break;
        case 'b':
        case 'B':
          set((l) => L.prev(rd, l, clockNow()));
          break;
        case '+':
        case '=':
          set((l) => L.adjust(l, 60_000));
          break;
        case '-':
          set((l) => L.adjust(l, -60_000));
          break;
        case 'E':
          if (e.shiftKey) set((l) => L.end(l, clockNow(), rd));
          break;
        case 'f':
        case 'F':
          store.setUi({ follow: !s.ui.follow });
          break;
        case 'l':
        case 'L':
          if (!s.share || s.share.mode === 'edit') store.setUi({ locked: !s.ui.locked });
          break;
        case 'g':
        case 'G':
          if (view === 'ablauf') {
            e.preventDefault();
            window.dispatchEvent(new Event('tg-jump'));
          }
          break;
        case '?':
          setDialog('help');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, view, setView]);

  if (view === 'uebersicht')
    return (
      <TextContext.Provider value={textCtx}>
        <div className="app view-uebersicht">
          <Dashboard
            app={app}
            open={(id) => {
              store.setActive(id);
              setView('ablauf');
            }}
          />
        </div>
      </TextContext.Provider>
    );

  return (
    <TextContext.Provider value={textCtx}>
      <div className={`app view-${view}`}>
        <TopBar r={r} live={live} tl={tl} now={now} view={view} setView={setView} app={app} openDialog={setDialog} />
        <main className="main">
          {view === 'ablauf' && <RundownView rundown={r} live={live} tl={tl} now={now} locked={app.ui.locked || readonly} follow={app.ui.follow} readonly={readonly} />}
          {view === 'timer' && <OutputView r={r} live={live} tl={tl} now={now} readonly={readonly} />}
          {view === 'prompter' && <PrompterView r={r} live={live} tl={tl} readonly={readonly} />}
        </main>
        {dialog === 'io' && <ImportExport r={r} tl={tl} onClose={() => setDialog(null)} />}
        {dialog === 'help' && <Help onClose={() => setDialog(null)} />}
        {dialog === 'settings' && <SettingsDialog r={r} app={app} tl={tl} onClose={() => setDialog(null)} />}
        {dialog === 'variables' && <VariablesDialog r={r} onClose={() => setDialog(null)} />}
        {dialog === 'mentions' && <MentionsDialog r={r} onClose={() => setDialog(null)} />}
        {dialog === 'trash' && <TrashDialog r={r} onClose={() => setDialog(null)} />}
        {dialog === 'share' && <ShareDialog r={r} onClose={() => setDialog(null)} />}
      </div>
    </TextContext.Provider>
  );
}
