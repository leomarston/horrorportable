import * as THREE from 'three';

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();

/**
 * Coarse walkability grid over the house ground floor with BFS path distance.
 * Adjacency is precomputed once (a wall between two floor cells severs the link),
 * so runtime path queries are pure array work — used to decide when the monster
 * should give up because the *walkable* route to you has grown too long.
 */
export default class Nav {
  constructor(collider, area, cell) {
    this.collider = collider;
    this.cell = cell;
    this.minX = area.minX;
    this.minZ = area.minZ;
    this.cols = Math.ceil((area.maxX - area.minX) / cell) + 1;
    this.rows = Math.ceil((area.maxZ - area.minZ) / cell) + 1;
    const n = this.cols * this.rows;
    this.walk = new Uint8Array(n);
    this.floorY = new Float32Array(n);
    this.adj = new Uint8Array(n);
    this._dist = new Int16Array(n);
    this._q = new Int32Array(n);
    this._ray = new THREE.Raycaster(); this._ray.firstHitOnly = true;
    this._build();
  }

  _wx(cx) { return this.minX + cx * this.cell; }
  _wz(cz) { return this.minZ + cz * this.cell; }
  _idx(cx, cz) { return cz * this.cols + cx; }

  _build() {
    for (let cz = 0; cz < this.rows; cz++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const y = this.collider.groundY(this._wx(cx), this._wz(cz), 1.7);
        const i = this._idx(cx, cz);
        if (y != null && y > -0.8 && y < 0.6) { this.walk[i] = 1; this.floorY[i] = y; }
      }
    }
    for (let cz = 0; cz < this.rows; cz++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const i = this._idx(cx, cz);
        if (!this.walk[i]) continue;
        for (let k = 0; k < 4; k++) {
          const nx = cx + NB[k][0], nz = cz + NB[k][1];
          if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
          const ni = this._idx(nx, nz);
          if (this.walk[ni] && this._clear(cx, cz, nx, nz)) this.adj[i] |= (1 << k);
        }
      }
    }
  }

  // No wall between two adjacent cell centres (ray at chest height).
  _clear(ax, az, bx, bz) {
    _a.set(this._wx(ax), this.floorY[this._idx(ax, az)] + 1.0, this._wz(az));
    _b.set(this._wx(bx), this.floorY[this._idx(bx, bz)] + 1.0, this._wz(bz));
    _d.subVectors(_b, _a); const len = _d.length(); _d.normalize();
    this._ray.set(_a, _d); this._ray.far = len - 0.05;
    return this._ray.intersectObject(this.collider.mesh, false).length === 0;
  }

  _nearestWalkable(cx, cz) {
    cx = Math.max(0, Math.min(this.cols - 1, cx));
    cz = Math.max(0, Math.min(this.rows - 1, cz));
    if (this.walk[this._idx(cx, cz)]) return this._idx(cx, cz);
    for (let r = 1; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
        if (this.walk[this._idx(nx, nz)]) return this._idx(nx, nz);
      }
    }
    return -1;
  }

  /** Walkable path distance in units between two world points; Infinity if unreachable. */
  pathDist(ax, az, bx, bz) {
    const start = this._nearestWalkable(Math.round((ax - this.minX) / this.cell), Math.round((az - this.minZ) / this.cell));
    const goal = this._nearestWalkable(Math.round((bx - this.minX) / this.cell), Math.round((bz - this.minZ) / this.cell));
    if (start < 0 || goal < 0) return Infinity;
    this._dist.fill(-1);
    let head = 0, tail = 0;
    this._dist[start] = 0; this._q[tail++] = start;
    while (head < tail) {
      const cur = this._q[head++];
      if (cur === goal) return this._dist[cur] * this.cell;
      const cx = cur % this.cols, cz = (cur / this.cols) | 0, d = this._dist[cur];
      for (let k = 0; k < 4; k++) {
        if (!(this.adj[cur] & (1 << k))) continue;
        const ni = this._idx(cx + NB[k][0], cz + NB[k][1]);
        if (this._dist[ni] < 0) { this._dist[ni] = d + 1; this._q[tail++] = ni; }
      }
    }
    return Infinity;
  }
}
