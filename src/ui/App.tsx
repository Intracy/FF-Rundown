import React, { useEffect, useMemo, useState } from 'react';
import { now as clockNow, store, useApp } from '../store';
import { computeTimeline } from '../timing';
import * as L from '../live';
import { emptyLive } from '../live';
import { RundownView } from './RundownView';
import { TopBar, VIEWS, View } from './TopBar';
import { OutputView } from './OutputView';
import { PrompterView } from './PrompterView';
import { Help, ImportExport } from './Dialogs';

function useClock(interval = 250) {
  const [t, setT] = useState(clockNow());
  useEffect(() => {
    const id = window.setInterval(() => setT(clockNow()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return t;
}

const isView = (v: string): v is View => VIEWS.some((x) => x.id === v);

function useHashView(): [View, (v: View) => void] {
  const read = () => {
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
  const r = app.rundowns[app.activeId];
  const live = app.live[r.id] ?? emptyLive();
  const now = useClock();
  const [view, setView] = useHashView();
  const [dialog, setDialog] = useState<null | 'io' | 'help'>(null);
  const tl = useMemo(() => computeTimeline(r, live, now), [r, live, now]);

  // Automatisches Weiterschalten (Auto-Start)
  useEffect(() => {
    const nxt = L.autoTick(r, live, now);
    if (nxt) store.setLive(r.id, () => nxt);
  }, [now, r, live]);

  useEffect(() => {
    document.title = view === 'ablauf' ? `${r.title} · Taktgeber` : `${VIEWS.find((v) => v.id === view)?.label} · ${r.title}`;
  }, [view, r.title]);

  // Tastenkürzel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (dialog || t.closest('input, textarea, select, [contenteditable="true"], .pop')) return;
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
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (!s.ui.locked) store.redo(id);
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === '1' || e.key === '2' || e.key === '3') return setView(VIEWS[+e.key - 1].id);
      if (view === 'prompter') return; // Prompter hat eigene Tasten
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
          if (e.shiftKey) set((l) => L.end(l, clockNow()));
          break;
        case 'f':
        case 'F':
          store.setUi({ follow: !s.ui.follow });
          break;
        case 'l':
        case 'L':
          store.setUi({ locked: !s.ui.locked });
          break;
        case '?':
          setDialog('help');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, view, setView]);

  return (
    <div className={`app view-${view}`}>
      <TopBar r={r} live={live} tl={tl} now={now} view={view} setView={setView} app={app} openDialog={setDialog} />
      <main className="main">
        {view === 'ablauf' && <RundownView rundown={r} live={live} tl={tl} now={now} locked={app.ui.locked} follow={app.ui.follow} />}
        {view === 'timer' && <OutputView r={r} live={live} tl={tl} now={now} />}
        {view === 'prompter' && <PrompterView r={r} live={live} tl={tl} />}
      </main>
      {dialog === 'io' && <ImportExport r={r} tl={tl} onClose={() => setDialog(null)} />}
      {dialog === 'help' && <Help onClose={() => setDialog(null)} />}
    </div>
  );
}
