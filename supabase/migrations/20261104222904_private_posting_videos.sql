insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posting-videos', 'posting-videos', false, 1073741824, array['video/mp4', 'video/quicktime'])
on conflict (id) do nothing;

create policy "posting videos insert by owner"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'posting-videos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "posting videos read by owner"
on storage.objects for select to authenticated
using (
  bucket_id = 'posting-videos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "posting videos delete by owner"
on storage.objects for delete to authenticated
using (
  bucket_id = 'posting-videos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
