/**
 * AppearanceCard.tsx — Light / Dark / Same as phone, and English / Hinglish. Shown in Profile only when 'ui_new_design' is on.
 */
import { useEffect, useState } from 'react';
import { useFlag } from '../../lib/useFlag';
import { APPEARANCE_EVENT, NEW_DESIGN_FLAG, readAppearance, writeAppearance, type Appearance } from '../../lib/theme';
import { setLang, useLang } from '../../lib/lang';

const CHOICES: { key: Appearance; label: string }[] = [
  { key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }, { key: 'system', label: 'Same as phone' },
];

export function AppearanceCard() {
  const on = useFlag(NEW_DESIGN_FLAG);
  const lang = useLang();
  const [pref, setPref] = useState<Appearance>(readAppearance);
  useEffect(() => {
    const f = () => setPref(readAppearance());
    window.addEventListener(APPEARANCE_EVENT, f);
    return () => window.removeEventListener(APPEARANCE_EVENT, f);
  }, []);
  if (!on) return null;
  return (
    <section data-testid="appearance-card" className="bg-[#1C1C1E] rounded-2xl p-4" aria-label="Appearance">
      <h2 className="text-[11px] uppercase tracking-wide text-[#8E8E93]">Appearance</h2>
      <div role="radiogroup" aria-label="Appearance" className="mt-2 grid grid-cols-3 gap-2">
        {CHOICES.map(c => (
          <button
            key={c.key} type="button" role="radio" aria-checked={pref === c.key}
            onClick={() => writeAppearance(c.key)}
            className={'min-h-[44px] rounded-xl px-2 text-sm font-medium ' + (pref === c.key ? 'bg-[#C8F75E] text-[#111113]' : 'bg-[#2C2C2E] text-[#EBEBF5]')}
          >
            {c.label}
          </button>
        ))}
      </div>
      <h2 className="mt-4 text-[11px] uppercase tracking-wide text-[#8E8E93]">Language (new screens)</h2>
      <div role="radiogroup" aria-label="Language" className="mt-2 grid grid-cols-2 gap-2">
        {([['en', 'English'], ['hi', 'Hinglish']] as const).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={lang === k} onClick={() => setLang(k)}
            className={'min-h-[44px] rounded-xl px-2 text-sm font-medium ' + (lang === k ? 'bg-[#C8F75E] text-[#111113]' : 'bg-[#2C2C2E] text-[#EBEBF5]')}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
