// Runs Relate (WebAssembly) off the page thread. Loads the exported night-sky
// graph into an in-memory database, then answers the post's three queries.
import init, { RelateDb } from "./relate/relate.js";

let db = null;
let earth = null;

const BATCH = 2000;

function run(query, params) {
  const result = JSON.parse(db.execute(query, params ? JSON.stringify(params) : null));
  if (result.error) throw new Error(result.error);
  return result.rows;
}

function batched(query, rows) {
  for (let i = 0; i < rows.length; i += BATCH) run(query, { rows: rows.slice(i, i + BATCH) });
}

async function load(dataUrl) {
  const started = performance.now();
  const [, response] = await Promise.all([init(), fetch(dataUrl)]);
  if (!response.ok) throw new Error(`${dataUrl}: HTTP ${response.status}`);
  const data = await response.json();
  earth = data.earth;
  db = new RelateDb();

  for (const q of [
    "CREATE CONSTRAINT star_sid FOR (s:Star) REQUIRE s.sid IS UNIQUE",
    "CREATE CONSTRAINT planet_name FOR (p:Planet) REQUIRE p.name IS UNIQUE",
    "CREATE CONSTRAINT constellation_abbr FOR (c:Constellation) REQUIRE c.abbr IS UNIQUE",
  ]) run(q);

  batched("UNWIND $rows AS r CREATE (:Constellation {abbr: r[0], name: r[1]})", data.constellations);
  batched("UNWIND $rows AS r CREATE (:Method {name: r})", data.methods);
  batched("UNWIND $rows AS r CREATE (:Mission {name: r[0], locale: r[1]})", data.missions);

  const stars = data.stars.map((s, sid) => ({
    sid, name: s[0], ra_deg: s[1], dec_deg: s[2], mag: s[3], dist_ly: s[4],
    x_ly: s[5], y_ly: s[6], z_ly: s[7], con: s[8], spect: s[9],
    naked_eye: (s[10] & 1) > 0, neighborhood: (s[10] & 2) > 0, is_host: (s[10] & 4) > 0,
  }));
  batched("UNWIND $rows AS r CREATE (s:Star) SET s = r", stars);
  batched(
    `UNWIND $rows AS r
     MATCH (s:Star {sid: r.sid}), (c:Constellation {abbr: r.con})
     CREATE (s)-[:IN]->(c)`,
    stars.filter((s) => s.con).map(({ sid, con }) => ({ sid, con })),
  );

  const planets = data.planets.map((p) => ({
    name: p[0], sid: p[1], radius_earth: p[2], mass_earth: p[3], period_days: p[4],
    eq_temp_k: p[5], insolation: p[6], disc_year: p[7],
    disc_decade: p[7] == null ? null : Math.floor(p[7] / 10) * 10,
    method: p[8] == null ? null : data.methods[p[8]],
    facility: p[9] == null ? null : data.missions[p[9]][0],
    features: p[10],
  }));
  batched(
    `UNWIND $rows AS r
     MATCH (s:Star {sid: r.sid})
     CREATE (p:Planet {name: r.name, radius_earth: r.radius_earth, mass_earth: r.mass_earth,
                       period_days: r.period_days, eq_temp_k: r.eq_temp_k, insolation: r.insolation,
                       disc_year: r.disc_year, disc_decade: r.disc_decade, features: r.features})
     CREATE (p)-[:ORBITS]->(s)
     WITH p, r
     MATCH (m:Method {name: r.method})
     CREATE (p)-[:DETECTED_VIA]->(m)
     WITH p, r
     MATCH (f:Mission {name: r.facility})
     CREATE (p)-[:FOUND_BY]->(f)`,
    planets,
  );
  batched(
    `UNWIND $rows AS r
     MATCH (a:Star {sid: r[0]}), (b:Star {sid: r[1]})
     CREATE (a)-[:LINE_TO {con: r[2]}]->(b)`,
    data.lines,
  );
  batched(
    `UNWIND $rows AS r
     MATCH (a:Star {sid: r[0]}), (b:Star {sid: r[1]})
     CREATE (a)-[:NEAR {ly: r[2]}]->(b)`,
    data.near,
  );

  const counts = run(`
    MATCH (n) WITH labels(n)[0] AS label, count(*) AS n
    RETURN collect([label, n]) AS nodes`)[0].nodes;
  const rels = run("MATCH ()-[r]->() RETURN count(r) AS n")[0].n;
  return { nodes: Object.fromEntries(counts), relationships: rels, ms: Math.round(performance.now() - started) };
}

