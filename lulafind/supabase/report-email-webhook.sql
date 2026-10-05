-- Server-side report email wiring. A client report INSERT is durable even when
-- this best-effort email side effect is unavailable; the trigger never aborts
-- the original INSERT.
--
-- Prerequisites:
--   1. Deploy: npx supabase functions deploy send-report-email --no-verify-jwt
--   2. Set Edge Function secrets:
--        npx supabase secrets set RESEND_API_KEY=... \
--          MODERATION_EMAIL_TO=trust@example.com \
--          REPORT_WEBHOOK_SECRET='a-long-random-secret' \
--          APP_URL=https://your-app.example
--   3. Store the same REPORT_WEBHOOK_SECRET in Supabase Vault as `report_webhook_secret`.
--   4. Change the project ref in the URL below if this is not srwdtguxdjsjlkaydhet.
--
-- Resend is an example provider. Use a verified sender/domain before relying on
-- delivery to Gmail; the browser must never contain the provider API key.

create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'report_webhook_secret') then
    raise warning 'lula_report_email: create Vault secret report_webhook_secret before enabling delivery';
  end if;
end $$;

create or replace function public.lula_send_report_email()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  secret text;
begin
  if new.collection <> 'reports' then return new; end if;
  begin
    select decrypted_secret into secret
    from vault.decrypted_secrets
    where name = 'report_webhook_secret';
    if secret is null then
      raise warning 'lula_send_report_email: report_webhook_secret is missing; report saved but email not sent';
      return new;
    end if;
    perform net.http_post(
      url := 'https://srwdtguxdjsjlkaydhet.supabase.co/functions/v1/send-report-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || secret
      ),
      body := jsonb_build_object(
        'type', 'INSERT', 'schema', 'public', 'table', 'records', 'record', to_jsonb(new)
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'lula_send_report_email: email not queued - % (%)', sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

drop trigger if exists lula_report_email on public.records;
create trigger lula_report_email
after insert on public.records
for each row execute function public.lula_send_report_email();
revoke all on function public.lula_send_report_email() from public;

select 'report email trigger' as check,
  case when count(*) = 1 then 'installed' else 'MISSING' end as result
from pg_trigger where tgname = 'lula_report_email' and not tgisinternal;
