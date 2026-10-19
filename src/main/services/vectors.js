'use strict';
const { sha256 } = require('../core/util');
const log = require('../core/logger').scope('vectors');

/**
 * Embedding store + in-memory flat index.
 * Vectors are L2-normalised Float32 (768 dims) in SQLite BLOBs. The index is
 * loaded lazily into one contiguous Float32Array per owner type, so a query
 * is a single tight dot-product loop (≈ 25 ms for 50k vectors on a 5600X).
 */
class VectorIndex {
  constructor(ctx) {
    this.db = ctx.db; // nur noch lokale Vektoren aus älteren Versionen (Duplikat-Pflege); keine Cloud-Embeddings
    this.indexes = new Map(); // owner -> { ids:[], mat:Float32Array, dim }
    this.busy = false;
  }

  invalidate(owner) { this.indexes.delete(owner); }

  load(owner) {
    if (this.indexes.has(owner)) return this.indexes.get(owner);
    const rows = this.db.all('SELECT owner_id, dim, vec FROM embeddings WHERE owner=?', owner);
    const dim = rows[0]?.dim || 768;
    const mat = new Float32Array(rows.length * dim);
    const ids = [];
    rows.forEach((r, i) => {
      const v = new Float32Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength / 4);
      if (v.length === dim) { mat.set(v, i * dim); ids.push(r.owner_id); }
    });
    const idx = { ids, mat: mat.subarray(0, ids.length * dim), dim };
    this.indexes.set(owner, idx);
    return idx;
  }

  count(owner) { return this.db.get('SELECT COUNT(*) c FROM embeddings WHERE owner=?', owner).c; }

  put(owner, ownerId, text, vec, model) {
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    this.db.run(`INSERT INTO embeddings(owner,owner_id,model,dim,text_hash,vec) VALUES(?,?,?,?,?,?)
      ON CONFLICT(owner,owner_id) DO UPDATE SET model=excluded.model, dim=excluded.dim, text_hash=excluded.text_hash, vec=excluded.vec`,
    owner, String(ownerId), model, vec.length, sha256(text), buf);
  }
  remove(owner, ownerId) { this.db.run('DELETE FROM embeddings WHERE owner=? AND owner_id=?', owner, String(ownerId)); this.invalidate(owner); }

  /** Top-k cosine neighbours. */
  search(owner, qvec, k = 20, filter) {
    const idx = this.load(owner);
    const { ids, mat, dim } = idx;
    if (!ids.length || qvec.length !== dim) return [];
    const scores = new Float32Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      let s = 0; const o = i * dim;
      for (let j = 0; j < dim; j++) s += mat[o + j] * qvec[j];
      scores[i] = s;
    }
    const order = [...scores.keys()].sort((a, b) => scores[b] - scores[a]);
    const out = [];
    for (const i of order) {
      if (filter && !filter(ids[i])) continue;
      out.push({ id: ids[i], score: scores[i] });
      if (out.length >= k) break;
    }
    return out;
  }

}

module.exports = { VectorIndex };
