export interface OsvVuln {
  id: string;
  summary: string;
  severity: 'critical' | 'warning' | 'info';
  fixedVersion?: string;
}

interface OsvBatchResponse {
  results: Array<{
    vulns?: Array<{
      id: string;
      summary?: string;
      database_specific?: { severity?: string };
      affected?: Array<{
        package?: { name?: string; ecosystem?: string };
        ranges?: Array<{
          type: string;
          events?: Array<{ introduced?: string; fixed?: string }>;
        }>;
      }>;
    }>;
  }>;
}

function mapSeverity(vuln: NonNullable<OsvBatchResponse['results'][0]['vulns']>[0]): OsvVuln['severity'] {
  const sev = vuln.database_specific?.severity?.toUpperCase() ?? '';
  if (sev === 'CRITICAL') return 'critical';
  if (sev === 'HIGH') return 'warning';
  if (sev === 'MODERATE' || sev === 'MEDIUM') return 'warning';
  return 'info';
}

function extractFixedVersion(vuln: NonNullable<OsvBatchResponse['results'][0]['vulns']>[0]): string | undefined {
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      if (range.type !== 'SEMVER') continue;
      for (const event of range.events ?? []) {
        if (event.fixed) return event.fixed;
      }
    }
  }
  return undefined;
}

export async function queryOsvBatch(
  packages: Array<{ name: string; version: string }>
): Promise<Map<string, OsvVuln[]>> {
  const result = new Map<string, OsvVuln[]>();
  if (!packages.length) return result;

  const queries = packages.map((p) => ({
    package: { name: p.name, ecosystem: 'npm' },
    version: p.version,
  }));

  const res = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries }),
  });

  if (!res.ok) {
    console.warn('[osv] querybatch failed:', res.status);
    return result;
  }

  const data = (await res.json()) as OsvBatchResponse;

  data.results.forEach((entry, i) => {
    const pkg = packages[i];
    const vulns: OsvVuln[] = [];

    for (const v of entry.vulns ?? []) {
      vulns.push({
        id: v.id,
        summary: v.summary ?? 'Known vulnerability',
        severity: mapSeverity(v),
        fixedVersion: extractFixedVersion(v),
      });
    }

    if (vulns.length) result.set(`${pkg.name}@${pkg.version}`, vulns);
  });

  return result;
}

export function parsePackageVersion(range: string): string {
  return range.replace(/^[\^~>=<]+/, '').split(' ')[0];
}
