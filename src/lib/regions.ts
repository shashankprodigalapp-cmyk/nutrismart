/**
 * regions.ts — Food Explorer: which regional kitchens a person has tried, worked out from the food names they logged.
 * Pure rules, no network. It celebrates trying new things. It never scores, ranks or says what to avoid.
 */
export interface Region { key: string; label: string; keywords: string[]; ideas: string[]; }

export const REGIONS: Region[] = [
  { key: 'south', label: 'South Indian', keywords: ['idli', 'dosa', 'sambar', 'sambhar', 'rasam', 'uttapam', 'uthappam', 'vada', 'upma', 'appam', 'avial', 'pongal', 'medu', 'curd rice', 'bisi bele'], ideas: ['idli with sambar', 'ragi dosa', 'lemon rice'] },
  { key: 'north', label: 'North Indian', keywords: ['paneer', 'roti', 'chapati', 'naan', 'paratha', 'rajma', 'dal makhani', 'kulcha', 'aloo gobi', 'bhindi', 'baingan'], ideas: ['rajma chawal', 'aloo gobi with roti', 'paneer bhurji'] },
  { key: 'punjabi', label: 'Punjabi', keywords: ['sarson', 'makki', 'lassi', 'chole', 'bhature', 'amritsari', 'kadhi pakora', 'butter chicken', 'dal tadka'], ideas: ['sarson da saag', 'chole', 'a glass of lassi'] },
  { key: 'gujarati', label: 'Gujarati', keywords: ['dhokla', 'thepla', 'khandvi', 'undhiyu', 'fafda', 'handvo', 'gujarati kadhi', 'muthia', 'khakhra'], ideas: ['dhokla', 'thepla with curd', 'khandvi'] },
  { key: 'maharashtrian', label: 'Maharashtrian', keywords: ['poha', 'misal', 'vada pav', 'pav bhaji', 'thalipeeth', 'sabudana', 'puran poli', 'bhakri', 'usal', 'zunka'], ideas: ['kanda poha', 'thalipeeth', 'usal'] },
  { key: 'bengali', label: 'Bengali', keywords: ['macher jhol', 'fish curry', 'sandesh', 'luchi', 'shorshe', 'begun', 'mishti doi', 'aloo posto', 'khichuri'], ideas: ['macher jhol', 'aloo posto', 'mishti doi'] },
  { key: 'rajasthani', label: 'Rajasthani', keywords: ['dal baati', 'baati', 'churma', 'gatte', 'ker sangri', 'bajra', 'laal maas', 'pyaaz kachori'], ideas: ['dal baati', 'bajra roti', 'gatte ki sabzi'] },
  { key: 'street', label: 'Street snacks', keywords: ['samosa', 'pakora', 'pakoda', 'bhel', 'pani puri', 'golgappa', 'chaat', 'kachori', 'dahi puri', 'sev puri'], ideas: ['bhel', 'dahi puri', 'a samosa'] },
];

export function regionsTried(foodNames: string[]): string[] {
  const names = foodNames.map(n => String(n ?? '').toLowerCase());
  return REGIONS.filter(r => names.some(n => r.keywords.some(k => n.includes(k)))).map(r => r.key);
}

export function explorerLine(tried: number): string {
  if (tried <= 0) return 'Try a dish from another regional kitchen and it will show up here.';
  if (tried >= REGIONS.length) return `You have tried all ${REGIONS.length} regional kitchens. Lovely variety.`;
  return `You have tried ${tried} of ${REGIONS.length} regional kitchens.`;
}

/** One gentle idea from a kitchen not tried yet. It is an invitation, never a task. */
export function nextIdea(triedKeys: string[]): { label: string; ideas: string[] } | null {
  const r = REGIONS.find(x => !triedKeys.includes(x.key));
  return r ? { label: r.label, ideas: r.ideas } : null;
}
