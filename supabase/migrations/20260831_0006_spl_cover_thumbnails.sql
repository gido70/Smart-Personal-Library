begin;

-- Private JPEG thumbnails live beside each owner's PDF. Existing
-- storage.objects RLS policies still restrict access to auth.uid().
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/epub+zip',
  'image/jpeg'
]
where id = 'spl-books';

do $$
declare
  mime_types text[];
begin
  select allowed_mime_types into mime_types
  from storage.buckets
  where id = 'spl-books';

  if mime_types is null or not ('image/jpeg' = any(mime_types)) then
    raise exception 'SPL_COVER_JPEG_MIME_NOT_ENABLED';
  end if;
end $$;

commit;
