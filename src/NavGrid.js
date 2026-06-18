import * as THREE from 'three';

/**
 * Multi-level navigation grid over the whole house, with A* pathfinding.
 *
 * Each XZ cell can hold several walkable "levels" (e.g. ground floor + the floor
 * above it). A level is walkable only with body clearance + headroom, so cells
 * occupied by furniture or walls drop out and the monster routes around them.
 * Adjacent levels link when their height differs by < maxStep AND there's no wall
 * between — which also threads the staircase (each step links to the next), so
 * the monster can climb up and down between floors.
 */
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

export default class NavGrid {
  constructor(collider, bounds, opts = {}) {
    this.collider = collider;
    this.mesh = collider.mesh;
    this.cell = opts.cell ?? 0.5;
    this.maxStep = opts.maxStep ?? 0.72;   // height a single grid step may rise/fall (threads stairs)
    this.clearH = opts.clearH ?? 1.65;     // headroom above a floor for the body
    this.bodyR = opts.bodyR ?? 0.38;       // body radius for wall/furniture clearance
    this.floorMin = opts.floorMin ?? -0.7; // ignore yard-level floors (keep it inside)
    this.floorMax = opts.floorMax ?? 6.0;  // ignore the roof
    this.minX = bounds.minX; this.minZ = bounds.minZ;
    this.maxX = bounds.maxX; this.maxZ = bounds.maxZ;
    this.cols = Math.ceil((bounds.maxX - bounds.minX) / this.cell) + 1;
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / this.cell) + 1;

    this._ray = new THREE.Raycaster();
    this._o = new THREE.Vector3(); this._d = new THREE.Vector3();

    this.cellNodes = new Array(this.cols * this.rows); // cell index -> [node index,...]
    this.X = []; this.Y = []; this.Z = []; this.nbr = []; // parallel node arrays
    this._build();

