import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import useLevelStore from '../store/useLevelStore.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const VERTEX_RADIUS  = 0.25;
const HIT_RADIUS     = 0.55;   // world-unit radius for vertex click
const LINE_HIT_DIST  = 0.3;    // world-unit distance to line for click
const INITIAL_VIEW_H = 24;     // initial frustum height in world units

const C = {
  BG:                0x12122a,
  GRID_MINOR:        0x1e1e40,
  GRID_MAJOR:        0x2a2a58,
  VERTEX:            0x00e5ff,
  VERTEX_HOVER:      0xffeb3b,
  VERTEX_SELECTED:   0xff9800,  // line-start selected
  VERTEX_DEL_HOVER:  0xff1744,
  LINE:              0x7986cb,
  LINE_HOVER:        0xff9800,
  LINE_DEL_HOVER:    0xff1744,
  LINE_PREVIEW:      0x4db6ac,
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

function makeLine(x1, y1, x2, y2, color) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([x1, y1, 0, x2, y2, 0], 3));
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
}

function snapCoord(x, y, enabled, gridX = 1, gridY = 1) {
  if (!enabled) return { x, y };
  return {
    x: Math.round(x / gridX) * gridX,
    y: Math.round(y / gridY) * gridY,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function LevelCanvas({ tool, snap, snapX, snapY, onStatus, onToolChange, onSnapChange }) {
  const containerRef = useRef(null);
  const toolRef      = useRef(tool);
  const snapRef      = useRef(snap);
  const snapXRef     = useRef(snapX);
  const snapYRef     = useRef(snapY);

  // Keep refs in sync so the Three.js closure always reads current values.
  useEffect(() => { snapRef.current = snap; }, [snap]);
  useEffect(() => { snapXRef.current = snapX; }, [snapX]);
  useEffect(() => { snapYRef.current = snapY; }, [snapY]);

  useEffect(() => {
    toolRef.current = tool;
    // Cancel an in-progress line start if the user switches away from addLine.
    if (tool !== 'addLine') {
      containerRef.current?.dispatchEvent(new CustomEvent('cancelLine'));
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

    const lineGroup  = new THREE.Group();
    const vertGroup  = new THREE.Group();
    const previewGrp = new THREE.Group();
    scene.add(lineGroup, vertGroup, previewGrp);

    // Preview line (add line tool).
    const prevGeo  = new THREE.BufferGeometry();
    prevGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0.05, 0,0,0.05], 3));
    const prevLine = new THREE.Line(prevGeo, new THREE.LineBasicMaterial({ color: C.LINE_PREVIEW, transparent: true, opacity: 0.75 }));
    prevLine.visible = false;
    previewGrp.add(prevLine);

    // ── Interaction state (all mutable, lives in the closure) ────────────────
    const vertMeshes = new Map();  // id -> Mesh
    const lineMeshes = new Map();  // id -> Line
    let hovVtx       = null;   // hovered vertex id
    let hovLine      = null;   // hovered line id
    let lineStart    = null;   // first vertex selected in addLine mode
    let dragging     = null;   // { id } – vertex being dragged
    let draggingLine = null;   // { id, v1id, v2id, grabX, grabY, origV1x, origV1y, origV2x, origV2y }
    let didDrag      = false;
    let panning      = false;
    let panOrigin    = null;   // { clientX, clientY, camX, camY }

    // ── Scene rebuild ────────────────────────────────────────────────────────
    function rebuildScene({ vertices, lines }) {
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

      // Lines: remove stale, add new, update positions.
      for (const [id, mesh] of lineMeshes) {
        if (!lines[id]) {
          lineGroup.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
          lineMeshes.delete(id);
        }
      }
      for (const [id, w] of Object.entries(lines)) {
        const v1 = vertices[w.v1], v2 = vertices[w.v2];
        if (!v1 || !v2) continue;
        if (lineMeshes.has(id)) {
          const pos = lineMeshes.get(id).geometry.attributes.position;
          pos.setXYZ(0, v1.x, v1.y, 0);
          pos.setXYZ(1, v2.x, v2.y, 0);
          pos.needsUpdate = true;
        } else {
          const mesh = makeLine(v1.x, v1.y, v2.x, v2.y, C.LINE);
          lineMeshes.set(id, mesh);
          lineGroup.add(mesh);
        }
      }
      refreshColors();
    }

    // ── Refresh mesh colors based on hover/select state ──────────────────────
    function refreshColors() {
      const t = toolRef.current;
      for (const [id, mesh] of vertMeshes) {
        let col;
        if (id === lineStart) {
          col = C.VERTEX_SELECTED;
        } else if (id === hovVtx) {
          col = t === 'delete' ? C.VERTEX_DEL_HOVER : C.VERTEX_HOVER;
        } else {
          col = C.VERTEX;
        }
        mesh.material.color.setHex(col);
      }
      for (const [id, mesh] of lineMeshes) {
        let col;
        if (id === hovLine) {
          col = t === 'delete' ? C.LINE_DEL_HOVER : C.LINE_HOVER;
        } else {
          col = C.LINE;
        }
        mesh.material.color.setHex(col);
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

    function nearestLine(wx, wy) {
      const { vertices, lines } = useLevelStore.getState();
      let bestId = null, bestD = LINE_HIT_DIST;
      for (const [id, w] of Object.entries(lines)) {
        const v1 = vertices[w.v1], v2 = vertices[w.v2];
        if (!v1 || !v2) continue;
        const d = ptSegDist(wx, wy, v1.x, v1.y, v2.x, v2.y);
        if (d < bestD) { bestD = d; bestId = id; }
      }
      return bestId;
    }

    // ── Preview line update ──────────────────────────────────────────────────
    function updatePreview(wx, wy) {
      if (lineStart && toolRef.current === 'addLine') {
        const { vertices } = useLevelStore.getState();
        const v = vertices[lineStart];
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
      if (t === 'addLine') {
        onStatus(lineStart
          ? 'Click another vertex to complete line  |  Esc to cancel'
          : 'Click a vertex to start a line');
        return;
      }
      if (t === 'move')   { onStatus('Click and drag a vertex or line to move it'); return; }
      if (t === 'delete') { onStatus('Click a vertex or line to delete it'); return; }
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
        const snapped = snapCoord(wx, wy, snapRef.current, snapXRef.current, snapYRef.current);
        useLevelStore.getState().moveVertex(dragging.id, snapped.x, snapped.y);
        return;
      }

      // Line drag — translate both endpoints by the grab delta
      if (draggingLine) {
        didDrag = true;
        const dx = wx - draggingLine.grabX;
        const dy = wy - draggingLine.grabY;
        const store = useLevelStore.getState();
        const s1 = snapCoord(draggingLine.origV1x + dx, draggingLine.origV1y + dy, snapRef.current, snapXRef.current, snapYRef.current);
        const s2 = snapCoord(draggingLine.origV2x + dx, draggingLine.origV2y + dy, snapRef.current, snapXRef.current, snapYRef.current);
        store.moveVertex(draggingLine.v1id, s1.x, s1.y);
        store.moveVertex(draggingLine.v2id, s2.x, s2.y);
        return;
      }

      // Hover detection
      const newHovVtx  = nearestVertex(wx, wy);
      const newHovLine = newHovVtx ? null : nearestLine(wx, wy);

      if (newHovVtx !== hovVtx || newHovLine !== hovLine) {
        hovVtx  = newHovVtx;
        hovLine = newHovLine;
        refreshColors();
      }

      const sp = snapCoord(wx, wy, snapRef.current, snapXRef.current, snapYRef.current);
      updatePreview(sp.x, sp.y);
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

      didDrag      = false;
      dragging     = null;
      draggingLine = null;

      if ((toolRef.current === 'move' || toolRef.current === 'addVertex') && hovVtx) {
        useLevelStore.getState().beginMove();
        dragging = { id: hovVtx };
      } else if (toolRef.current === 'move' && hovLine) {
        const { vertices, lines } = useLevelStore.getState();
        const w  = lines[hovLine];
        const { x: grabX, y: grabY } = mouseToWorld(e, canvas, camera);

        if (e.ctrlKey) {
          // Extrude: atomic compound action saves history once.
          const result = useLevelStore.getState().extrudeLine(hovLine);
          draggingLine = { v1id: result.n1id, v2id: result.n2id,
            grabX, grabY, origV1x: result.origV1x, origV1y: result.origV1y,
            origV2x: result.origV2x, origV2y: result.origV2y };
        } else {
          const v1 = vertices[w.v1], v2 = vertices[w.v2];
          useLevelStore.getState().beginMove();
          draggingLine = { id: hovLine, v1id: w.v1, v2id: w.v2,
            grabX, grabY, origV1x: v1.x, origV1y: v1.y, origV2x: v2.x, origV2y: v2.y };
        }
      }
    }

    function onMouseUp(e) {
      if (e.button === 2) {
        panning   = false;
        panOrigin = null;
        return;
      }
      if (e.button !== 0) return;

      const wasDragging = (dragging || draggingLine) && didDrag;
      dragging     = null;
      draggingLine = null;
      didDrag      = false;

      if (wasDragging) return; // suppress click after drag

      // ── Click actions ──
      const raw = mouseToWorld(e, canvas, camera);
      const { x: wx, y: wy } = snapCoord(raw.x, raw.y, snapRef.current, snapXRef.current, snapYRef.current);
      const t = toolRef.current;

      if (t === 'addVertex') {
        if (hovVtx) return; // clicked an existing vertex without dragging — ignore
        // Check for a line hit first so split is one atomic history entry.
        const { vertices, lines } = useLevelStore.getState();
        let split = false;
        for (const [lineId, w] of Object.entries(lines)) {
          const v1 = vertices[w.v1], v2 = vertices[w.v2];
          if (!v1 || !v2) continue;
          if (Math.hypot(wx - v1.x, wy - v1.y) < 0.01) continue;
          if (Math.hypot(wx - v2.x, wy - v2.y) < 0.01) continue;
          if (ptSegDist(wx, wy, v1.x, v1.y, v2.x, v2.y) < LINE_HIT_DIST) {
            useLevelStore.getState().splitLine(lineId, wx, wy);
            split = true;
            break;
          }
        }
        if (!split) useLevelStore.getState().addVertex(wx, wy);
        return;
      }

      if (t === 'addLine') {
        if (!lineStart) {
          // Start from an existing vertex or place a new one.
          const startId = hovVtx ?? useLevelStore.getState().addVertex(wx, wy);
          lineStart = startId;
          refreshColors();
          updatePreview(wx, wy);
          emitStatus();
        } else {
          if (hovVtx === lineStart) return; // same vertex — ignore
          if (hovVtx) {
            // Complete line to existing vertex; stop drawing.
            useLevelStore.getState().addLine(lineStart, hovVtx);
            lineStart = null;
            prevLine.visible = false;
          } else {
            // Place a new vertex, complete line to it, keep drawing from there.
            const newId = useLevelStore.getState().addVertexAndLine(lineStart, wx, wy);
            lineStart = newId;
            updatePreview(wx, wy);
          }
          refreshColors();
          emitStatus();
        }
        return;
      }

      if (t === 'delete') {
        if (hovVtx) {
          useLevelStore.getState().deleteVertex(hovVtx);
          hovVtx = null;
        } else if (hovLine) {
          useLevelStore.getState().deleteLine(hovLine);
          hovLine = null;
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
        lineStart = null;
        prevLine.visible = false;
        refreshColors();
        emitStatus();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        useLevelStore.getState().undo();
        return;
      }
      if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        useLevelStore.getState().redo();
        return;
      }
      if (e.ctrlKey) return; // don't fire tool shortcuts with ctrl held
      // Keyboard shortcuts for tools.
      const map = { v: 'addVertex', w: 'addLine', m: 'move', d: 'delete' };
      const next = map[e.key.toLowerCase()];
      if (next) { onToolChange(next); return; }
      if (e.key.toLowerCase() === 'g') onSnapChange(v => !v);
    }

    function onCancelLine() {
      lineStart = null;
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
    container.addEventListener('cancelLine', onCancelLine);

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
      container.removeEventListener('cancelLine', onCancelLine);
      renderer.dispose();
      if (container.contains(canvas)) container.removeChild(canvas);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
