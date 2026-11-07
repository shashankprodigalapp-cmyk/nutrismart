/**
 * ThemeHost.tsx — mounts once in the app shell. Turns the new look on or off from the switch
 * 'ui_new_design' and follows the person's Light / Dark / System choice. Renders nothing.
 */
import { useEffect, useState } from 'react';
import { useFlag } from '../../lib/useFlag';
import '../../styles/newdesign.css';
import {
  APPEARANCE_EVENT, NEW_DESIGN_FLAG, applyTheme, readAppearance, readCachedOn, resolveTheme, writeCachedOn,
} from '../../lib/theme';

const systemDark = () => { try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return true; } };

export function ThemeHost() {
  const live = useFlag(NEW_DESIGN_FLAG);
  // The switch is read from the database, so it is "off" for a moment on every start. Until that
  // settles we keep the last known state, so the screen does not flash between two looks.
  const [settled, setSettled] = useState(false);
  const [pref, setPref] = useState(readAppearance);
  const [dark, setDark] = useState(systemDark);

  useEffect(() => { const t = setTimeout(() => setSettled(true), 3000); return () => clearTimeout(t); }, []);
  useEffect(() => { if (live) { writeCachedOn(true); setSettled(true); } }, [live]);
  useEffect(() => { if (settled && !live) writeCachedOn(false); }, [settled, live]);
  useEffect(() => {
    const onPref = () => setPref(readAppearance());
    window.addEventListener(APPEARANCE_EVENT, onPref);
    let mq: MediaQueryList | null = null;
    const onSys = () => setDark(systemDark());
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', onSys); } catch { /* old browser */ }
    return () => { window.removeEventListener(APPEARANCE_EVENT, onPref); try { mq?.removeEventListener('change', onSys); } catch { /* ignore */ } };
  }, []);

  const on = live || (!settled && readCachedOn());
  useEffect(() => { applyTheme(on, resolveTheme(pref, dark)); }, [on, pref, dark]);
  return null;
}
