import { create } from 'zustand';

let _nextId = 1;
const genId = () => String(_nextId++);

const useLevelStore = create((set, get) => ({
  vertices: {},  // { [id]: { id, x, y } }
  walls: {},     // { [id]: { id, v1, v2 } }

  addVertex(x, y) {
    const id = genId();
    set(s => ({ vertices: { ...s.vertices, [id]: { id, x, y } } }));
    return id;
  },

  moveVertex(id, x, y) {
    set(s => ({ vertices: { ...s.vertices, [id]: { ...s.vertices[id], x, y } } }));
  },

  deleteVertex(id) {
    set(s => {
      const vertices = { ...s.vertices };
      delete vertices[id];
      const walls = Object.fromEntries(
        Object.entries(s.walls).filter(([, w]) => w.v1 !== id && w.v2 !== id)
      );
      return { vertices, walls };
    });
  },

  addWall(v1, v2) {
    if (v1 === v2) return null;
    const dupe = Object.values(get().walls).find(
      w => (w.v1 === v1 && w.v2 === v2) || (w.v1 === v2 && w.v2 === v1)
    );
    if (dupe) return null;
    const id = genId();
    set(s => ({ walls: { ...s.walls, [id]: { id, v1, v2 } } }));
    return id;
  },

  deleteWall(id) {
    set(s => {
      const walls = { ...s.walls };
      delete walls[id];
      return { walls };
    });
  },

  clearLevel() {
    set({ vertices: {}, walls: {} });
  },

  loadLevel(data) {
    const allIds = [
      ...Object.keys(data.vertices || {}),
      ...Object.keys(data.walls || {}),
    ];
    const maxId = Math.max(0, ...allIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n)));
    _nextId = maxId + 1;
    set({ vertices: data.vertices || {}, walls: data.walls || {} });
  },
}));

export default useLevelStore;
