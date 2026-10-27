import React from 'react';

export interface ReviewItem { text: string; fact_ids: string[] }
export interface ReviewSections {
  headline: ReviewItem; wins: ReviewItem[]; challenges: ReviewItem[]; nutrition: ReviewItem[]; adherence: ReviewItem[];
  energy: ReviewItem[]; flexible_meals: ReviewItem[]; patterns: ReviewItem[]; next_week_focus: ReviewItem[]; coach_conversation: ReviewItem;
}
export interface ReviewFact { id: string; text: string }

const BLOCKS: Array<[keyof ReviewSections, string]> = [
  ['wins', 'What went well'], ['challenges', 'What was harder'], ['nutrition', 'Food'], ['adherence', 'Consistency'],
  ['energy', 'Energy'], ['flexible_meals', 'Flexible meals'], ['patterns', 'Patterns'], ['next_week_focus', 'Next week'],
];

export default function ReviewView({ sections, facts, showCoachLine }: { sections: ReviewSections; facts: ReviewFact[]; showCoachLine?: boolean }) {
  const byId = new Map(facts.map(f => [f.id, f.text]));
  const Evidence = ({ ids }: { ids: string[] }) => {
    const lines = ids.map(i => byId.get(i)).filter(Boolean) as string[];
    if (!lines.length) return null;
    return (
      <details className="mt-1">
        <summary className="text-[11px] text-[#8E8E93] cursor-pointer min-h-[24px]">Based on</summary>
        <ul className="text-[11px] text-[#8E8E93] list-disc pl-4">{lines.map(l => <li key={l}>{l}</li>)}</ul>
      </details>
    );
  };
  return (
    <div className="space-y-4">
      <div className="bg-[#1C1C1E] rounded-2xl p-4">
        <p className="text-base font-semibold">{sections.headline.text}</p>
        <Evidence ids={sections.headline.fact_ids} />
      </div>
      {BLOCKS.map(([key, title]) => {
        const items = sections[key] as ReviewItem[];
        if (!items?.length) return null;
        return (
          <section key={key} className="bg-[#1C1C1E] rounded-2xl p-4">
            <h3 className="text-xs uppercase tracking-wide text-[#8E8E93] mb-2">{title}</h3>
            <ul className="space-y-2">{items.map((it, i) => <li key={i} className="text-sm"><span>{it.text}</span><Evidence ids={it.fact_ids} /></li>)}</ul>
          </section>
        );
      })}
      {showCoachLine && sections.coach_conversation?.text && (
        <section className="bg-[#1C1C1E] rounded-2xl p-4">
          <h3 className="text-xs uppercase tracking-wide text-[#8E8E93] mb-2">Worth talking about</h3>
          <p className="text-sm">{sections.coach_conversation.text}</p>
          <Evidence ids={sections.coach_conversation.fact_ids} />
        </section>
      )}
    </div>
  );
}
