-- Apply separately AFTER approval, migration 008 and its dry-run review.
-- Re-execution replaces only the two named Draftroom jobs. No immediate purge.
begin;
do $$begin
 if to_regprocedure('public.maintain_statistics(boolean)') is null then
  raise exception 'Install migration 008 before scheduling maintenance';
 end if;
end $$;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('draftroom-statistics-maintenance','*/10 * * * *',
 'select public.maintain_statistics(false)');
select cron.schedule('draftroom-statistics-log-retention','43 3 * * *',
 $command$delete from cron.job_run_details where end_time < now()-interval '7 days'
 and jobid in (select jobid from cron.job where jobname in
 ('draftroom-statistics-maintenance','draftroom-statistics-log-retention'))$command$);
commit;
