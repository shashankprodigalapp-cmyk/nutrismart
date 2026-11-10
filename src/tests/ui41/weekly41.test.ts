import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
describe('Weekly review restyle', () => {
  const panel = read('src/components/review/WeeklyReviewPanel.tsx');
  const view = read('src/components/review/ReviewView.tsx');
  it('keeps every word and button the browser tests look for', () => {
    for (const t of ['Approve and share', 'Save and share', 'Reject', 'Edit', 'Refresh', 'Other sections stay as generated.', 'Edited and shared', 'Approved and shared', 'Headline', 'weekly_review_off']) expect(panel).toContain(t);
    for (const t of ['What went well', 'What was harder', 'Next week', 'Worth talking about', 'Based on']) expect(view).toContain(t);
    expect(panel).toContain('Last ${period}');
    expect(panel).toContain("coachApi<Resp>('/api/weekly-review', { client_id: clientId, period, week, refresh })");
    expect(panel).toContain("coachApi('/api/weekly-review-decision'");
  });
  it('has no old hard-coded dark colours left in the three files', () => {
    for (const f of [panel, view, read('src/pages/WeeklyReviewPage.tsx')]) expect(f).not.toMatch(/#1C1C1E|#242426|#111113|#C8F75E/);
  });
  it('the page shows the new header and still shows the self review', () => {
    const p = read('src/pages/WeeklyReviewPage.tsx');
    expect(p).toContain('Your week in food');
    expect(p).toContain('<WeeklyReviewPanel mode="self" />');
  });
  it('tap targets are 44px and nothing is hidden', () => {
    const css = read('src/styles/weekly.css');
    expect(css).toContain('.nr-pill { min-height: 44px');
    expect(css).toContain('.nr-btn { min-height: 48px');
    expect(css).not.toMatch(/display\s*:\s*none/);
  });
});
