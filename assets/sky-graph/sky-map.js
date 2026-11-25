// Interactive sky map for "The night sky as a graph".
// Draws the sky from the exported graph straight away; the live queries run
// in a Relate (WebAssembly) database inside sky-worker.js.

const SQRT2 = Math.SQRT2;
const RAD = Math.PI / 180;

const COLORS = {
  sky: "#0b0f1a",
  grid: "rgba(255,255,255,0.06)",
  rim: "rgba(255,255,255,0.18)",
  star: "255,255,255",
  line: "rgba(150,170,210,0.38)",
  lineHot: "rgba(255,215,140,0.85)",
  host: "#6cc3ff",
  route: "#ffb454",
  pick: "#ff7a90",
  label: "rgba(220,228,245,0.85)",
};

// Hammer–Aitoff, equatorial: RA 0h at the center, increasing to the left as on a star chart.
function project(raDeg, decDeg) {
  let lon = raDeg > 180 ? raDeg - 360 : raDeg;
  const l = -lon * RAD;
  const p = decDeg * RAD;
  const z = Math.sqrt(1 + Math.cos(p) * Math.cos(l / 2));
  return [(2 * SQRT2 * Math.cos(p) * Math.sin(l / 2)) / z, (SQRT2 * Math.sin(p)) / z];
}

function fmt(x, digits = 1) {
  return x == null ? "—" : Number(x).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

class Relate {
  constructor(url) {
    this.worker = new Worker(url, { type: "module" });
    this.pending = new Map();
    this.next = 0;
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      this.pending.delete(data.id);
      data.ok ? p.resolve(data) : p.reject(new Error(data.error));
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      for (const p of this.pending.values()) p.reject(new Error(e.message || "worker failed"));
      this.pending.clear();
    };
  }
  call(type, args) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, args });
    });
  }
}

