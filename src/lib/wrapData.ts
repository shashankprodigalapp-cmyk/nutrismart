/**
 * wrapData.ts — pure helpers for the Daily wrap and the Weekly plate poster. No network, no database.
 * Only real things the person did are listed. Nothing is compared, ranked or taken away.
 */
export interface WrapInput { meals: number; glasses: number; energy: 'low' | 'steady' | 'high' | null; sparksToday: number; }
export interface WrapLine { key: string; icon: string; text: string; }

const ENERGY_WORD = { low: 'low', steady: 'steady', high: 'good' } as const;

export function wrapLines(i: WrapInput): WrapLine[] {
  const out: WrapLine[] = [];
  if (i.meals > 0) out.push({ key: 'meals', icon: '🍽️', text: `${i.meals} ${i.meals === 1 ? 'meal' : 'meals'} logged` });
  if (i.glasses > 0) out.push({ key: 'water', icon: '💧', text: `${i.glasses} ${i.glasses === 1 ? 'glass' : 'glasses'} of water` });
  if (i.energy) out.push({ key: 'energy', icon: '⚡', text: `Energy check-in: ${ENERGY_WORD[i.energy]}` });
  return out;
}

export function wrapTitle(i: WrapInput): string {
  return i.meals > 0 || i.glasses > 0 || i.energy ? 'A good day of paying attention' : 'A quiet day, and that is fine';
}

/** Monday to Sunday of the week holding `today` (YYYY-MM-DD), e.g. "26 Oct to 1 Nov". */
export function weekRangeLabel(today: string): string {
  const base = new Date(today + 'T00:00:00Z');
  if (!Number.isFinite(base.getTime())) return '';
  const dow = (base.getUTCDay() + 6) % 7;
  const a = new Date(base.getTime() - dow * 86_400_000);
  const b = new Date(a.getTime() + 6 * 86_400_000);
  const f = (d: Date) => `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
  return `${f(a)} to ${f(b)}`;
}

export interface PosterStats { days: number; meals: number; regions: number; }
export function posterStats(today: string, rows: { log_date: string }[], regions: number): PosterStats {
  const base = new Date(today + 'T00:00:00Z');
  const dow = (base.getUTCDay() + 6) % 7;
  const start = new Date(base.getTime() - dow * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(base.getTime() + (6 - dow) * 86_400_000).toISOString().slice(0, 10);
  const inWeek = rows.filter(r => r.log_date >= start && r.log_date <= end);
  return { days: new Set(inWeek.map(r => r.log_date)).size, meals: inWeek.length, regions };
}

/** Draws the poster to a canvas and returns a PNG blob. Browser only. */
export function drawPoster(opts: { name: string; range: string; stats: PosterStats }): Promise<Blob | null> {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
  const g = c.getContext('2d'); if (!g) return Promise.resolve(null);
  g.fillStyle = '#183C32'; g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = '#2B5A4A'; g.beginPath(); g.arc(940, 160, 260, 0, Math.PI * 2); g.fill();
  const serif = "'Playfair Display', Georgia, serif", sans = "Inter, system-ui, sans-serif";
  g.fillStyle = '#D6A96B'; g.font = `700 34px ${sans}`; g.fillText('NutriSmart IQ', 80, 120);
  g.fillStyle = '#B9CFC5'; g.font = `600 30px ${sans}`; g.fillText(opts.range.toUpperCase(), 80, 190);
  g.fillStyle = '#F5F3ED'; g.font = `700 92px ${serif}`; g.fillText(`${opts.name}’s week`, 80, 420); g.fillText('on a plate', 80, 530);
  const items: [number, string][] = [[opts.stats.days, 'days logged'], [opts.stats.meals, 'meals logged'], [opts.stats.regions, 'regions explored']];
  items.forEach(([n, label], i) => {
    const y = 700 + i * 150;
    g.fillStyle = '#D7F27A'; g.font = `700 100px ${sans}`; g.fillText(String(n), 80, y);
    g.fillStyle = '#F5F3ED'; g.font = `500 40px ${sans}`; g.fillText(label, 260, y - 10);
  });
  g.fillStyle = '#B9CFC5'; g.font = `500 30px ${sans}`;
  g.fillText('Understand your food. Discover your patterns.', 80, 1230); g.fillText('Improve your nutrition.', 80, 1275);
  return new Promise(res => c.toBlob(b => res(b), 'image/png'));
}
