-- Migration 001: Create triad_game_users table for Triad Vaults game
-- Author: Antigravity AI
-- Description: Creates user authentication, profile progress, and online status tracking table.

CREATE TABLE IF NOT EXISTS triad_game_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    reset_code VARCHAR(10) DEFAULT NULL,
    max_level_reached INTEGER DEFAULT 1,
    total_puzzles_solved INTEGER DEFAULT 0,
    is_online BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for ultra-fast lookup on login & email reset
CREATE INDEX IF NOT EXISTS idx_triad_users_username ON triad_game_users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_triad_users_email ON triad_game_users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_triad_users_reset_code ON triad_game_users(reset_code) WHERE reset_code IS NOT NULL;

-- Trigger to auto-update updated_at timestamp on record changes
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
