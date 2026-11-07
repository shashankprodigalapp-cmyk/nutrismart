/**
 * lessons.ts — short Kitchen Detective lessons. Plain, general, no medical claims, no numbers about the body.
 * IMPORTANT: these are DRAFTS. They stay hidden in the app until a qualified nutrition professional has reviewed
 * every one AND the switch 'ui_detective' is turned on. Do not turn that switch on before the review.
 */
export interface Lesson { id: string; title: string; body: string; }

export const LESSONS: Lesson[] = [
  { id: 'dal-rice', title: 'Dal and rice make a good pair', body: 'Eaten together, dal and rice give a wider mix of proteins than either one alone. A simple, familiar plate.' },
  { id: 'fermented', title: 'Why idli and dosa batter ferments', body: 'Overnight fermentation of rice and lentil batter makes it light and gives it a mild tang. It is a traditional kitchen technique.' },
  { id: 'greens-lemon', title: 'A squeeze of lemon on greens', body: 'Vitamin C, such as from lemon, helps the body take up iron from plant foods like spinach and methi.' },
  { id: 'whole-fruit', title: 'Whole fruit and fibre', body: 'A whole fruit keeps its fibre, which juice usually loses. Fibre helps you feel satisfied for longer.' },
  { id: 'protein-list', title: 'Everyday protein in an Indian kitchen', body: 'Dal, curd, paneer, eggs, chana, rajma, soya and milk all carry protein. Mixing a few through the day is easy.' },
  { id: 'sip-water', title: 'Water through the day', body: 'Small sips across the day are easier to keep up than a lot at once. Keep a glass or bottle where you can see it.' },
];
