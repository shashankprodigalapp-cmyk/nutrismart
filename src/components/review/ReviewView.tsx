import React from 'react';
import '../../styles/today.css';
import '../../styles/weekly.css';

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
      <details className="nr-ev">
        <summary>Based on</summary>
        <ul>{lines.map(l => <li key={l}>{l}</li>)}</ul>
      </details>
    );
  };
  return (
    <div className="nr-flow">
      <div className="nr-lead">
        <p>{sections.headline.text}</p>
        <Evidence ids={sections.headline.fact_ids} />
      </div>
      {BLOCKS.map(([key, title]) => {
        const items = sections[key] as ReviewItem[];
        if (!items?.length) return null;
        return (
          <section key={key} className={'nr-sec' + (key === 'next_week_focus' ? ' nr-try' : '')}>
            <h3>{title}</h3>
            <ul>{items.map((it, i) => <li key={i}><span>{it.text}</span><Evidence ids={it.fact_ids} /></li>)}</ul>
          </section>
        );
      })}
      {showCoachLine && sections.coach_conversation?.text && (
        <section className="nr-sec">
          <h3>Worth talking about</h3>
          <p style={{ margin: 0, fontSize: 15, lineHeight: '22px' }}>{sections.coach_conversation.text}</p>
          <Evidence ids={sections.coach_conversation.fact_ids} />
        </section>
      )}
    </div>
  );
}
