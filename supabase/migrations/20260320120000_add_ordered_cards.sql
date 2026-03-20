-- Add ordered_cards column for Karina's team (debit cards)
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ordered_cards INTEGER DEFAULT 0;
