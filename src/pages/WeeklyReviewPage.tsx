import React from 'react';
import { Link } from 'react-router-dom';
import WeeklyReviewPanel from '../components/review/WeeklyReviewPanel';
import { useLang } from '../lib/lang';
import { tr } from '../lib/copyHi';
import '../styles/today.css';
import '../styles/weekly.css';

export default function WeeklyReviewPage() {
  const lang = useLang();
  return (
    <div className="nr-page">
      <Link to="/app" className="nr-back">← {tr(lang, 'Back')}</Link>
      <header className="nr-top">
        <p className="nr-kicker">{tr(lang, 'Your weekly review')}</p>
        <h1 className="nr-title">{tr(lang, 'Your week in food')}</h1>
      </header>
      <WeeklyReviewPanel mode="self" />
    </div>
  );
}
