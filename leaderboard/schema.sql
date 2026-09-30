-- Purrfect Match 64 global leaderboard (Cloudflare D1)
-- Apply with: wrangler d1 execute purrfect-match-scores --remote --file schema.sql

CREATE TABLE IF NOT EXISTS players (
  player TEXT PRIMARY KEY,      -- random id made on the player's device
  name TEXT NOT NULL,           -- three-letter initials
  updated_at INTEGER NOT NULL
);

-- Each player's best verified score on each level. The seed and moves are
-- kept so any score can be replayed and checked again later.
CREATE TABLE IF NOT EXISTS best (
  player TEXT NOT NULL,
  level INTEGER NOT NULL,
  score INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  moves TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player, level)
);

CREATE INDEX IF NOT EXISTS best_by_level ON best (level, score DESC, created_at);

-- Running totals per player, so the overall board reads ~10 rows instead of
-- adding up every score on every request. Kept in step by each new best.
CREATE TABLE IF NOT EXISTS totals (
  player TEXT PRIMARY KEY,
  total INTEGER NOT NULL,
  levels INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  last INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS totals_rank ON totals (total DESC, last);

-- Board tickets that have been posted. Each ticket is good for one game.
CREATE TABLE IF NOT EXISTS used_seeds (
  sig TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  level INTEGER NOT NULL,
  moves TEXT NOT NULL,           -- fingerprint of the moves, to spot retries
  at INTEGER NOT NULL
);

-- Board tickets handed out per network per day (see overDailyBudget).
CREATE TABLE IF NOT EXISTS ticket_budget (
  key TEXT NOT NULL,
  day INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, day)
);

-- Safe to re-run: rebuilds totals from any existing best scores.
INSERT OR REPLACE INTO totals (player, total, levels, stars, last)
  SELECT player, SUM(score), COUNT(*), SUM(stars), MAX(created_at) FROM best GROUP BY player;
