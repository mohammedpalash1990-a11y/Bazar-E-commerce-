// In-memory document store with the same surface the handlers expect from Firestore.
// Used by the offline demo (persisted to localStorage) and by the automated tests.
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const OPS = {
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
};

export class MemStore {
  constructor(data = {}, onChange = () => {}) {
    this.data = data;
    this.onChange = onChange;
  }

  _col(c) {
    return (this.data[c] ||= {});
  }

  async get(c, id) {
    const d = this._col(c)[id];
    return d ? { ...clone(d), id } : null;
  }

  async query(c, conds = [], limit = 0) {
    const out = [];
    for (const [id, d] of Object.entries(this._col(c))) {
      if (conds.every(([f, op, v]) => OPS[op](d[f], v))) out.push({ ...clone(d), id });
      if (limit && out.length >= limit) break;
    }
    return out;
  }

  async put(c, id, data) {
    const { id: _ignored, ...rest } = data;
    this._col(c)[id] = clone(rest);
    this.onChange(c, id);
  }

  async merge(c, id, patch) {
    const cur = this._col(c)[id] || {};
    this._col(c)[id] = { ...cur, ...clone(patch) };
    this.onChange(c, id);
  }

  async remove(c, id) {
    delete this._col(c)[id];
    this.onChange(c, id);
  }

  async begin() {
    const self = this;
    const pending = new Map();
    return {
      async get(c, id) {
        const hit = pending.get(`${c}/${id}`);
        if (hit) return { ...clone(hit.data), id };
        return self.get(c, id);
      },
      set(c, id, data) {
        const { id: _ignored, ...rest } = data;
        pending.set(`${c}/${id}`, { c, id, data: clone(rest) });
      },
      async commit() {
        for (const { c, id, data } of pending.values()) self._col(c)[id] = data;
        for (const { c, id } of pending.values()) self.onChange(c, id);
        pending.clear();
      },
    };
  }
}
