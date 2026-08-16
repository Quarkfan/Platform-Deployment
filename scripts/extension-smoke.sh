#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/docker.sh
qft_select_docker

qft_docker compose exec -T console node --input-type=module <<'NODE'
const centers = {
  mg: "http://message-gateway:4101",
  ch: "http://context-hub:4102",
  mh: "http://model-hub:4103",
  cr: "http://capability-registry:4104",
  scheduler: "http://scheduler-center:4106",
  resource: "http://resource-center:4107",
  governance: "http://governance-center:4108",
};

for (const [name, base] of Object.entries(centers)) {
  const response = await fetch(`${base}/v1/extensions`, {
    headers: {
      authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  if (!response.ok || body.ok !== true || !Array.isArray(body.data)) {
    throw new Error(`${name} extension inventory failed (${response.status})`);
  }
  for (const item of body.data) {
    if (
      !item.descriptor?.providerId ||
      !Number.isInteger(item.generation) ||
      !item.installedAt ||
      !item.updatedAt
    ) {
      throw new Error(`${name} returned an incomplete extension record`);
    }
  }
  const states = body.data.reduce((result, item) => {
    result[item.lifecycleState] = (result[item.lifecycleState] ?? 0) + 1;
    return result;
  }, {});
  console.log(
    name.padEnd(12),
    String(body.data.length).padStart(2),
    "providers",
    JSON.stringify(states),
  );
}
NODE

qft_docker compose exec -T postgres psql -U quarkfan -d quarkfan -Atc "
  SELECT 'ch', count(*) FROM ch.extension_states
  UNION ALL SELECT 'cr', count(*) FROM cr.extension_states
  UNION ALL SELECT 'gov', count(*) FROM gov.extension_states
  UNION ALL SELECT 'mg', count(*) FROM mg.extension_states
  UNION ALL SELECT 'mh', count(*) FROM mh.extension_states
  UNION ALL SELECT 'res', count(*) FROM res.extension_states
  UNION ALL SELECT 'sched', count(*) FROM sched.extension_states
  ORDER BY 1;
" >/dev/null

printf 'Extension control-plane smoke passed: API records are complete and all seven durable state tables are queryable.\n'