    const n = this.X.length;
    let edges = 0; for (const a of this.nbr) edges += a.length / 2;
    this._g = new Float32Array(n); this._came = new Int32Array(n);
    this._seen = new Int32Array(n).fill(-1); this._done = new Int32Array(n).fill(-1); this._gen = 0;
    const cap = edges + n + 16;                 // heap may hold duplicate (lazy) entries up to #edges
    this._heap = new Int32Array(cap); this._hf = new Float32Array(cap);
    this._computeMain(); // tag the largest reachable component
    this._computeAreas(opts.areaBin ?? 4); // spatially-uniform destinations for patrol/spawn
  }

  // Flood-fill connected components; keep the biggest as the reachable house area.
  _computeMain() {
    const N = this.X.length, comp = new Int32Array(N).fill(-1), sizes = [];
    let nc = 0;
    for (let s = 0; s < N; s++) {
      if (comp[s] >= 0) continue;
      const id = nc++; let cnt = 0; const st = [s]; comp[s] = id;
      while (st.length) { const c = st.pop(); cnt++; const nb = this.nbr[c]; for (let k = 0; k < nb.length; k += 2) { const m = nb[k]; if (comp[m] < 0) { comp[m] = id; st.push(m); } } }
      sizes.push(cnt);
    }
    let big = 0; for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[big]) big = i;
    this.main = new Uint8Array(N); this.mainNodes = [];
    for (let i = 0; i < N; i++) if (comp[i] === big) { this.main[i] = 1; this.mainNodes.push(i); }
  }

  // One representative node per coarse XZ bin per floor → patrol destinations are
  // spread evenly over the *house*, not weighted by how many cells a room has.
  _computeAreas(bin) {
    const seen = new Map();
    for (const n of this.mainNodes) {
      const key = Math.floor(this.X[n] / bin) + ',' + Math.floor(this.Z[n] / bin) + ',' + Math.round(this.Y[n] / 3);
      if (!seen.has(key)) seen.set(key, n);
    }
    this.areas = [...seen.values()];
  }

  /** A random reachable (main-component) node position — for spawning / wandering. */
  randomReachable(rng = Math.random) {
    const n = this.mainNodes[(rng() * this.mainNodes.length) | 0];
    return new THREE.Vector3(this.X[n], this.Y[n], this.Z[n]);
  }

  /** A random spatially-spread area position (a "room" to patrol to). */
  randomArea(rng = Math.random) {
    const n = this.areas[(rng() * this.areas.length) | 0];
    return new THREE.Vector3(this.X[n], this.Y[n], this.Z[n]);
  }

  _wx(cx) { return this.minX + cx * this.cell; }
  _wz(cz) { return this.minZ + cz * this.cell; }
  _ci(cx, cz) { return cz * this.cols + cx; }

  // ---- build ----
  _floorLevels(x, z) {
    this._ray.firstHitOnly = false;
    this._ray.set(this._o.set(x, this.floorMax + 8, z), DOWN); this._ray.far = this.floorMax + 60;
    const hits = this._ray.intersectObject(this.mesh, false);
    const out = [];
    for (const h of hits) {                 // sorted top→bottom
      if (!h.face || h.face.normal.y < 0.5) continue; // only up-facing surfaces (floors)
      const y = h.point.y;
      if (y >= this.floorMin && y <= this.floorMax) out.push(y);
    }
    return out;
  }

  _walkable(x, y, z) {
    this._ray.firstHitOnly = true;
    // headroom straight up
    this._ray.set(this._o.set(x, y + 0.12, z), UP); this._ray.far = this.clearH;
    if (this._ray.intersectObject(this.mesh, false).length) return false;
    // body clearance: no wall/furniture within bodyR around the chest
    const cy = y + 0.9;
    for (let a = 0; a < 8; a++) {
      const ang = a * Math.PI / 4;
      this._d.set(Math.sin(ang), 0, Math.cos(ang));
      this._ray.set(this._o.set(x, cy, z), this._d); this._ray.far = this.bodyR;
      if (this._ray.intersectObject(this.mesh, false).length) return false;
    }
    return true;
  }

  _build() {
    // 1) place nodes
    for (let cz = 0; cz < this.rows; cz++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const x = this._wx(cx), z = this._wz(cz);
        const levels = this._floorLevels(x, z);
        const list = [];
        for (const y of levels) {
          if (!this._walkable(x, y, z)) continue;
          const id = this.X.length;
          this.X.push(x); this.Y.push(y); this.Z.push(z); this.nbr.push([]);
          list.push(id);
        }
        if (list.length) this.cellNodes[this._ci(cx, cz)] = list;
      }
    }
    // 2) link neighbours (4 orthogonal + 4 diagonal, no corner-cutting)
    const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let cz = 0; cz < this.rows; cz++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const here = this.cellNodes[this._ci(cx, cz)];
        if (!here) continue;
        for (const a of here) {
          for (const [dx, dz] of ORTHO) this._linkInto(a, cx + dx, cz + dz);
          for (const [dx, dz] of DIAG) {
            // require both orthogonal cells passable at a similar height (no clipping corners)
            if (this._cellHasNear(cx + dx, cz, this.Y[a]) && this._cellHasNear(cx, cz + dz, this.Y[a])) {
              this._linkInto(a, cx + dx, cz + dz);
            }
          }
        }
      }
    }
  }

  _cellHasNear(cx, cz, y) {
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return false;
    const list = this.cellNodes[this._ci(cx, cz)];
    if (!list) return false;
    for (const n of list) if (Math.abs(this.Y[n] - y) <= this.maxStep) return true;
    return false;
  }

  _linkInto(a, cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return;
    const list = this.cellNodes[this._ci(cx, cz)];
    if (!list) return;
    for (const b of list) {
      if (Math.abs(this.Y[a] - this.Y[b]) > this.maxStep) continue;
      if (!this._clear(a, b)) continue;
      const cost = Math.hypot(this.X[a] - this.X[b], (this.Y[a] - this.Y[b]) * 1.5, this.Z[a] - this.Z[b]);
      this.nbr[a].push(b, cost);   // flat [node, cost, node, cost, ...]
    }
  }

  // no wall between two node centres at body height
  _clear(a, b) {
    this._ray.firstHitOnly = true;
    const ay = this.Y[a] + 0.9, by = this.Y[b] + 0.9;
    this._o.set(this.X[a], ay, this.Z[a]);
    this._d.set(this.X[b] - this.X[a], by - ay, this.Z[b] - this.Z[a]);
    const len = this._d.length(); this._d.divideScalar(len);
    this._ray.set(this._o, this._d); this._ray.far = len - 0.02;
    return this._ray.intersectObject(this.mesh, false).length === 0;
  }

  // ---- queries ----
  /** Nearest walkable node to a world point (prefers the matching floor height). */
  nearest(x, y, z) {
    const ccx = Math.round((x - this.minX) / this.cell);
    const ccz = Math.round((z - this.minZ) / this.cell);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= 4 && best < 0; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = ccx + dx, cz = ccz + dz;
        if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) continue;
        const list = this.cellNodes[this._ci(cx, cz)];
        if (!list) continue;
        for (const n of list) {
          const d = (this.X[n] - x) ** 2 + ((this.Y[n] - y) * 2.5) ** 2 + (this.Z[n] - z) ** 2;
          if (d < bd) { bd = d; best = n; }
        }
      }
    }
    return best;
  }

  // binary min-heap helpers (indices into nodes, keyed by f)
  _hpush(node, f) {
    let i = ++this._hn; this._heap[i] = node; this._hf[i] = f;
    while (i > 1 && this._hf[i >> 1] > this._hf[i]) { this._swap(i, i >> 1); i >>= 1; }
  }
  _hpop() {
    const top = this._heap[1]; const n = this._hn--;
    this._heap[1] = this._heap[n]; this._hf[1] = this._hf[n];
    let i = 1;
    for (;;) {
      let l = i << 1, r = l + 1, s = i;
      if (l <= this._hn && this._hf[l] < this._hf[s]) s = l;
      if (r <= this._hn && this._hf[r] < this._hf[s]) s = r;
      if (s === i) break; this._swap(i, s); i = s;
    }
    return top;
  }
  _swap(i, j) { const a = this._heap[i]; this._heap[i] = this._heap[j]; this._heap[j] = a; const b = this._hf[i]; this._hf[i] = this._hf[j]; this._hf[j] = b; }

  _h(a, b) { return Math.hypot(this.X[a] - this.X[b], this.Y[a] - this.Y[b], this.Z[a] - this.Z[b]); }

  /** A* from one node to another; returns the node-index path (incl. both ends) or null. */
  _astar(start, goal) {
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [start];
    const gen = ++this._gen; this._hn = 0;
    this._seen[start] = gen; this._g[start] = 0; this._came[start] = -1;
    this._hpush(start, this._h(start, goal));
    while (this._hn > 0) {
      const cur = this._hpop();
      if (this._done[cur] === gen) continue;    // lazy deletion of stale heap entries
      this._done[cur] = gen;
      if (cur === goal) break;
      const list = this.nbr[cur], gc = this._g[cur];
      for (let k = 0; k < list.length; k += 2) {
        const nx = list[k], ng = gc + list[k + 1];
        if (this._seen[nx] !== gen || ng < this._g[nx]) {
          this._seen[nx] = gen; this._g[nx] = ng; this._came[nx] = cur;
          this._hpush(nx, ng + this._h(nx, goal));
        }
      }
    }
    if (this._seen[goal] !== gen) return null;
    const path = []; for (let c = goal; c !== -1; c = this._came[c]) path.push(c);
    path.reverse(); return path;
  }

  /** World-space waypoint path from one point to another (slightly raised toward feet level). */
  findPath(sx, sy, sz, gx, gy, gz, out = []) {
    const path = this._astar(this.nearest(sx, sy, sz), this.nearest(gx, gy, gz));
    out.length = 0;
    if (!path) return null;
    for (const n of path) out.push(new THREE.Vector3(this.X[n], this.Y[n], this.Z[n]));
    return out;
  }

  /** Walkable path distance (units) between two world points, or Infinity. */
  pathDist(sx, sy, sz, gx, gy, gz) {
    const path = this._astar(this.nearest(sx, sy, sz), this.nearest(gx, gy, gz));
    if (!path) return Infinity;
    let d = 0;
    for (let i = 1; i < path.length; i++) d += this._h(path[i - 1], path[i]);
    return d;
  }

  /** A random walkable node's position (for wandering / spawning). */
  randomPoint(rng = Math.random) {
    const n = (rng() * this.X.length) | 0;
    return new THREE.Vector3(this.X[n], this.Y[n], this.Z[n]);
  }
}
