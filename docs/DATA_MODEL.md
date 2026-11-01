# 2.1 data model (migrations 041 to 043; 040 removes the photo switch)
- personal_features: user_id, feature_key, window_days, value, baseline, delta, trend, sample_size, confidence, calculated_at.
- recommendations: rec_key, reason, evidence, confidence, action, expected_outcome, follow_up_at, status (new, accepted, dismissed), acted_at, metric, outcome.
- intel_reports: user_id, period (daily, weekly, monthly, learning), sections, period_start, period_end, based_on_days.
- notification_decisions: why chosen or blocked, kind, channel, delivered, opened, acted.
- intel_messages: sender_type (auto, coach, ai_draft), status (draft, sent), reason, linked recommendation, response.
- nudge_preferences: + smart_nudges, smart_kinds_off, channel. daily_checkins: + fullness (1 to 5), digestion.
- feature_flags: ten new rows, all off.
Every new table has row level security: owners read their own rows; only the server (service role) writes. Drafts are never readable by the person they are about.
