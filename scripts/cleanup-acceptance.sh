#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/docker.sh
qft_select_docker

apply=false
case "${1:-}" in
  "") ;;
  --apply) apply=true ;;
  *) echo "Usage: scripts/cleanup-acceptance.sh [--apply]" >&2; exit 2 ;;
esac

psql_qft() {
  qft_docker compose exec -T postgres \
    psql -U quarkfan -d quarkfan -v ON_ERROR_STOP=1 -P pager=off "$@"
}

preview() {
  psql_qft <<'SQL'
SELECT scope, rows FROM (
  SELECT 'ch.sources' scope, count(*) rows FROM ch.sources WHERE scope->>'tenantId'='acceptance'
  UNION ALL SELECT 'cr.packages', count(*) FROM cr.packages WHERE name LIKE 'acceptance-%' OR name LIKE 'app:acceptance-%'
  UNION ALL SELECT 'gov.approvals', count(*) FROM gov.approvals WHERE data->>'tenantId'='acceptance'
  UNION ALL SELECT 'gov.audit', count(*) FROM gov.audit WHERE tenant_id='acceptance'
  UNION ALL SELECT 'mg.messages', count(*) FROM mg.messages WHERE tenant_id='acceptance'
  UNION ALL SELECT 'mh.providers', count(*) FROM mh.providers WHERE name LIKE 'acceptance-%'
  UNION ALL SELECT 'res.items', count(*) FROM res.items WHERE tenant_id='acceptance'
  UNION ALL SELECT 'rt.executions', count(*) FROM rt.executions WHERE tenant_id='acceptance'
  UNION ALL SELECT 'sched.queue_jobs', count(*) FROM sched_queue.job
    WHERE (name='task-run' AND data#>>'{run,tenantId}'='acceptance')
       OR (name='history-backfill' AND (data->>'id')::uuid IN (SELECT id FROM sched.history_backfills WHERE tenant_id='acceptance'))
  UNION ALL SELECT 'sched.tasks', count(*) FROM sched.tasks WHERE tenant_id='acceptance'
) inventory ORDER BY scope;
SQL
}

if [[ "$apply" != true ]]; then
  echo "Acceptance data cleanup preview (no changes):"
  preview
  echo "Run scripts/cleanup-acceptance.sh --apply after taking a backup."
  exit 0
fi

acceptance_app_hashes="$(psql_qft -Atc "SELECT content_hash FROM cr.packages WHERE name LIKE 'app:acceptance-%' AND content_hash ~ '^[a-f0-9]{64}$'")"
acceptance_sessions="$(psql_qft -Atc "WITH acceptance_values AS (SELECT x.tenant_id tenant_id,x.bot_id bot_id,jsonb_path_query(e.data, '$.**.sessionKey') value FROM rt.events e JOIN rt.executions x ON x.id=e.execution_id WHERE x.tenant_id='acceptance' UNION ALL SELECT a.data->>'tenantId' tenant_id,a.data->>'requesterId' bot_id,jsonb_path_query(a.data, '$.**.sessionKey') value FROM gov.approvals a WHERE a.data->>'tenantId'='acceptance') SELECT DISTINCT tenant_id || chr(9) || bot_id || chr(9) || (value #>> '{}') FROM acceptance_values WHERE tenant_id='acceptance' AND bot_id IS NOT NULL AND value IS NOT NULL ORDER BY 1")"

while IFS=$'\t' read -r tenant_id bot_id session_key; do
  [[ -z "$tenant_id" || -z "$bot_id" || -z "$session_key" ]] && continue
  [[ "$tenant_id" == acceptance && "$bot_id" =~ ^acceptance[-a-zA-Z0-9._]*$ ]] || {
    echo "Unsafe acceptance browser identity" >&2
    exit 1
  }
  [[ "$session_key" =~ ^(acceptance|tool)-[0-9]+$|^acceptance-e2e$ ]] || {
    echo "Unsafe acceptance session key" >&2
    exit 1
  }
  qft_docker compose exec -T \
    -e QFT_ACCEPTANCE_TENANT_ID="$tenant_id" \
    -e QFT_ACCEPTANCE_BOT_ID="$bot_id" \
    -e QFT_ACCEPTANCE_SESSION_KEY="$session_key" \
    browser-worker node -e '
const key=process.env.QFT_ACCEPTANCE_SESSION_KEY;
const tenant=encodeURIComponent(process.env.QFT_ACCEPTANCE_TENANT_ID);
const bot=encodeURIComponent(process.env.QFT_ACCEPTANCE_BOT_ID);
fetch(`http://127.0.0.1:4110/v1/browser/sessions/${encodeURIComponent(key)}?tenantId=${tenant}&botId=${bot}`,{method:"DELETE",headers:{authorization:`Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`}}).then(async(response)=>{if(!response.ok)throw new Error(await response.text())}).catch((error)=>{console.error(error);process.exit(1)});
'
done <<< "$acceptance_sessions"

psql_qft <<'SQL'
BEGIN;

DELETE FROM sched_queue.job
WHERE (name='task-run' AND data#>>'{run,tenantId}'='acceptance')
   OR (name='history-backfill' AND (data->>'id')::uuid IN (SELECT id FROM sched.history_backfills WHERE tenant_id='acceptance'));
DELETE FROM sched.history_backfills WHERE tenant_id='acceptance';
DELETE FROM sched.tasks WHERE tenant_id='acceptance';

DELETE FROM rt.events
WHERE execution_id IN (SELECT id FROM rt.executions WHERE tenant_id='acceptance');
DELETE FROM rt.executions WHERE tenant_id='acceptance';
DELETE FROM rt.sessions WHERE tenant_id='acceptance';
DELETE FROM rt.bots WHERE tenant_id='acceptance';

DELETE FROM mg.deliveries
WHERE bot_id LIKE 'acceptance%'
   OR channel_account_id IN (SELECT id FROM mg.channel_accounts WHERE tenant_id='acceptance');
DELETE FROM mg.sink_events WHERE bot_id LIKE 'acceptance%';
DELETE FROM mg.messages WHERE tenant_id='acceptance';
DELETE FROM mg.logs WHERE bot_id LIKE 'acceptance%';
DELETE FROM mg.route_bindings WHERE bot_id LIKE 'acceptance%';
DELETE FROM mg.channel_accounts WHERE tenant_id='acceptance';
DELETE FROM mg.cursors
WHERE sink_id IN (SELECT id FROM mg.sinks WHERE name LIKE 'Acceptance Runtime %');
DELETE FROM mg.sinks WHERE name LIKE 'Acceptance Runtime %';

DELETE FROM ch.memories WHERE bot_id LIKE 'acceptance%';
DELETE FROM ch.generation_traces WHERE bot_id LIKE 'acceptance%';
DELETE FROM ch.sources WHERE scope->>'tenantId'='acceptance';

DELETE FROM mh.usage
WHERE provider_id IN (SELECT id FROM mh.providers WHERE name LIKE 'acceptance-%');
DELETE FROM mh.routing_policies WHERE name LIKE 'acceptance-%';
DELETE FROM mh.providers WHERE name LIKE 'acceptance-%';

DELETE FROM cr.diagnostics
WHERE capability_id LIKE '%.acceptance.%'
   OR capability_id LIKE 'app.acceptance-%'
   OR data->>'botId' LIKE 'acceptance%'
   OR binding_id IN (SELECT id FROM cr.bindings WHERE bot_id LIKE 'acceptance%');
DELETE FROM cr.bindings WHERE bot_id LIKE 'acceptance%';
DELETE FROM cr.packages
WHERE name LIKE 'acceptance-%' OR name LIKE 'app:acceptance-%';

DELETE FROM gov.approvals WHERE data->>'tenantId'='acceptance';
DELETE FROM gov.audit WHERE tenant_id='acceptance';
DELETE FROM res.media_jobs WHERE tenant_id='acceptance';
DELETE FROM res.cleanup_plans WHERE tenant_id='acceptance';
UPDATE res.items
SET data=jsonb_set(data, '{refs}', '0'::jsonb, true)
WHERE tenant_id='acceptance';

COMMIT;
SQL

qft_docker compose exec -T resource-center node -e '
const headers={authorization:`Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`,"content-type":"application/json"};
const request=async(path,init={})=>{const response=await fetch(`http://127.0.0.1:4107${path}`,{...init,headers});const body=await response.json();if(!response.ok)throw new Error(JSON.stringify(body));return body.data};
(async()=>{const plan=await request("/v1/cleanup/plans",{method:"POST",body:JSON.stringify({tenantId:"acceptance",olderThan:"9999-12-31T23:59:59.000Z",dryRun:false})});const result=await request(`/v1/cleanup/plans/${plan.id}/execute`,{method:"POST",body:"{}"});console.log(`Removed ${result.candidates.length} acceptance resource objects`);})().catch((error)=>{console.error(error);process.exit(1)});
'
psql_qft -c "DELETE FROM res.cleanup_plans WHERE tenant_id='acceptance'" >/dev/null

while IFS= read -r hash; do
  [[ -z "$hash" ]] && continue
  [[ "$hash" =~ ^[a-f0-9]{64}$ ]] || { echo "Unsafe app hash: $hash" >&2; exit 1; }
  qft_docker compose exec -T capability-registry \
    rm -rf -- "/var/lib/quarkfan/capability-packages/apps/$hash"
done <<< "$acceptance_app_hashes"

qft_docker compose exec -T runtime-center \
  rm -rf -- /var/lib/quarkfan/workspaces/acceptance

echo "Acceptance cleanup complete. Remaining acceptance rows:"
preview
