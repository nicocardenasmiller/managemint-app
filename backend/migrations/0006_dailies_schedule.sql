-- Dailies schedules and pauses.
-- days: which weekdays a daily is due, Mon..Sun as 7 characters of 0/1 ("1010100" = Mon, Wed, Fri).
-- per_week: when set (1-6), the daily is "N times a week, any day" and `days` is ignored.
-- color: one of the theme accent names (design/accents.css), or null to follow the theme colour.
-- pauses: JSON list of [from, to] local dates; `to` is null while paused. Paused days don't count against a streak.
ALTER TABLE dailies ADD COLUMN days TEXT NOT NULL DEFAULT '1111111';
ALTER TABLE dailies ADD COLUMN per_week INTEGER;
ALTER TABLE dailies ADD COLUMN pauses TEXT NOT NULL DEFAULT '[]';
ALTER TABLE dailies ADD COLUMN color TEXT;
