-- LINE (and later WhatsApp) can deliver the same event twice (retries). The provider's event id
-- is stored on the message so a repeat is ignored.
alter table public.chat_messages add column external_id text;
create unique index chat_messages_external_uq on public.chat_messages(org_id, external_id)
  where external_id is not null;
