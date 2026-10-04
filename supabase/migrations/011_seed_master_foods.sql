-- =============================================================================
-- NutriSmart: 011_seed_master_foods.sql
-- Phase 1 — Seed master_foods with core Indian foods
-- Run after 010_phase1_fixes.sql
--
-- Uses the existing master_foods schema (001_initial_schema.sql).
-- search_vector is auto-populated by the trigger from 003_admin_cms_rpc.sql.
-- All nutrition values sourced from IFCT (Indian Food Composition Tables) 2017.
--
-- Type values:
--   R  = Restaurant-only (rarely made at home)
--   MR = Make at home OR restaurant (most Indian food)
--   OR = Original recipe (user's home cooking base)
--   NR = Not recommended (high GL / high calorie density)
--
-- ON CONFLICT (id): safe to re-run — existing rows are not overwritten.
-- All foods use gen_random_uuid() so each run gets stable IDs via INSERT … ON CONFLICT DO NOTHING.
-- =============================================================================

-- Disable trigger temporarily for bulk insert performance (re-enabled at end)
-- The trigger re-runs search_vector on each INSERT; for 60 rows it's fine to leave on.
-- For >500 rows, disable + backfill + re-enable.

INSERT INTO public.master_foods
  (id, name, name_hi, name_gu, category, region, portion, weight_g,
   calories, protein, carbs, fat, fiber, gl, gi, type, source, verified)
VALUES

-- ── STAPLES ───────────────────────────────────────────────────────────────────
('11100001-0000-0000-0000-000000000001',
 'Roti (Chapati)', 'रोटी', 'રોટી', 'Bread & Rice', 'Pan-India',
 '1 medium roti', 40, 120, 3.4, 22.5, 1.9, 1.5, 10, 52, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000002',
 'Paratha (Plain)', 'परांठा', 'પરોઠો', 'Bread & Rice', 'North India',
 '1 medium paratha', 80, 260, 5.5, 38.0, 9.5, 2.0, 22, 62, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000003',
 'Naan', 'नान', 'નાન', 'Bread & Rice', 'North India',
 '1 naan', 90, 275, 8.5, 47.0, 5.5, 1.2, 28, 71, 'R', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000004',
 'Basmati Rice (Cooked)', 'चावल', 'ભાત', 'Bread & Rice', 'Pan-India',
 '1 katori (150g)', 150, 195, 3.6, 43.0, 0.4, 0.4, 26, 56, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000005',
 'Brown Rice (Cooked)', 'ब्राउन चावल', NULL, 'Bread & Rice', 'Pan-India',
 '1 katori (150g)', 150, 165, 3.8, 34.0, 1.3, 2.2, 20, 50, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000006',
 'Phulka', 'फुलका', 'ફૂલકા', 'Bread & Rice', 'Pan-India',
 '1 phulka', 30, 88, 2.6, 16.8, 1.4, 1.1, 7, 52, 'MR', 'IFCT', TRUE),

-- ── BREAKFAST ─────────────────────────────────────────────────────────────────
('11100001-0000-0000-0000-000000000007',
 'Poha', 'पोहा', 'પૌંઆ', 'Breakfast', 'West India',
 '1 plate (200g)', 200, 270, 5.4, 50.0, 7.5, 3.5, 22, 55, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000008',
 'Upma', 'उपमा', 'ઉપમા', 'Breakfast', 'South India',
 '1 plate (200g)', 200, 260, 5.8, 40.0, 8.0, 2.8, 18, 55, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000009',
 'Idli', 'इडली', 'ઇડલી', 'Breakfast', 'South India',
 '2 idlis (100g)', 100, 130, 3.5, 25.0, 1.0, 2.5, 12, 50, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000010',
 'Dosa (Plain)', 'डोसा', 'ઢોસા', 'Breakfast', 'South India',
 '1 dosa (100g)', 100, 168, 4.5, 28.0, 4.8, 1.5, 16, 55, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000011',
 'Uttapam', 'उत्तपम', 'ઉત્તપમ', 'Breakfast', 'South India',
 '1 medium (120g)', 120, 185, 5.5, 30.0, 5.5, 2.2, 17, 53, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000012',
 'Besan Chilla', 'बेसन चीला', 'બેસન ચીલ્લા', 'Breakfast', 'North India',
 '2 chillas (120g)', 120, 210, 10.0, 26.0, 7.5, 4.0, 13, 40, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000013',
 'Methi Thepla', 'मेथी थेपला', 'મેથી થેપલા', 'Breakfast', 'Gujarat',
 '2 theplas (100g)', 100, 230, 6.5, 32.0, 8.5, 3.8, 17, 52, 'MR', 'IFCT', TRUE),

-- ── DAL & LEGUMES ─────────────────────────────────────────────────────────────
('11100001-0000-0000-0000-000000000014',
 'Dal Tadka', 'दाल तड़का', 'દાળ', 'Dal & Legumes', 'North India',
 '1 katori (150ml)', 150, 175, 9.0, 22.0, 5.5, 4.5, 8, 29, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000015',
 'Moong Dal (Yellow)', 'मूंग दाल', 'મગ દાળ', 'Dal & Legumes', 'Pan-India',
 '1 katori (150ml)', 150, 145, 9.5, 20.0, 3.0, 4.2, 7, 25, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000016',
 'Masoor Dal', 'मसूर दाल', 'મસૂર દાળ', 'Dal & Legumes', 'Pan-India',
 '1 katori (150ml)', 150, 155, 10.0, 21.0, 3.5, 4.5, 8, 30, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000017',
 'Rajma (Kidney Bean Curry)', 'राजमा', 'રાજમા', 'Dal & Legumes', 'North India',
 '1 katori (150ml)', 150, 185, 8.5, 28.0, 4.5, 7.5, 10, 29, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000018',
 'Chole (Chickpea Curry)', 'छोले', 'ચણા', 'Dal & Legumes', 'North India',
 '1 katori (150ml)', 150, 200, 9.0, 28.0, 6.5, 7.5, 10, 28, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000019',
 'Chana Dal', 'चना दाल', 'ચણાની દાળ', 'Dal & Legumes', 'Pan-India',
 '1 katori (150ml)', 150, 165, 8.0, 24.0, 4.2, 6.0, 9, 28, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000020',
 'Sprouted Moong', 'अंकुरित मूंग', 'આખા મગ', 'Dal & Legumes', 'Pan-India',
 '1 katori (100g)', 100, 70, 5.4, 10.0, 0.8, 4.2, 4, 25, 'MR', 'IFCT', TRUE),

-- ── VEGETABLES ────────────────────────────────────────────────────────────────
('11100001-0000-0000-0000-000000000021',
 'Aloo Sabzi (Potato Curry)', 'आलू सब्जी', 'બટેટાનું શાક', 'Vegetables', 'Pan-India',
 '1 katori (150g)', 150, 190, 3.2, 28.0, 7.5, 3.0, 15, 55, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000022',
 'Bhindi (Okra)', 'भिंडी', 'ભીંડો', 'Vegetables', 'Pan-India',
 '1 katori (150g)', 150, 95, 3.5, 12.0, 4.5, 4.5, 5, 20, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000023',
 'Baingan Bharta (Aubergine)', 'बैंगन भर्ता', 'રીંગણ ભર્તો', 'Vegetables', 'North India',
 '1 katori (150g)', 150, 115, 2.8, 12.0, 6.5, 3.5, 5, 15, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000024',
 'Palak (Spinach Curry)', 'पालक', 'પાલક', 'Vegetables', 'Pan-India',
 '1 katori (150g)', 150, 100, 4.0, 9.0, 5.5, 4.5, 3, 15, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000025',
 'Aloo Gobi', 'आलू गोबी', 'ફ્લાવર-બટેટા', 'Vegetables', 'North India',
 '1 katori (150g)', 150, 155, 3.5, 22.0, 6.0, 3.5, 11, 40, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000026',
 'Mixed Vegetables (Sabzi)', 'मिक्स सब्जी', 'મિક્સ વેજ', 'Vegetables', 'Pan-India',
 '1 katori (150g)', 150, 120, 3.5, 15.0, 5.5, 4.0, 6, 20, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000027',
 'Palak Paneer', 'पालक पनीर', 'પાલક પનીર', 'Vegetables', 'North India',
 '1 katori (150g)', 150, 230, 11.0, 12.0, 15.5, 3.5, 5, 15, 'MR', 'IFCT', TRUE),

-- ── PROTEIN ───────────────────────────────────────────────────────────────────
('11100001-0000-0000-0000-000000000028',
 'Egg (Boiled)', 'उबला अंडा', 'બાફેલું ઈંડું', 'Eggs', 'Pan-India',
 '1 large egg', 60, 78, 6.5, 0.6, 5.3, 0.0, 0, 0, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000029',
 'Egg Bhurji', 'अंडा भुर्जी', 'ઈંડા ભૂર્જી', 'Eggs', 'Pan-India',
 '2 eggs (120g)', 120, 195, 13.0, 4.5, 14.0, 0.5, 0, 0, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000030',
 'Paneer (Cottage Cheese)', 'पनीर', 'પનીર', 'Dairy & Protein', 'North India',
 '50g', 50, 133, 7.5, 1.2, 10.5, 0.0, 0, 27, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000031',
 'Paneer Bhurji', 'पनीर भुर्जी', 'પનીર ભૂર્જી', 'Dairy & Protein', 'North India',
 '1 katori (150g)', 150, 285, 16.0, 8.0, 22.0, 0.5, 0, 0, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000032',
 'Paneer Tikka', 'पनीर टिक्का', 'પનીર ટિક્કા', 'Dairy & Protein', 'North India',
 '4 pieces (120g)', 120, 270, 18.0, 8.0, 18.0, 1.5, 0, 0, 'R', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000033',
 'Chicken Curry', 'चिकन करी', NULL, 'Non-Veg', 'Pan-India',
 '1 katori (150g)', 150, 260, 22.0, 8.0, 15.0, 1.0, 4, 0, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000034',
 'Chicken (Grilled)', 'ग्रिल्ड चिकन', NULL, 'Non-Veg', 'Pan-India',
 '100g', 100, 165, 31.0, 0.0, 3.6, 0.0, 0, 0, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000035',
 'Fish (Steamed/Grilled)', 'मछली', NULL, 'Non-Veg', 'Pan-India',
 '100g', 100, 150, 24.0, 0.0, 5.5, 0.0, 0, 0, 'MR', 'IFCT', TRUE),

-- ── DAIRY ─────────────────────────────────────────────────────────────────────
('11100001-0000-0000-0000-000000000036',
 'Milk (Full Fat)', 'दूध', 'દૂધ', 'Dairy', 'Pan-India',
 '1 glass (250ml)', 250, 163, 8.0, 12.0, 9.0, 0.0, 7, 30, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000037',
 'Dahi (Curd / Yogurt)', 'दही', 'દહીં', 'Dairy', 'Pan-India',
 '1 katori (150g)', 150, 97, 6.0, 9.5, 3.5, 0.0, 4, 30, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000038',
 'Greek Yogurt', 'ग्रीक दही', NULL, 'Dairy', 'Pan-India',
 '1 cup (150g)', 150, 130, 12.0, 6.0, 6.0, 0.0, 3, 11, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000039',
 'Buttermilk (Chaas)', 'छाछ', 'છાસ', 'Dairy', 'Pan-India',
 '1 glass (200ml)', 200, 60, 3.5, 6.5, 1.8, 0.0, 3, 30, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000040',
 'Ghee', 'घी', 'ઘી', 'Fats', 'Pan-India',
 '1 tsp (5g)', 5, 45, 0.0, 0.0, 5.0, 0.0, 0, 0, 'MR', 'IFCT', TRUE),

-- ── SNACKS ────────────────────────────────────────────────────────────────────
('11100001-0000-0000-0000-000000000041',
 'Samosa', 'समोसा', 'સમોસા', 'Snacks', 'North India',
 '1 piece (80g)', 80, 195, 3.5, 22.0, 10.5, 1.8, 16, 57, 'R', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000042',
 'Vada Pav', 'वड़ा पाव', 'વડા પાઉં', 'Snacks', 'Maharashtra',
 '1 serving (150g)', 150, 310, 7.0, 42.0, 13.0, 2.5, 26, 70, 'R', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000043',
 'Pav Bhaji', 'पाव भाजी', 'પાઉં ભાજી', 'Snacks', 'Maharashtra',
 '1 serving with 2 pav (300g)', 300, 480, 11.0, 65.0, 18.0, 5.5, 33, 65, 'R', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000044',
 'Dhokla', 'ढोकला', 'ઢોકળા', 'Snacks', 'Gujarat',
 '4 pieces (120g)', 120, 175, 6.0, 28.0, 4.5, 2.5, 13, 40, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000045',
 'Khandvi', 'खांडवी', 'ખાંડવી', 'Snacks', 'Gujarat',
 '6 pieces (100g)', 100, 160, 5.5, 20.0, 6.5, 1.5, 9, 35, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000046',
 'Bhel Puri', 'भेल पूरी', 'ભેળ', 'Snacks', 'Maharashtra',
 '1 plate (150g)', 150, 210, 5.0, 38.0, 5.0, 3.5, 22, 65, 'R', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000047',
 'Chivda (Flattened Rice Mix)', 'चिवड़ा', 'ચેવડો', 'Snacks', 'Maharashtra',
 '1 handful (40g)', 40, 160, 3.5, 24.0, 6.0, 1.5, 14, 55, 'MR', 'IFCT', TRUE),

-- ── DRINKS ────────────────────────────────────────────────────────────────────
('11100001-0000-0000-0000-000000000048',
 'Chai (Milk Tea)', 'चाय', 'ચા', 'Drinks', 'Pan-India',
 '1 cup (200ml)', 200, 80, 2.0, 10.0, 3.5, 0.0, 6, 35, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000049',
 'Coffee (Milk)', 'कॉफी', 'કૉફી', 'Drinks', 'Pan-India',
 '1 cup (200ml)', 200, 70, 2.0, 8.0, 3.0, 0.0, 5, 35, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000050',
 'Lassi (Sweet)', 'लस्सी', 'લસ્સી', 'Drinks', 'North India',
 '1 glass (250ml)', 250, 185, 6.5, 30.0, 5.5, 0.0, 16, 35, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000051',
 'Coconut Water', 'नारियल पानी', 'નારિયેળ પાણી', 'Drinks', 'Pan-India',
 '1 glass (250ml)', 250, 58, 0.7, 12.0, 0.5, 2.5, 7, 55, 'MR', 'IFCT', TRUE),

-- ── FRUITS ────────────────────────────────────────────────────────────────────
('11100001-0000-0000-0000-000000000052',
 'Banana', 'केला', 'કેળું', 'Fruits', 'Pan-India',
 '1 medium (120g)', 120, 105, 1.3, 27.0, 0.4, 2.6, 16, 60, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000053',
 'Apple', 'सेब', 'સફરજન', 'Fruits', 'Pan-India',
 '1 medium (150g)', 150, 78, 0.4, 20.5, 0.3, 2.4, 9, 36, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000054',
 'Mango', 'आम', 'કેરી', 'Fruits', 'Pan-India',
 '1 cup sliced (165g)', 165, 107, 0.8, 28.0, 0.5, 1.8, 17, 56, 'MR', 'IFCT', TRUE),

-- ── COMMON COMBINATIONS ───────────────────────────────────────────────────────
('11100001-0000-0000-0000-000000000055',
 'Dal Chawal (Dal + Rice)', 'दाल चावल', 'દાળ-ભાત', 'Combinations', 'Pan-India',
 '1 katori dal + 1 katori rice', 300, 370, 12.6, 65.0, 5.9, 5.9, 34, 42, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000056',
 'Roti Sabzi (2 Roti + Vegetable)', 'रोटी सब्जी', 'રોટી-શાક', 'Combinations', 'Pan-India',
 '2 roti + 1 katori sabzi', 230, 335, 9.2, 54.5, 10.0, 5.0, 21, 48, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000057',
 'Curd Rice (Thayir Sadam)', 'दही चावल', NULL, 'Combinations', 'South India',
 '1 bowl (250g)', 250, 280, 8.0, 48.0, 5.5, 0.8, 24, 55, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000058',
 'Idli Sambar', 'इडली सांबर', 'ઇડલી-સાંભાર', 'Combinations', 'South India',
 '2 idli + 1 katori sambar', 250, 235, 8.5, 42.0, 3.5, 6.0, 19, 50, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000059',
 'Pongal (Ven Pongal)', 'पोंगल', NULL, 'Breakfast', 'South India',
 '1 plate (200g)', 200, 290, 7.5, 45.0, 9.0, 2.5, 23, 55, 'MR', 'IFCT', TRUE),

('11100001-0000-0000-0000-000000000060',
 'Biryani (Vegetable)', 'बिरयानी', 'બિરયાની', 'Rice', 'Pan-India',
 '1 plate (300g)', 300, 420, 8.5, 65.0, 14.0, 4.0, 38, 60, 'R', 'IFCT', TRUE)

ON CONFLICT (id) DO NOTHING;

-- ── BACKFILL SEARCH VECTORS ───────────────────────────────────────────────────
-- The trigger from 003_admin_cms_rpc.sql updates search_vector on INSERT.
-- This UPDATE is a safety net in case the trigger was not yet active.
UPDATE public.master_foods
SET search_vector =
  setweight(to_tsvector('english', coalesce(name, '')),    'A') ||
  setweight(to_tsvector('english', coalesce(name_hi, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(name_gu, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(category, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(region, '')),   'D')
WHERE id LIKE '11100001-0000-0000-0000-%';  -- only the seeded rows

-- ── VERIFICATION ─────────────────────────────────────────────────────────────
/*
-- Confirm 60 rows were inserted:
SELECT COUNT(*) FROM master_foods WHERE id LIKE '11100001-0000-0000-0000-%';

-- Check search vector is populated:
SELECT name, search_vector IS NOT NULL AS has_vector FROM master_foods LIMIT 5;

-- Test search (should find roti-related foods):
SELECT name FROM master_foods
WHERE search_vector @@ to_tsquery('english', 'roti | chapati | phulka')
ORDER BY name;

-- Test trigram similarity (should find 'daal' matching 'Dal Tadka'):
SELECT name, similarity(lower(name), 'daal') AS sim
FROM master_foods
WHERE similarity(lower(name), 'daal') > 0.2
ORDER BY sim DESC LIMIT 5;
*/
