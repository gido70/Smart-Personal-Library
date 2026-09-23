-- Applied and verified on the existing SPL database.
-- Preserve archive metadata, paid assets, RLS, and the six-active-book rule.
ALTER TABLE public.spl_books DROP CONSTRAINT spl_books_file_size_check;
ALTER TABLE public.spl_books ADD CONSTRAINT spl_books_file_size_check CHECK (file_size > 0 AND file_size <= 157286400);
