import { create } from 'zustand';

let _nextId = 1;
const genId = () => String(_nextId++);

const MAX_HISTORY = 100;

const useLevelStore = create((set, get) => ({
  vertices: {},  // { [id]: { id, x, y } }
  lines:    {},  // { [id]: { id, v1, v2 } }
  history:  [],  // [{ vertices, lines }, ...] oldest → newest
  future:   [],  // [{ vertices, lines }, ...] most-recent-undone first

  // ── Internal raw mutations (no history) ────────────────────────────────────
  _rawAddVertex(x, y) {
    const id = genId();
    set(s => ({ vertices: { ...s.vertices, [id]: { id, x, y } } }));
    return id;
  },

  _rawMoveVertex(id, x, y) {
    set(s => ({ vertices: { ...s.vertices, [id]: { ...s.vertices[id], x, y } } }));
  },

  _rawDeleteVertex(id) {
    set(s => {
      const vertices = { ...s.vertices };
      delete vertices[id];
      const lines = Object.fromEntries(
        Object.entries(s.lines).filter(([, w]) => w.v1 !== id && w.v2 !== id)
      );
      return { vertices, lines };
    });
  },

  _rawAddLine(v1, v2) {
    if (v1 === v2) return null;
    const dupe = Object.values(get().lines).find(
      w => (w.v1 === v1 && w.v2 === v2) || (w.v1 === v2 && w.v2 === v1)
    );
    if (dupe) return null;
    const id = genId();
    set(s => ({ lines: { ...s.lines, [id]: { id, v1, v2 } } }));
    return id;
  },

  _rawDeleteLine(id) {
    set(s => {
      const lines = { ...s.lines };
      delete lines[id];
      return { lines };
    });
  },

  // ── History ─────────────────────────────────────────────────────────────────
  _save() {
    const { vertices, lines } = get();
    set(s => ({
      history: [...s.history.slice(-(MAX_HISTORY - 1)), { vertices, lines }],
      future:  [],
    }));
  },

  undo() {
    const s = get();
    if (s.history.length === 0) return;
    const snap = s.history[s.history.length - 1];
    set({
      vertices: snap.vertices,
      lines:    snap.lines,
      history:  s.history.slice(0, -1),
      future:   [{ vertices: s.vertices, lines: s.lines }, ...s.future.slice(0, MAX_HISTORY - 1)],
    });
  },

  redo() {
    const s = get();
    if (s.future.length === 0) return;
    const snap = s.future[0];
    set({
      vertices: snap.vertices,
      lines:    snap.lines,
      history:  [...s.history.slice(-(MAX_HISTORY - 1)), { vertices: s.vertices, lines: s.lines }],
      future:   s.future.slice(1),
    });
  },

  // ── Public mutations ────────────────────────────────────────────────────────
  addVertex(x, y) {
    get()._save();
    return get()._rawAddVertex(x, y);
  },

  // Call once at drag start; subsequent moveVertex calls during drag are free.
  beginMove() {
    get()._save();
  },

  moveVertex(id, x, y) {
    get()._rawMoveVertex(id, x, y);
  },

  deleteVertex(id) {
    get()._save();
    get()._rawDeleteVertex(id);
  },

  addLine(v1, v2) {
    get()._save();
    return get()._rawAddLine(v1, v2);
  },

  deleteLine(id) {
    get()._save();
    get()._rawDeleteLine(id);
  },

  // Compound: add a vertex and connect it to an existing vertex — one history entry.
  addVertexAndLine(fromId, x, y) {
    get()._save();
    const newId = get()._rawAddVertex(x, y);
    get()._rawAddLine(fromId, newId);
    return newId;
  },

  // Compound: place a vertex that splits an existing line — one history entry.
  splitLine(lineId, x, y) {
    get()._save();
    const w = get().lines[lineId];
    const newId = get()._rawAddVertex(x, y);
    get()._rawDeleteLine(lineId);
    get()._rawAddLine(w.v1, newId);
    get()._rawAddLine(newId, w.v2);
    return newId;
  },

  // Compound: extrude a line — one history entry, returns new vertex ids + origins.
  extrudeLine(lineId) {
    get()._save();
    const { vertices, lines } = get();
    const w  = lines[lineId];
    const v1 = vertices[w.v1];
    const v2 = vertices[w.v2];
    const n1id = get()._rawAddVertex(v1.x, v1.y);
    const n2id = get()._rawAddVertex(v2.x, v2.y);
    get()._rawAddLine(w.v1, n1id);
    get()._rawAddLine(w.v2, n2id);
    get()._rawAddLine(n1id, n2id);
    return { n1id, n2id, origV1x: v1.x, origV1y: v1.y, origV2x: v2.x, origV2y: v2.y };
  },

  clearLevel() {
    get()._save();
    set({ vertices: {}, lines: {} });
  },

  loadLevel(data) {
    const allIds = [
      ...Object.keys(data.vertices || {}),
      ...Object.keys(data.lines   || {}),
    ];
    const maxId = Math.max(0, ...allIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n)));
    _nextId = maxId + 1;
    set({ vertices: data.vertices || {}, lines: data.lines || {}, history: [], future: [] });
  },
}));

export default useLevelStore;
