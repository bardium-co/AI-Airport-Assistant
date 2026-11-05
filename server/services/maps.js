export class MapService {
  constructor(db) { this.db = db; this.version = 0; this.cache = null; }

  invalidate() { this.version++; this.cache = null; }

  graph() {
    if (this.cache) return this.cache;
    const nodes = new Map(this.db.all('SELECT * FROM locations').map(n => [n.id, n]));
    const adj = new Map([...nodes.keys()].map(id => [id, []]));
    for (const e of this.db.all('SELECT * FROM edges')) {
      if (!nodes.has(e.a) || !nodes.has(e.b)) continue;
      adj.get(e.a).push({ to: e.b, d: e.distance_m, stepFree: !!e.step_free, kind: e.kind });
      adj.get(e.b).push({ to: e.a, d: e.distance_m, stepFree: !!e.step_free, kind: e.kind });
    }
    this.cache = { nodes, adj };
    return this.cache;
  }

  speeds() {
    return {
      normal: Number(this.db.getSetting('walk_speed_m_per_min', 75)),
      stepFree: Number(this.db.getSetting('step_free_speed_m_per_min', 50)),
      trainMinutes: Number(this.db.getSetting('train_minutes', 4)),
    };
  }

  /** Routing cost of an edge in "walking-metre equivalents": trains cost their ride + wait time, everything else its length. */
  edgeCost(e, speed, trainMinutes) {
    return e.kind === 'train' ? trainMinutes * speed : e.d;
  }

  /** Dijkstra shortest path. Closed locations are never used as intermediate nodes. */
  shortestPaths(from, { stepFree = false } = {}) {
    const { nodes, adj } = this.graph();
    const sp = this.speeds();
    const speed = stepFree ? sp.stepFree : sp.normal;
    if (!nodes.has(from)) return null;
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const done = new Set();
    const heap = [[0, from]];
    while (heap.length) {
      let bi = 0;
      for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[bi][0]) bi = i;
      const [d, u] = heap.splice(bi, 1)[0];
      if (done.has(u)) continue;
      done.add(u);
      const node = nodes.get(u);
      if (u !== from && node.status === 'closed') continue; // reachable as destination, not as pass-through
      for (const e of adj.get(u)) {
        if (stepFree && !e.stepFree) continue;
        const nd = d + this.edgeCost(e, speed, sp.trainMinutes);
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, u); heap.push([nd, e.to]); }
      }
    }
    return { dist, prev };
  }

  route(from, to, opts = {}) {
    const { nodes } = this.graph();
    if (!nodes.has(from) || !nodes.has(to)) return null;
    const sp = this.shortestPaths(from, opts);
    if (!sp.dist.has(to)) return null;
    const path = [to];
    while (path[0] !== from) path.unshift(sp.prev.get(path[0]));
    return this.describe(path, sp.dist.get(to), opts);
  }

  describe(path, cost, { stepFree = false } = {}) {
    const { nodes, adj } = this.graph();
    const sp = this.speeds();
    const speed = stepFree ? sp.stepFree : sp.normal;
    let walked = 0, trains = 0;
    const steps = path.map((id, i) => {
      const n = nodes.get(id);
      let via = null;
      if (i > 0) {
        const edges = adj.get(path[i - 1]).filter(e => e.to === id && (!stepFree || e.stepFree));
        const e = edges.reduce((best, x) => (!best || this.edgeCost(x, speed, sp.trainMinutes) < this.edgeCost(best, speed, sp.trainMinutes) ? x : best), null);
        via = e?.kind ?? 'walk';
        if (via === 'train') trains++; else walked += e?.d ?? 0;
      }
      return { id, name: n.name, type: n.type, concourse: n.concourse, level: n.level, via };
    });
    return {
      path, steps,
      meters: Math.round(walked), // walking distance only (train rides excluded)
      minutes: Math.max(1, Math.ceil(walked / speed + trains * sp.trainMinutes)),
      cost: Math.round(cost), train: trains > 0, stepFree: !!stepFree,
      simulated: path.some(id => nodes.get(id).simulated),
    };
  }

  /** Nearest open location of a given type (or matching a predicate). */
  nearest(from, typeOrFn, opts = {}) {
    const { nodes } = this.graph();
    const sp = this.shortestPaths(from, opts);
    if (!sp) return null;
    const match = typeof typeOrFn === 'function' ? typeOrFn : (n => n.type === typeOrFn);
    let best = null;
    for (const [id, d] of sp.dist) {
      const n = nodes.get(id);
      if (!match(n) || n.status === 'closed') continue;
      if (!best || d < best.d) best = { id, d };
    }
    if (!best) return null;
    const path = [best.id];
    while (path[0] !== from) path.unshift(sp.prev.get(path[0]));
    return this.describe(path, best.d, opts);
  }

  distancesFrom(from, opts = {}) {
    const sp = this.shortestPaths(from, opts);
    return sp ? sp.dist : new Map();
  }

  location(id) { return this.graph().nodes.get(id); }

  gateLocation(code) {
    const id = 'GATE_' + String(code).toUpperCase();
    const n = this.location(id);
    return n && n.type === 'gate' ? n : null;
  }
}
