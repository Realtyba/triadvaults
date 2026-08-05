-- Migration 002: Add updated_at column to triad_game_users
ALTER TABLE triad_game_users 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- Re-create trigger safely
CREATE OR REPLACE FUNCTION update_triad_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_triad_users_updated_at ON triad_game_users;
CREATE TRIGGER trg_triad_users_updated_at
BEFORE UPDATE ON triad_game_users
FOR EACH ROW
EXECUTE FUNCTION update_triad_users_updated_at();
