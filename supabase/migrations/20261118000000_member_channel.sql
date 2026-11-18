-- Which app to message a member on: WhatsApp or LINE.
--
-- preferred_channel is set by staff on the member page; null means automatic.
-- member_channel() is the one place the rule lives, so the follow-ups page today and
-- the WhatsApp / LINE bots later (roadmap step 9) pick the same channel.

alter table public.members
  add column preferred_channel text check (preferred_channel in ('whatsapp', 'line'));

comment on column public.members.preferred_channel is
  'whatsapp or line; null = automatic (see public.member_channel)';

-- Automatic rule:
--   1. the channel staff picked, if any
--   2. LINE for Thai speakers (most Thai players use LINE, not WhatsApp)
--   3. LINE if they have no phone or WhatsApp number but are linked on LINE
--   4. otherwise WhatsApp
-- Takes a members row, so PostgREST exposes it as a computed field: select=*,member_channel
create or replace function public.member_channel(m public.members)
returns text language sql stable security invoker set search_path = '' as $$
  select coalesce(
    m.preferred_channel,
    case
      when m.language = 'th' then 'line'
      when m.line_user_id is not null and coalesce(m.whatsapp, m.phone) is null then 'line'
      else 'whatsapp'
    end
  );
$$;

grant execute on function public.member_channel(public.members) to authenticated;
revoke execute on function public.member_channel(public.members) from anon, public;
