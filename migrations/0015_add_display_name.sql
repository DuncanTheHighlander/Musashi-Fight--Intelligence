-- Migration number: 0015
-- Add display_name column to musashi_users (collected at signup but never stored)

ALTER TABLE musashi_users ADD COLUMN display_name TEXT;
