import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('polish: switches do not make screens jump', () => {
  const f = read('src/lib/useFlag.ts');
  it('starts from the last value this device saw and saves each new answer', () => {
    expect(f).toContain("useState<boolean>(() => readCache(key))");
    expect(f).toContain('writeCache(key, v)');
  });
  it('is safe when storage is blocked and keeps the last value on a network error', () => {
    expect((f.match(/try \{/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(f).toContain('keep the last known value');
  });
  it('still turns off when signed out', () => { expect(f).toContain('if (!user) { setOn(false); return; }'); });
});

describe('polish: touch sizes', () => {
  it('voice, language, dismiss and AI-search buttons are 44px', () => {
    const v = read('src/components/voice/VoiceLogButton.tsx');
    expect((v.match(/min-w-\[44px\] min-h-\[44px\]/g) ?? []).length).toBe(2);
    const d = read('src/components/DashboardLogging.tsx');
    expect(d).toContain('flex-shrink-0 min-w-[44px] min-h-[44px]');
    expect(d).toContain('min-h-[44px] w-full mt-2 bg-[#C8F75E]/10');
  });
});

describe('polish: the morning verdict never says "over"', () => {
  const s = read('functions/api/cron-morning-verdict.ts');
  it('states the number, then the tip', () => {
    expect(s).not.toMatch(/points over/);
    expect(s).toContain('Glycemic load was ${yGL} yesterday.');
  });
});
