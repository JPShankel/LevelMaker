import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import useLevelStore from '../store/useLevelStore.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const VERTEX_RADIUS  = 0.25;
const HIT_RADIUS     = 0.55;   // world-unit radius for vertex click
const WALL_HIT_DIST  = 0.3;    // world-unit distance to wall line for click
const INITIAL_VIEW_H = 24;     // initial frustum height in world units

const C = {
  BG:                0x12122a,
  GRID_MINOR:        0x1e1e40,
  GRID_MAJOR:        0x2a2a58,
  VERTEX:            0x00e5ff,
  VERTEX_HOVER:      0xffeb3b,
  VERTEX_SELECTED:   0xff9800,  // wall-start selected
  VERTEX_DEL_HOVER:  0xff1744,
  WALL:              0x7986cb,
  WALL_HOVER:        0xff9800,
  WALL_DEL_HOVER:    0xff1744,
  WALL_PREVIEW:      0x4db6ac,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildGrid(scene, extent = 60) {
  const minor = [], major = [];
  for (let i = -extent; i <= extent; i++) {
    const arr = i % 5 === 0 ? major : minor;
    arr.push(-extent, i, -0.1,  extent, i, -0.1);
    arr.push(i, -extent, -0.1,  i,  extent, -0.1);
  }
  const make = (positions, color) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }));
  };
  scene.add(make(minor, C.GRID_MINOR));
  scene.add(make(major, C.GRID_MAJOR));
}

function mouseToWorld(e, canvas, camera) {
  const r   = canvas.getBoundingClientRect();
  const ndx = ((e.clientX - r.left)  / r.width)  * 2 - 1;
  const ndy = -((e.clientY - r.top) / r.height) * 2 + 1;
  const v   = new THREE.Vector3(ndx, ndy, 0);
  v.unproject(camera);
  return { x: v.x, y: v.y };
}

function ptSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function makeCircle(x, y, color) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(VERTEX_RADIUS, 20),
    new THREE.MeshBasicMaterial({ color })
  );
  m.position.set(x, y, 0.1);
  return m;
}