class SkyMap {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector("canvas");
    this.tooltip = root.querySelector(".sky-tooltip");
    this.status = root.querySelector(".sky-status");
    this.showHosts = root.querySelector('[data-toggle="hosts"]');
    this.showLines = root.querySelector('[data-toggle="lines"]');
    this.highlight = { route: null, picks: null, con: null };
    this.hover = null;
  }

  async start() {
    this.setStatus("Loading star data…");
    const res = await fetch(this.root.dataset.src);
    if (!res.ok) throw new Error(`star data: HTTP ${res.status}`);
    this.data = await res.json();
    this.prepare();
    this.bind();
    this.resize();
    this.setStatus("Starting Relate in your browser…");
    this.startRelate();
  }

  prepare() {
    const d = this.data;
    this.stars = d.stars.map((s, sid) => {
      const [x, y] = project(s[1], s[2]);
      return { sid, name: s[0], ra: s[1], dec: s[2], mag: s[3], dist: s[4], con: s[8], spect: s[9],
               eye: (s[10] & 1) > 0, host: (s[10] & 4) > 0, x, y, planets: 0 };
    });
    for (const p of d.planets) this.stars[p[1]].planets++;
    this.conName = Object.fromEntries(d.constellations);
    this.byName = new Map(this.stars.map((s) => [s.name, s]));
    // Label each constellation at the mean of its stick-figure stars.
    const acc = {};
    for (const [a, b, con] of d.lines) {
      for (const s of [this.stars[a], this.stars[b]]) {
        const v = (acc[con] ||= { x: 0, y: 0, n: 0 });
        v.x += s.x; v.y += s.y; v.n++;
      }
    }
    this.labels = Object.entries(acc).map(([con, v]) => ({ con, x: v.x / v.n, y: v.y / v.n }));
  }

  bind() {
    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);
    for (const t of [this.showHosts, this.showLines]) t.addEventListener("change", () => this.draw());
    const pick = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.hover = this.nearest(e.clientX - r.left, e.clientY - r.top);
      this.drawTooltip();
      this.draw();
    };
    this.canvas.addEventListener("pointermove", pick);
    this.canvas.addEventListener("pointerdown", pick);
    this.canvas.addEventListener("pointerleave", () => { this.hover = null; this.drawTooltip(); this.draw(); });
  }

  resize() {
    const w = this.canvas.parentElement.clientWidth;
    const h = Math.round(w / 2);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.height = `${h}px`;
    this.w = w; this.h = h; this.dpr = dpr;
    this.scale = (w / 2 - 6) / (2 * SQRT2);
    for (const s of this.stars) { s.px = w / 2 + s.x * this.scale; s.py = h / 2 - s.y * this.scale; }
    for (const l of this.labels) { l.px = w / 2 + l.x * this.scale; l.py = h / 2 - l.y * this.scale; }
    this.draw();
  }

  visible(s) {
    if (s.dist === 0) return false; // the Sun
    return s.eye || (this.showHosts.checked && s.host) || this.isHighlighted(s);
  }

  isHighlighted(s) {
    const h = this.highlight;
    return (h.route && h.route.has(s.sid)) || (h.picks && h.picks.has(s.sid));
  }

  nearest(x, y) {
    let best = null, bestD = 14 * 14;
    for (const s of this.stars) {
      if (!this.visible(s)) continue;
      const d = (s.px - x) ** 2 + (s.py - y) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  draw() {
    if (!this.stars || !this.w) return;
    const ctx = this.canvas.getContext("2d");
    const { w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Sky ellipse and RA/Dec graticule.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, 2 * SQRT2 * this.scale, SQRT2 * this.scale, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.sky;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    const curve = (pts) => {
      ctx.beginPath();
      pts.forEach(([ra, dec], i) => {
        const [x, y] = project(ra, dec);
        const px = w / 2 + x * this.scale, py = h / 2 - y * this.scale;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.stroke();
    };
    for (let dec = -60; dec <= 60; dec += 30) curve(Array.from({ length: 73 }, (_, i) => [180.001 + i * 5 * 0.99999, dec]));
    for (let ra = 0; ra < 360; ra += 30) curve(Array.from({ length: 37 }, (_, i) => [ra === 180 ? 179.999 : ra, -90 + i * 5]));

    // Stick figures.
    if (this.showLines.checked) {
      ctx.lineWidth = 1;
      for (const [a, b, con] of this.data.lines) {
        const s = this.stars[a], t = this.stars[b];
        if (Math.abs(s.px - t.px) > w / 2) continue; // wraps around the edge
        ctx.strokeStyle = con === this.highlight.con ? COLORS.lineHot : COLORS.line;
        ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(t.px, t.py); ctx.stroke();
      }
    }

    // Stars, faintest first; dots shrink with the map on narrow screens.
    const size = Math.max(0.55, Math.min(1, w / 760));
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i];
      if (!s.eye) continue;
      const m = s.mag ?? 6.5;
      const r = Math.max(0.4, (2.6 - 0.36 * m) * size);
      ctx.fillStyle = `rgba(${COLORS.star},${Math.min(1, 0.35 + (6.5 - m) * 0.14)})`;
      ctx.beginPath(); ctx.arc(s.px, s.py, r, 0, Math.PI * 2); ctx.fill();
    }
    if (this.showHosts.checked) {
      // Thousands of faint hosts crowd the Kepler field, so keep them small and
      // translucent, and shrink them further on narrow screens.
      const k = Math.min(1, w / 900);
      ctx.fillStyle = COLORS.host;
      for (const s of this.stars) {
        if (!s.host) continue;
        ctx.globalAlpha = s.eye ? 0.9 : 0.4;
        ctx.beginPath(); ctx.arc(s.px, s.py, s.eye ? 2.2 * size : Math.max(0.5, 0.9 * k), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Query highlights.
    const ring = (s, color, r = 5) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(s.px, s.py, r, 0, Math.PI * 2); ctx.stroke();
    };
    if (this.highlight.routePath) {
      const path = this.highlight.routePath.slice(1).map((sid) => this.stars[sid]);
      ctx.strokeStyle = COLORS.route; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath();
      path.forEach((s, i) => {
        const prev = path[i - 1];
        if (i === 0 || Math.abs(prev.px - s.px) > w / 2) ctx.moveTo(s.px, s.py);
        else ctx.lineTo(s.px, s.py);
      });
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (this.highlight.route) for (const sid of this.highlight.route) ring(this.stars[sid], COLORS.route, 3.5);
    if (this.highlight.picks) for (const sid of this.highlight.picks) ring(this.stars[sid], COLORS.pick, 6);
    if (this.highlight.labels) {
      ctx.font = "600 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillStyle = COLORS.label;
      for (const [sid, text] of this.highlight.labels) {
        const s = this.stars[sid];
        ctx.fillText(text, s.px + 8, s.py - 6);
      }
    }
    if (this.showLines.checked && w >= 560) {
      ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillStyle = "rgba(170,185,215,0.45)";
      ctx.textAlign = "center";
      for (const l of this.labels) ctx.fillText(l.con, l.px, l.py);
      ctx.textAlign = "start";
    }
    if (this.hover) ring(this.hover, "#fff", 6);
    ctx.restore();

    // Rim.
    ctx.strokeStyle = COLORS.rim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, 2 * SQRT2 * this.scale, SQRT2 * this.scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawTooltip() {
    const s = this.hover;
    if (!s) { this.tooltip.hidden = true; return; }
    const con = this.conName[s.con] || s.con || "";
    const lines = [
      [s.name, "strong"],
      [`${con}${s.mag != null ? ` · mag ${fmt(s.mag, 2)}` : ""}`],
      [s.dist != null ? `${fmt(s.dist, s.dist < 100 ? 1 : 0)} light-years` : "distance unknown"],
    ];
    if (s.planets) lines.push([`${s.planets} known planet${s.planets > 1 ? "s" : ""}`]);
    this.tooltip.replaceChildren(...lines.map(([t, cls]) => el("span", { class: cls || "", text: t })));
    this.tooltip.hidden = false;
    const left = Math.min(s.px + 12, this.w - this.tooltip.offsetWidth - 4);
    const top = s.py + 12 + this.tooltip.offsetHeight > this.h ? s.py - this.tooltip.offsetHeight - 10 : s.py + 12;
    this.tooltip.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, top)}px)`;
  }

  setStatus(text) { this.status.textContent = text; }

  // ------------------------------------------------------------ queries
  async startRelate() {
    const tabs = [...this.root.querySelectorAll('[role="tab"]')];
    try {
      this.relate = new Relate(new URL("sky-worker.js", import.meta.url));
      const { result } = await this.relate.call("load", { dataUrl: new URL(this.root.dataset.src, location.href).href });
      const { result: queries } = await this.relate.call("queries");
      this.queries = queries;
      const n = result.nodes;
      this.setStatus(`Relate loaded ${fmt(n.Star, 0)} stars, ${fmt(n.Planet, 0)} planets and `
        + `${fmt(result.relationships, 0)} relationships in ${fmt(result.ms / 1000, 1)} s.`);
      for (const t of tabs) t.disabled = false;
      this.bindQueries(tabs);
    } catch (err) {
      this.setStatus(`The live queries could not start (${err.message}). The map still works.`);
    }
  }

  bindQueries(tabs) {
    const select = (tab) => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        this.root.querySelector(`#${t.getAttribute("aria-controls")}`).hidden = !on;
      }
      this.run(tab.dataset.query);
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(t));
      t.addEventListener("keydown", (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!step) return;
        const next = tabs[(i + step + tabs.length) % tabs.length];
        next.focus(); select(next);
      });
    });
    const slider = this.root.querySelector('[data-input="max"]');
    slider.addEventListener("input", () => {
      this.root.querySelector('[data-output="max"]').textContent = Number(slider.value).toFixed(1);
    });
    slider.addEventListener("change", () => this.run("route"));
    for (const pre of this.root.querySelectorAll("[data-cypher]")) pre.textContent = this.queries[pre.dataset.cypher];
    select(tabs[0]);
  }

  async run(kind) {
    const out = this.root.querySelector(`[data-result="${kind}"]`);
    out.setAttribute("aria-busy", "true");
    this.highlight = { route: null, picks: null, con: null };
    try {
      if (kind === "route") await this.runRoute(out);
      if (kind === "earthlike") await this.runEarthlike(out);
      if (kind === "counts") await this.runCounts(out);
    } catch (err) {
      out.replaceChildren(el("p", { class: "sky-error", text: `Query failed: ${err.message}` }));
    } finally {
      out.removeAttribute("aria-busy");
      this.draw();
    }
  }

  async runRoute(out) {
    const max = Number(this.root.querySelector('[data-input="max"]').value);
    const { result: r, ms } = await this.relate.call("route", { from: "Sun", to: "TRAPPIST-1", max });
    const target = this.byName.get("TRAPPIST-1");
    if (!r.found) {
      this.highlight.route = new Set(r.reachable);
      this.highlight.picks = new Set([target.sid]);
      this.highlight.labels = [[target.sid, "TRAPPIST-1"]];
      const names = r.reachable.map((sid) => this.stars[sid].name).join(", ");
      out.replaceChildren(
        el("p", { class: "sky-headline", text: `No route with jumps of ${max.toFixed(1)} ly or less.` }),
        el("p", { text: `From the Sun you can reach only ${r.reachable.length} star${r.reachable.length === 1 ? "" : "s"}`
          + `${names ? `: ${names}` : ""}. Try a longer jump; the first route appears at 8.5 ly.` }),
        el("p", { class: "sky-meta", text: `${fmt(r.edges, 0)} NEAR hops qualify · ${ms} ms` }),
      );
      return;
    }
    this.highlight.route = new Set(r.path.slice(1));
    this.highlight.routePath = r.path;
    this.highlight.labels = [[target.sid, "TRAPPIST-1"], [r.path[1], this.stars[r.path[1]].name]];
    const list = el("ol", { class: "sky-hops" }, ...r.hops.map((h) =>
      el("li", {}, el("span", { text: h.to }), el("span", { class: "sky-num", text: `${fmt(h.ly, 2)} ly` }))));
    out.replaceChildren(
      el("p", { class: "sky-headline", text: `${r.hops.length} jumps, ${fmt(r.total, 1)} light-years in total.` }),
      el("p", { text: `The shortest route from the Sun to TRAPPIST-1 (40.5 ly away) with no jump over ${max.toFixed(1)} ly.` }),
      list,
      el("p", { class: "sky-meta", text: `${fmt(r.edges, 0)} NEAR hops qualify · ${ms} ms` }),
    );
  }

  async runEarthlike(out) {
    const { result: rows, ms } = await this.relate.call("earthlike");
    this.highlight.picks = new Set(rows.map((r) => r.sid));
    const hosts = new Map();
    for (const r of rows) if (!hosts.has(r.sid)) hosts.set(r.sid, r.host);
    this.highlight.labels = [...hosts];
    const table = el("table", { class: "sky-table" },
      el("thead", {}, el("tr", {}, ...["#", "Planet", "Host star", "Constellation", "Similarity"].map((t) => el("th", { text: t, scope: "col" })))),
      el("tbody", {}, ...rows.map((r, i) => el("tr", {},
        el("td", { class: "sky-num", text: String(i + 1) }), el("td", { text: r.planet }), el("td", { text: `${r.host} (mag ${fmt(r.mag, 1)})` }),
        el("td", { text: r.constellation }), el("td", { class: "sky-num", text: r.similarity.toFixed(3) })))));
    out.replaceChildren(
      el("p", { class: "sky-headline", text: "The ten planets most like Earth whose star you can see without a telescope." }),
      el("div", { class: "sky-scroll" }, table),
      el("p", { class: "sky-meta", text: `${ms} ms` }),
    );
  }

  async runCounts(out) {
    const { result, ms } = await this.relate.call("counts");
    const top = result.byConstellation.slice(0, 10);
    const maxN = top[0].planets;
    this.highlight.con = top[0].abbr;
    const bars = el("ol", { class: "sky-bars" }, ...top.map((r) => {
      const li = el("li", {}, el("span", { text: r.constellation }),
        el("span", { class: "sky-bar", style: `--w:${(100 * r.planets) / maxN}%` }),
        el("span", { class: "sky-num", text: fmt(r.planets, 0) }));
      li.addEventListener("pointerenter", () => { this.highlight.con = r.abbr; this.draw(); });
      return li;
    }));
    const decades = [...new Set(result.byMethodDecade.map((r) => r.decade))].sort();
    const totals = {};
    for (const r of result.byMethodDecade) totals[r.method] = (totals[r.method] || 0) + r.planets;
    const methods = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    const cell = Object.fromEntries(result.byMethodDecade.map((r) => [`${r.method}|${r.decade}`, r.planets]));
    const table = el("table", { class: "sky-table" },
      el("thead", {}, el("tr", {}, el("th", { text: "Method", scope: "col" }), ...decades.map((d) => el("th", { class: "sky-num", text: `${d}s`, scope: "col" })))),
      el("tbody", {}, ...methods.map((m) => el("tr", {}, el("th", { text: m, scope: "row" }),
        ...decades.map((d) => el("td", { class: "sky-num", text: cell[`${m}|${d}`] ? fmt(cell[`${m}|${d}`], 0) : "·" }))))));
    out.replaceChildren(
      el("h4", { text: "Planets by constellation (top 10)" }), bars,
      el("h4", { text: "Planets by discovery method, per decade" }), el("div", { class: "sky-scroll" }, table),
      el("p", { class: "sky-meta", text: `${ms} ms` }),
    );
  }
}

function boot(root) {
  const map = new SkyMap(root);
  map.start().catch((err) => map.setStatus(`The sky map could not load (${err.message}).`));
}

for (const root of document.querySelectorAll("[data-sky-graph]")) {
  // Load the data and the 7 MB engine only when the map is about to scroll into view.
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); boot(root); }
    }, { rootMargin: "600px 0px" });
    io.observe(root);
  } else boot(root);
}
