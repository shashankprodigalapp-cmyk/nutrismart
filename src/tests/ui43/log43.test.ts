import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tr } from '../../lib/copyHi';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
describe('Log screen from the design', () => {
  const d = read('src/components/DashboardLogging.tsx');
  const n = read('src/components/screens/LogNew.tsx');
  it('the new pieces only show in the new look, and the old look is untouched', () => {
    expect(d).toContain("document.documentElement.getAttribute('data-ui') === 'new'");
    for (const s of ['{nl && <NewLogHeader', '{!nl && (', '{(!nl || showNumbers) && (<>', '{!nl && <MyUsualsGrid', '{nl && <MicHero typed={!voiceOn}', '{nl && !query && <NewUsuals', '{nl && undo && <UndoBar']) expect(d, s).toContain(s);
  });
  it('keeps everything the other tests and the browser tests rely on', () => {
    for (const s of ['My Usuals', 'Tap to log all', 'Recents', 'Add glass', 'Remove glass', 'Search food', 'placeholder="search food…"', 'min-h-[44px] w-full mt-2 bg-[#C8F75E]/10', 'C {Number(food.carbs).toFixed(0)}g', 'if (!editEntry) announceLogged(entryData.meal);', 'setSheetFood(food ?? rebuilt)']) expect(d, s).toContain(s);
  });
  it('Show numbers is remembered and defaults to shown', () => {
    expect(d).toContain('useState(() => !caloriesHidden())');
    expect(d).toContain('setCaloriesHidden(showNumbers)');
  });
  it('undo removes only the entry just logged, never on an edit, and goes away by itself', () => {
    expect(d).toContain('if (!editEntry) setUndo({ id, name: entryData.food_name });');
    expect(d).toContain('void handleDelete(undo.id)');
    expect(d).toContain('setTimeout(() => setUndo(null), 7000)');
  });
  it('the mic card reuses the same voice button, so there is still one voice path', () => {
    expect((d.match(/<VoiceLogButton /g) ?? []).length).toBe(2);
    expect(d).toContain('{voiceOn && !nl && <VoiceLogButton');
  });
  it('the card is always there: with voice off it becomes a type-it button that focuses the search box', () => {
    expect(n).toContain('Type what you ate');
    expect(d).toContain('onType={() => document.querySelector<HTMLInputElement>(')
    expect(tr('hi', 'Type what you ate')).toBe('Likhiye, kya khaya');
  });
  it('new components write nothing and make no network call', () => {
    expect(/supabase\.|\.put\(|\.add\(|\.update\(|\.delete\(|fetch\(|coachApi/.test(n)).toBe(false);
    expect(n).toContain('data-testid="usual-row"');
    expect(n).toContain('onContextMenu');
  });
  it('rows are at least 44px, switch is at least 44px, and Hinglish covers the words', () => {
    const css = read('src/styles/log.css');
    expect(css).toContain('.nl-row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 64px');
    expect(css).toContain('.nl-switch { display: inline-flex; align-items: center; gap: 8px; min-height: 44px');
    expect(css).toContain('.nl-undo-b { min-height: 44px');
    expect(tr('hi', 'Show numbers')).toBe('Numbers dikhayein');
    expect(tr('hi', 'Undo')).toBe('Wapas');
    expect(tr('hi', 'Breakfast')).toBe('Nashta');
  });
});
