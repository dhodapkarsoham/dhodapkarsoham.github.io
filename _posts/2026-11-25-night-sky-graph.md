---
layout: post
title: The night sky as a graph
tags: [Neo4j, Relate, Astronomy, Cypher]
description: "Stars, constellations and every confirmed exoplanet in one graph, queried live in your browser with Relate."
---

> **Work in progress.** The sky map and its live queries are ready to explore; the writing around them is still being drafted.

{% comment %}
TODO(intro): Why the sky is a graph: stars joined by stick figures, planets orbiting stars, discoveries tied to missions and methods. Mention that everything below runs in the browser.
{% endcomment %}

_Intro placeholder._

{% include sky-map.html %}

## The graph

{% comment %}
TODO: Walk through the model. Facts for reference:
     Nodes: Star (16,846), Planet (6,473), Constellation (88), Mission (73), Method (11).
     Relationships: (:Star)-[:IN]->(:Constellation), (:Star)-[:LINE_TO]->(:Star) for stick figures (743),
     (:Star)-[:NEAR {ly}]->(:Star) for stars within 100 ly that are <= 10 ly apart (11,688),
     (:Planet)-[:ORBITS]->(:Star), (:Planet)-[:FOUND_BY]->(:Mission), (:Planet)-[:DETECTED_VIA]->(:Method).
     Planet.features: normalized 5-d vector (radius, mass, period, equilibrium temperature, insolation).
{% endcomment %}

_Model placeholder._

The pipeline that builds the graph is on GitHub: [dhodapkarsoham/sky-graph](https://github.com/dhodapkarsoham/sky-graph).

## Query 1: a road trip to TRAPPIST-1

{% comment %}
TODO: Shortest route from the Sun to TRAPPIST-1 with jumps <= 6 ly.
     Result: no route; only 5 stars are reachable (Proxima Centauri, Rigil Kentaurus, Toliman, Barnard's Star, Ross 154).
     The smallest workable jump is 8.21 ly; at <= 8.5 ly the route is 19 jumps / 124.4 ly via Barnard's Star,
     Ross 154, Lacaille 8760, GJ 876 ... and detours out to ~56 ly. HYG misses many faint red dwarfs.
{% endcomment %}

_Query 1 placeholder._

```cypher
MATCH (sun:Star {name: 'Sun'}), (t:Star {name: 'TRAPPIST-1'})
MATCH p = SHORTEST 1 (sun)-[r:NEAR WHERE r.ly <= 6]-+(t)
RETURN [n IN nodes(p) | n.name] AS route
```

## Query 2: Earth-like planets you can point at

{% comment %}
TODO: Top 10 Earth-like planets whose host star is visible to the naked eye, with constellation.
     Result: tau Cet h and f (Cetus) lead, then HD 20794 e/d/f (82 Eridani). Similarity is euclidean distance
     on the feature vector, so it is a likeness score, not a habitability index.
{% endcomment %}

_Query 2 placeholder._

```cypher
MATCH (p:Planet)-[:ORBITS]->(s:Star {naked_eye: true})-[:IN]->(c:Constellation)
WHERE p.features IS NOT NULL
WITH p, s, c, vector.similarity.euclidean(p.features, $earth) AS similarity
RETURN p.name, s.name, c.name, similarity
ORDER BY similarity DESC LIMIT 10
```

## Query 3: where and how we found them

{% comment %}
TODO: Planet counts by constellation, and by discovery method per decade.
     Result: Cygnus 1,683 and Lyra 1,062 (Kepler field), Draco 319, Sagittarius 239 (microlensing toward the bulge).
     Transits dominate from the 2010s on (3,078 that decade).
{% endcomment %}

_Query 3 placeholder._

```cypher
MATCH (p:Planet)-[:ORBITS]->(:Star)-[:IN]->(c:Constellation)
RETURN c.name AS constellation, count(p) AS planets
ORDER BY planets DESC
```

```cypher
MATCH (p:Planet)-[:DETECTED_VIA]->(m:Method)
RETURN p.disc_decade AS decade, m.name AS method, count(p) AS planets
ORDER BY decade, planets DESC
```

## What's next

_Closing placeholder._

---

### Data and credits

- **Stars:** [HYG Database v4.4](https://codeberg.org/astronexus/hyg) by David Nash (astronexus), licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The graph data served with this post (`sky-graph.json`) adapts HYG and is shared under the same license.
- **Planets:** [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu), Planetary Systems Composite Parameters table ([doi:10.26133/NEA13](https://doi.org/10.26133/NEA13)), accessed November 25, 2026. This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program.
- **Constellation lines:** [d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn, BSD 3-Clause License.
- **Database:** [Relate](https://relatedb.ai) by Neo4j, compiled to WebAssembly, Apache 2.0. Full license notes are in [LICENSES.txt]({{ '/assets/sky-graph/LICENSES.txt' | relative_url }}).
