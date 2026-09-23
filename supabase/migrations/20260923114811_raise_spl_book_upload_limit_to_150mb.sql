-- Keep the private SPL book bucket aligned with the browser's single upload
-- rule: 150 MiB per PDF, with no page-count restriction.
update storage.buckets
set file_size_limit = 157286400
where id = 'spl-books';