// ---------------------------------------------------------------- queries

const QUERIES = {
  route: `// Every NEAR hop no longer than $max light-years
MATCH (a:Star)-[r:NEAR]->(b:Star)
WHERE r.ly <= $max
RETURN a.sid AS a, b.sid AS b, r.ly AS ly`,
  earthlike: `MATCH (p:Planet)-[:ORBITS]->(s:Star {naked_eye: true})
      -[:IN]->(c:Constellation)
WHERE p.features IS NOT NULL
WITH p, s, c,
     vector.similarity.euclidean(p.features, $earth) AS similarity
RETURN p.name AS planet, s.sid AS sid, s.name AS host,
       s.mag AS mag, c.name AS constellation,
       round(similarity, 3) AS similarity
ORDER BY similarity DESC, planet
LIMIT 10`,
  byConstellation: `MATCH (p:Planet)-[:ORBITS]->(:Star)-[:IN]->(c:Constellation)
RETURN c.abbr AS abbr, c.name AS constellation, count(p) AS planets
ORDER BY planets DESC, constellation`,
  byMethodDecade: `MATCH (p:Planet)-[:DETECTED_VIA]->(m:Method)
RETURN p.disc_decade AS decade, m.name AS method, count(p) AS planets
ORDER BY decade, planets DESC`,
};

// Dijkstra over the hops the Cypher query returned. (Relate evaluates a
// per-hop predicate inside SHORTEST by enumerating paths, which is slow for
// long routes, so the graph search runs here on the filtered edges.)
function route(fromSid, toSid, max) {
  const rows = run(QUERIES.route, { max });
  const adj = new Map();
  const link = (a, b, ly) => (adj.get(a) || adj.set(a, []).get(a)).push([b, ly]);
  for (const { a, b, ly } of rows) { link(a, b, ly); link(b, a, ly); }

  const dist = new Map([[fromSid, 0]]);
  const prev = new Map();
  const done = new Set();
  const queue = [[0, fromSid]];
  while (queue.length) {
    queue.sort((x, y) => y[0] - x[0]); // small graphs: a sorted array is plenty
    const [d, u] = queue.pop();
    if (done.has(u)) continue;
    done.add(u);
    if (u === toSid) break;
    for (const [v, w] of adj.get(u) || []) {
      if (d + w < (dist.get(v) ?? Infinity)) {
        dist.set(v, d + w); prev.set(v, u); queue.push([d + w, v]);
      }
    }
  }
  const reachable = [...done].filter((s) => s !== fromSid);
  if (!dist.has(toSid)) return { found: false, reachable, edges: rows.length };
  const path = [toSid];
  while (path[path.length - 1] !== fromSid) path.push(prev.get(path[path.length - 1]));
  path.reverse();
  const hops = run(
    `UNWIND range(0, size($ids) - 2) AS i
     MATCH (a:Star {sid: $ids[i]})-[r:NEAR]-(b:Star {sid: $ids[i + 1]})
     RETURN a.name AS from, b.name AS to, r.ly AS ly, b.dist_ly AS fromSun
     ORDER BY i`,
    { ids: path },
  );
  return { found: true, path, hops, total: dist.get(toSid), reachable, edges: rows.length };
}

const handlers = {
  load: ({ dataUrl }) => load(dataUrl),
  queries: () => QUERIES,
  route: ({ from, to, max }) => {
    const ids = run("MATCH (s:Star) WHERE s.name IN [$from, $to] RETURN s.name AS name, s.sid AS sid", { from, to });
    const sid = Object.fromEntries(ids.map((r) => [r.name, r.sid]));
    return route(sid[from], sid[to], max);
  },
  earthlike: () => run(QUERIES.earthlike, { earth }),
  counts: () => ({ byConstellation: run(QUERIES.byConstellation), byMethodDecade: run(QUERIES.byMethodDecade) }),
};

self.onmessage = async ({ data: { id, type, args } }) => {
  try {
    const t = performance.now();
    const result = await handlers[type](args || {});
    self.postMessage({ id, ok: true, result, ms: Math.round(performance.now() - t) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
