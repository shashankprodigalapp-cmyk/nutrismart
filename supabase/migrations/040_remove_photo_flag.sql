-- NutriSmart 2.1 / P0: photo food search is removed from the product.
-- Additive and safe for 1.0: only removes the 2.0 switch that nothing reads any more.
-- Past photo logs and AI call history are kept (admin charts still show them as past use).
DELETE FROM public.feature_flags WHERE key = 'v2_photo';
