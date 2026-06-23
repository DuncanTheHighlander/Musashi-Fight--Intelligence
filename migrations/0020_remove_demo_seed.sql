-- Migration number: 0020  2026-06-19
-- Production cleanup: remove the demo social-graph seed introduced in 0007 so a
-- real deployment ships with NO fake profiles, users, or content. Idempotent and
-- safe to re-run; only the known demo IDs are touched - real accounts are never
-- affected.

-- Child/related rows first (explicit, in case FK cascade is disabled on D1).
DELETE FROM messages WHERE id IN ('msg_1','msg_2','msg_3');
DELETE FROM analysis_responses WHERE id IN ('resp_1','resp_2');
DELETE FROM scouting_requests WHERE id IN ('scout_req_1','scout_req_2');

-- Any marketplace / review / coach-rank rows that ever attached to the demo users.
DELETE FROM reviews
  WHERE target_id IN ('user_fighter_1','user_coach_1','user_fighter_2','user_scout_1')
     OR reviewer_id IN ('user_fighter_1','user_coach_1','user_fighter_2','user_scout_1');
DELETE FROM content_products
  WHERE creator_id IN ('user_fighter_1','user_coach_1','user_fighter_2','user_scout_1');

-- Old opt-in marketplace seed products used fake celebrity-named creators and a
-- sample-creator-* id prefix. Remove any that were ever written to a real D1.
DELETE FROM content_products
  WHERE creator_id LIKE 'sample-creator-%'
     OR title IN (
       'Muay Thai Roundhouse Kick Mastery',
       'Brazilian Jiu-Jitsu Guard Passing Fundamentals',
       'Boxing Footwork & Angles Masterclass',
       'MMA Elbow Strikes Complete Guide',
       'Wrestling Double Leg Takedown System',
       'Combat Sports Conditioning Program'
     );
DELETE FROM analyst_profiles
  WHERE user_id IN ('user_fighter_1','user_coach_1','user_fighter_2','user_scout_1');
DELETE FROM coach_ranks
  WHERE user_id IN ('user_fighter_1','user_coach_1','user_fighter_2','user_scout_1');

-- The demo profiles and the demo accounts themselves.
DELETE FROM fighter_profiles
  WHERE user_id IN ('user_fighter_1','user_coach_1','user_fighter_2','user_scout_1');
DELETE FROM users
  WHERE id IN ('user_fighter_1','user_coach_1','user_fighter_2','user_scout_1');
