// Fetches EPA CyAN satellite cyanobacteria data for points across Lake
// Winnipesaukee and writes a small JSON file the static site reads.
// Run weekly via GitHub Actions (CyAN updates weekly, by COB Monday).
//
// CyAN public REST API: https://cyan.epa.gov/cyan/cyano/location/data/{lat}/{lng}/
// Returns weekly-max cyanobacteria cell concentration (cells/mL) from the
// Sentinel-3 OLCI satellite at 300m resolution.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Representative open-water sample points across the lake's major bays/areas.
// These cover popular spots that have NO shoreline bacteria monitoring,
// including the Braun's Bay / Moultonborough sandbar area.
// Each area lists candidate coordinates; the first that resolves to a CyAN
// satellite water cell (300m) is used. Narrow bays need points in their
// widest/deepest stretch to land on a resolvable cell.
const POINTS = [
  { area: 'The Broads (Center)', candidates: [[43.650, -71.300]] },
  { area: 'Alton Bay', candidates: [[43.515, -71.225], [43.525, -71.220], [43.505, -71.235], [43.490, -71.240]] },
  { area: 'Wolfeboro Bay', candidates: [[43.610, -71.215], [43.615, -71.225], [43.605, -71.235], [43.600, -71.220]] },
  { area: 'Meredith Bay', candidates: [[43.625, -71.500], [43.620, -71.490], [43.630, -71.485], [43.635, -71.505]] },
  { area: 'Center Harbor', candidates: [[43.705, -71.455], [43.700, -71.445], [43.695, -71.450]] },
  { area: 'Braun\u2019s Bay Sandbar (Moultonborough)', candidates: [[43.722, -71.378]] },
  { area: 'Harilla Landing (Long Island)', candidates: [[43.690, -71.315], [43.685, -71.310], [43.695, -71.305], [43.700, -71.318], [43.680, -71.320]] },
  { area: 'Paugus & Weirs Bay', candidates: [[43.590, -71.455], [43.600, -71.450], [43.620, -71.455]] },
  { area: '19 Mile Bay / Tuftonboro', candidates: [[43.678, -71.300]] },
];

const BASE = 'https://cyan.epa.gov/cyan/cyano/location/data';

async function fetchCandidate(lat, lng) {
  const url = `${BASE}/${lat}/${lng}/`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const outputs = Array.isArray(json.outputs) ? json.outputs : [];
  const latest = outputs
    .slice()
    .sort((a, b) => (b.imageDateLong || 0) - (a.imageDateLong || 0))[0];
  return { json, latest };
}

async function fetchPoint(p) {
  let lastErr = null;
  for (const [lat, lng] of p.candidates) {
    try {
      const { json, latest } = await fetchCandidate(lat, lng);
      if (latest && latest.cellConcentration != null) {
        return {
          area: p.area,
          lat,
          lng,
          locationName: json.metaInfo?.locationName || null,
          cellConcentration: latest.cellConcentration,
          maxCellConcentration: latest.maxCellConcentration ?? null,
          imageDate: latest.imageDate || null,
          imageDateLong: latest.imageDateLong || null,
          validCellsCount: latest.validCellsCount ?? null,
        };
      }
    } catch (err) {
      lastErr = err;
    }
  }
  const [lat, lng] = p.candidates[0];
  return {
    area: p.area, lat, lng,
    status: lastErr ? 'error' : 'no_data',
    error: lastErr ? String(lastErr) : undefined,
    cellConcentration: null, imageDate: null,
  };
}

async function main() {
  const results = [];
  for (const p of POINTS) {
    const r = await fetchPoint(p);
    results.push(r);
    console.log(`${r.area}: ${r.cellConcentration ?? 'n/a'} cells/mL (${r.imageDate ?? r.status ?? 'no data'})`);
  }

  const payload = {
    source: 'EPA CyAN (Sentinel-3 OLCI satellite, weekly max)',
    sourceUrl: 'https://www.epa.gov/water-research/cyanobacteria-assessment-network-cyan',
    note: 'Cell concentrations are satellite estimates of cyanobacteria, not direct water samples. Use as a lake-wide screening signal, not a substitute for posted advisories.',
    fetchedAt: new Date().toISOString(),
    points: results,
  };

  const outPath = fileURLToPath(new URL('../data/cyan.json', import.meta.url));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n');
  console.log(`\nWrote ${results.length} points to data/cyan.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