function makeWallLine(x1, y1, x2, y2, color) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([x1, y1, 0, x2, y2, 0], 3));
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function LevelCanvas({ tool, onStatus, onToolChange }) {
  const containerRef = useRef(null);
  const toolRef      = useRef(tool);

  // Keep tool ref in sync so the Three.js closure always reads current tool.
  useEffect(() => {
    toolRef.current = tool;
    // Cancel an in-progress wall start if the user switches away from addWall.
    if (tool !== 'addWall') {
      // Signal the canvas to cancel wall mode via a custom event.
      containerRef.current?.dispatchEvent(new CustomEvent('cancelWall'));
    }
  }, [tool]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Scene setup ──────────────────────────────────────────────────────────
    const W = container.clientWidth;
    const H = container.clientHeight;
    const aspect = W / H;
    const halfH  = INITIAL_VIEW_H / 2;

    const camera = new THREE.OrthographicCamera(
      -halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, 100
    );
    camera.position.set(0, 0, 10);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(C.BG);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    const canvas = renderer.domElement;

    buildGrid(scene);

    const wallGroup   = new THREE.Group();
    const vertGroup   = new THREE.Group();
    const previewGrp  = new THREE.Group();
    scene.add(wallGroup, vertGroup, previewGrp);

    // Preview line (wall tool).
    const prevGeo  = new THREE.BufferGeometry();
    prevGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0.05, 0,0,0.05], 3));
    const prevLine = new THREE.Line(prevGeo, new THREE.LineBasicMaterial({ color: C.WALL_PREVIEW, transparent: true, opacity: 0.75 }));
    prevLine.visible = false;
    previewGrp.add(prevLine);

    // ── Interaction state (all mutable, lives in the closure) ────────────────
    const vertMeshes = new Map();  // id -> Mesh
    const wallLines  = new Map();  // id -> Line
    let hovVtx  = null;   // hovered vertex id
    let hovWall = null;   // hovered wall id
    let wallStart = null; // first vertex selected in addWall mode
    let dragging  = null; // { id } – vertex being dragged
    let didDrag   = false;
    let panning   = false;
    let panOrigin = null; // { clientX, clientY, camX, camY }

    // ── Scene rebuild ────────────────────────────────────────────────────────
    function rebuildScene({ vertices, walls }) {
      // Vertices: remove stale, add new, update positions.
      for (const [id, mesh] of vertMeshes) {
        if (!vertices[id]) {
          vertGroup.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
          vertMeshes.delete(id);
        }
      }
      for (const [id, v] of Object.entries(vertices)) {
        if (vertMeshes.has(id)) {
          vertMeshes.get(id).position.set(v.x, v.y, 0.1);
        } else {
          const mesh = makeCircle(v.x, v.y, C.VERTEX);
          vertMeshes.set(id, mesh);
          vertGroup.add(mesh);
        }
      }

      // Walls: remove stale, add new, update positions.
      for (const [id, line] of wallLines) {
        if (!walls[id]) {
          wallGroup.remove(line);
          line.geometry.dispose();
          line.material.dispose();
          wallLines.delete(id);
        }
      }
      for (const [id, w] of Object.entries(walls)) {
        const v1 = vertices[w.v1], v2 = vertices[w.v2];
        if (!v1 || !v2) continue;
        if (wallLines.has(id)) {
          const pos = wallLines.get(id).geometry.attributes.position;
          pos.setXYZ(0, v1.x, v1.y, 0);
          pos.setXYZ(1, v2.x, v2.y, 0);
          pos.needsUpdate = true;
        } else {
          const line = makeWallLine(v1.x, v1.y, v2.x, v2.y, C.WALL);
          wallLines.set(id, line);
          wallGroup.add(line);
        }
      }
      refreshColors();
    }

    // ── Refresh mesh colors based on hover/select state ──────────────────────
    function refreshColors() {
      const t = toolRef.current;
      for (const [id, mesh] of vertMeshes) {
        let col;
        if (id === wallStart) {
          col = C.VERTEX_SELECTED;
        } else if (id === hovVtx) {
          col = t === 'delete' ? C.VERTEX_DEL_HOVER : C.VERTEX_HOVER;
        } else {
          col = C.VERTEX;
        }
        mesh.material.color.setHex(col);
      }
      for (const [id, line] of wallLines) {
        let col;
        if (id === hovWall) {
          col = t === 'delete' ? C.WALL_DEL_HOVER : C.WALL_HOVER;
        } else {
          col = C.WALL;
        }
        line.material.color.setHex(col);
      }
    }

    // ── Hit detection ────────────────────────────────────────────────────────
    function nearestVertex(wx, wy) {
      const { vertices } = useLevelStore.getState();
      let bestId = null, bestD = HIT_RADIUS;
      for (const [id, v] of Object.entries(vertices)) {
        const d = Math.hypot(wx - v.x, wy - v.y);
        if (d < bestD) { bestD = d; bestId = id; }
      }
      return bestId;
    }

    function nearestWall(wx, wy) {
      const { vertices, walls } = useLevelStore.getState();
      let bestId = null, bestD = WALL_HIT_DIST;
      for (const [id, w] of Object.entries(walls)) {
        const v1 = vertices[w.v1], v2 = vertices[w.v2];
        if (!v1 || !v2) continue;
        const d = ptSegDist(wx, wy, v1.x, v1.y, v2.x, v2.y);
        if (d < bestD) { bestD = d; bestId = id; }
      }
      return bestId;
    }

    // ── Preview line update ──────────────────────────────────────────────────
    function updatePreview(wx, wy) {
      if (wallStart && toolRef.current === 'addWall') {
        const { vertices } = useLevelStore.getState();
        const v = vertices[wallStart];
        if (v) {
          const pos = prevLine.geometry.attributes.position;
          pos.setXYZ(0, v.x, v.y, 0.05);
          pos.setXYZ(1, wx, wy, 0.05);
          pos.needsUpdate = true;
          prevLine.visible = true;
          return;
        }
      }
      prevLine.visible = false;
    }

    // ── Status text ──────────────────────────────────────────────────────────
    function emitStatus() {
      const t = toolRef.current;
      if (t === 'addVertex') { onStatus('Click to place a vertex'); return; }
      if (t === 'addWall') {
        onStatus(wallStart
          ? 'Click another vertex to complete wall  |  Esc to cancel'
          : 'Click a vertex to start a wall');
        return;
      }
      if (t === 'move')   { onStatus('Click and drag a vertex to move it'); return; }
      if (t === 'delete') { onStatus('Click a vertex or wall to delete it'); return; }
    }

    // Initial scene build.
    rebuildScene(useLevelStore.getState());
    emitStatus();

    // Subscribe to store changes.
    const unsub = useLevelStore.subscribe(state => {
      rebuildScene(state);
    });

    // ── Event handlers ───────────────────────────────────────────────────────
    function onMouseMove(e) {
      // Pan
      if (panning && panOrigin) {
        const frustW = camera.right - camera.left;
        const frustH = camera.top - camera.bottom;
        camera.position.x = panOrigin.camX - ((e.clientX - panOrigin.clientX) / W) * frustW;
        camera.position.y = panOrigin.camY + ((e.clientY - panOrigin.clientY) / H) * frustH;
        return;
      }

      const { x: wx, y: wy } = mouseToWorld(e, canvas, camera);

      // Vertex drag
      if (dragging) {
        didDrag = true;
        useLevelStore.getState().moveVertex(dragging.id, wx, wy);
        return;
      }

      // Hover detection
      const newHovVtx  = nearestVertex(wx, wy);
      const newHovWall = newHovVtx ? null : nearestWall(wx, wy);

      if (newHovVtx !== hovVtx || newHovWall !== hovWall) {
        hovVtx  = newHovVtx;
        hovWall = newHovWall;
        refreshColors();
      }

      updatePreview(wx, wy);
    }

    function onMouseDown(e) {
      // Right mouse = pan
      if (e.button === 2) {
        panning   = true;
        panOrigin = { clientX: e.clientX, clientY: e.clientY, camX: camera.position.x, camY: camera.position.y };
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;

      didDrag  = false;
      dragging = null;

      if (toolRef.current === 'move' && hovVtx) {
        dragging = { id: hovVtx };
      }
    }

    function onMouseUp(e) {
      if (e.button === 2) {
        panning   = false;
        panOrigin = null;
        return;
      }
      if (e.button !== 0) return;

      const wasDragging = dragging && didDrag;
      dragging = null;
      didDrag  = false;

      if (wasDragging) return; // suppress click after drag

      // ── Click actions ──
      const { x: wx, y: wy } = mouseToWorld(e, canvas, camera);
      const t = toolRef.current;

      if (t === 'addVertex') {
        useLevelStore.getState().addVertex(wx, wy);
        return;
      }

      if (t === 'addWall') {
        if (!wallStart) {
          if (hovVtx) {
            wallStart = hovVtx;
            refreshColors();
            updatePreview(wx, wy);
            emitStatus();
          }
        } else {
          if (hovVtx && hovVtx !== wallStart) {
            useLevelStore.getState().addWall(wallStart, hovVtx);
            wallStart = null;
            prevLine.visible = false;
            refreshColors();
            emitStatus();
          }
        }
        return;
      }

      if (t === 'delete') {
        if (hovVtx) {
          useLevelStore.getState().deleteVertex(hovVtx);
          hovVtx = null;
        } else if (hovWall) {
          useLevelStore.getState().deleteWall(hovWall);
          hovWall = null;
        }
        refreshColors();
        return;
      }
    }

    function onWheel(e) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.12 : 0.88;
      // Zoom toward mouse pointer
      const { x: wx, y: wy } = mouseToWorld(e, canvas, camera);
      camera.left   = wx + (camera.left   - wx) * factor;
      camera.right  = wx + (camera.right  - wx) * factor;
      camera.top    = wy + (camera.top    - wy) * factor;
      camera.bottom = wy + (camera.bottom - wy) * factor;
      camera.updateProjectionMatrix();
    }

    function onResize() {
      const nW = container.clientWidth;
      const nH = container.clientHeight;
      const nAspect  = nW / nH;
      const halfFrustH = (camera.top - camera.bottom) / 2;
      camera.left   = -halfFrustH * nAspect;
      camera.right  =  halfFrustH * nAspect;
      camera.updateProjectionMatrix();
      renderer.setSize(nW, nH);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        wallStart = null;
        prevLine.visible = false;
        refreshColors();
        emitStatus();
        return;
      }
      // Keyboard shortcuts for tools.
      const map = { v: 'addVertex', w: 'addWall', m: 'move', d: 'delete' };
      const next = map[e.key.toLowerCase()];
      if (next) onToolChange(next);
    }

    function onCancelWall() {
      wallStart = null;
      prevLine.visible = false;
      refreshColors();
      emitStatus();
    }

    // Prevent browser context menu on right-click.
    const noCtx = e => e.preventDefault();

    canvas.addEventListener('mousemove',   onMouseMove);
    canvas.addEventListener('mousedown',   onMouseDown);
    canvas.addEventListener('mouseup',     onMouseUp);
    canvas.addEventListener('wheel',       onWheel,  { passive: false });
    canvas.addEventListener('contextmenu', noCtx);
    window.addEventListener('keydown',     onKeyDown);
    window.addEventListener('resize',      onResize);
    container.addEventListener('cancelWall', onCancelWall);

    // ── Render loop ──────────────────────────────────────────────────────────
    let raf;
    (function animate() {
      raf = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    })();

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      canvas.removeEventListener('mousemove',   onMouseMove);
      canvas.removeEventListener('mousedown',   onMouseDown);
      canvas.removeEventListener('mouseup',     onMouseUp);
      canvas.removeEventListener('wheel',       onWheel);
      canvas.removeEventListener('contextmenu', noCtx);
      window.removeEventListener('keydown',     onKeyDown);
      window.removeEventListener('resize',      onResize);
      container.removeEventListener('cancelWall', onCancelWall);
      renderer.dispose();
      if (container.contains(canvas)) container.removeChild(canvas);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
