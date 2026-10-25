-- 018: remove junk "foods" that earlier AI searches may have saved (greetings and keyboard mash).
DELETE FROM public.master_foods
 WHERE source = 'ai_search'
   AND lower(trim(name)) IN ('hi','hii','hello','hey','yo','test','testing','ok','okay','yes','no','asdf','qwerty','abc','xyz','lol','thanks','bye','help','what','who','why','how','nothing','none','na','null','random','something');
DELETE FROM public.food_semantic_cache
 WHERE lower(trim(food_name)) IN ('hi','hii','hello','hey','yo','test','testing','ok','okay','yes','no','asdf','qwerty','abc','xyz','lol','thanks','bye','help','what','who','why','how','nothing','none','na','null','random','something');
