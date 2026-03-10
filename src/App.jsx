import { useState, useRef, useEffect } from 'react';
import LevelCanvas from './components/LevelCanvas.jsx';
import AuthModal from './components/AuthModal.jsx';
import LevelsPanel from './components/LevelsPanel.jsx';
import useLevelStore from './store/useLevelStore.js';
import { supabase } from './lib/supabase.js';

const TOOLS = [
  { id: 'addVertex', label: 'Add Vertex', key: 'V' },
  { id: 'addLine',   label: 'Add Line',   key: 'W' },
  { id: 'move',      label: 'Move',       key: 'M' },
  { id: 'delete',    label: 'Delete',     key: 'D' },
];

const TOOL_COLORS = {
  addVertex: '#00e5ff',
  addLine:   '#69f0ae',
  move:      '#ffeb3b',
  delete:    '#ff5252',
};

export default function App() {
  const [tool, setTool]                 = useState('addVertex');
  const [snap, setSnap]                 = useState(false);
  const [snapX, setSnapX]               = useState(1);
  const [snapY, setSnapY]               = useState(1);
  const [status, setStatus]             = useState('Click to place a vertex');
  const [user, setUser]                 = useState(null);
  const [showAuth, setShowAuth]         = useState(false);
  const [showPanel, setShowPanel]       = useState(false);
  const [currentLevel, setCurrentLevel] = useState(null); // { id, name } | null
  const fileInputRef                    = useRef(null);
  const { clearLevel, loadLevel }       = useLevelStore();
  const canUndo = useLevelStore(s => s.history.length > 0);
  const canRedo = useLevelStore(s => s.future.length  > 0);

  // Auth state listener.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) { setShowPanel(false); setCurrentLevel(null); }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  // ── Local JSON export / import ───────────────────────────────────────────────
  function handleExportJSON() {
    const { vertices, lines } = useLevelStore.getState();
    const data = JSON.stringify({ version: 1, vertices, lines }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${currentLevel?.name ?? 'level'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        loadLevel(JSON.parse(ev.target.result));
        setCurrentLevel(null);
      } catch {
        alert('Invalid level file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleNew() {
    if (confirm('Clear the current level?')) {
      clearLevel();
      setCurrentLevel(null);
    }
  }

  return (
    <div style={styles.root}>
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={styles.toolbar}>
        <span style={styles.appTitle}>Level Maker</span>

        {/* Drawing tools */}
        <div style={styles.toolGroup}>
          {TOOLS.map(t => (
            <button
              key={t.id}
              style={{
                ...styles.toolBtn,
                ...(tool === t.id ? { background: TOOL_COLORS[t.id], color: '#111', fontWeight: 700 } : {}),
              }}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${t.key})`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Snap to grid */}
        <div style={styles.toolGroup}>
          <button
            style={{
              ...styles.toolBtn,
              ...(snap ? { background: '#4db6ac', color: '#111', fontWeight: 700 } : {}),
            }}
            onClick={() => setSnap(v => !v)}
            title="Snap to Grid (G)"
          >
            Snap
          </button>
          <input
            type="number"
            min="0.125"
            step="0.125"
            value={snapX}
            onChange={e => { const v = parseFloat(e.target.value); if (v > 0) setSnapX(v); }}
            style={styles.snapInput}
            title="Snap X resolution"
          />
          <span style={{ color: '#606080', fontSize: 11 }}>×</span>
          <input
            type="number"
            min="0.125"
            step="0.125"
            value={snapY}
            onChange={e => { const v = parseFloat(e.target.value); if (v > 0) setSnapY(v); }}
            style={styles.snapInput}
            title="Snap Y resolution"
          />
        </div>

        {/* Undo / Redo */}
        <div style={styles.toolGroup}>
          <button style={styles.actionBtn} disabled={!canUndo} onClick={() => useLevelStore.getState().undo()} title="Undo (Ctrl+Z)">Undo</button>
          <button style={styles.actionBtn} disabled={!canRedo} onClick={() => useLevelStore.getState().redo()} title="Redo (Ctrl+Y)">Redo</button>
        </div>

        {/* File actions */}
        <div style={styles.toolGroup}>
          <button style={styles.actionBtn} onClick={handleNew}>New</button>
          <button style={styles.actionBtn} onClick={handleExportJSON}>Export JSON</button>
          <button style={styles.actionBtn} onClick={() => fileInputRef.current.click()}>Import JSON</button>
          <input ref={fileInputRef} type="file" accept=".json" style={{ display:'none' }} onChange={handleImportJSON} />
        </div>

        {/* Cloud / auth */}
        <div style={{ ...styles.toolGroup, marginLeft: 'auto' }}>
          {user ? (
            <>
              <button
                style={{ ...styles.cloudBtn, ...(showPanel ? styles.cloudBtnActive : {}) }}
                onClick={() => setShowPanel(v => !v)}
                title="Cloud Levels"
              >
                ☁ Cloud
                {currentLevel && <span style={styles.levelBadge}>{currentLevel.name}</span>}
              </button>
              <span style={styles.userEmail}>{user.email}</span>
              <button style={styles.actionBtn} onClick={handleSignOut}>Sign Out</button>
            </>
          ) : (
            <button style={styles.signInBtn} onClick={() => setShowAuth(true)}>
              Sign In to Cloud
            </button>
          )}
        </div>
      </div>

      {/* ── Canvas area ─────────────────────────────────────────────────────── */}
      <div style={styles.canvasWrap}>
        <LevelCanvas tool={tool} snap={snap} snapX={snapX} snapY={snapY} onStatus={setStatus} onToolChange={setTool} onSnapChange={setSnap} />
        {showPanel && user && (
          <LevelsPanel
            onClose={() => setShowPanel(false)}
            currentLevel={currentLevel}
            setCurrentLevel={setCurrentLevel}
          />
        )}
      </div>

      {/* ── Status bar ──────────────────────────────────────────────────────── */}
      <div style={styles.statusBar}>
        <span style={{ color: TOOL_COLORS[tool], fontWeight: 600, marginRight: 8 }}>
          [{TOOLS.find(t => t.id === tool)?.label}]
        </span>
        {status}
        <span style={styles.hint}>&nbsp;&nbsp;Scroll to zoom &nbsp;|&nbsp; Right-drag to pan &nbsp;|&nbsp; G = snap &nbsp;|&nbsp; Esc to cancel</span>
      </div>

      {/* ── Auth modal ──────────────────────────────────────────────────────── */}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    background: '#12122a',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '6px 12px',
    background: '#1e1e3f',
    borderBottom: '1px solid #2d2d60',
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  appTitle: {
    fontWeight: 700,
    fontSize: 16,
    color: '#7c7cff',
    marginRight: 4,
    letterSpacing: 1,
  },
  toolGroup: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  },
  toolBtn: {
    padding: '4px 14px',
    background: '#2a2a50',
    color: '#c0c0e0',
    border: '1px solid #3a3a70',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    transition: 'all 0.15s',
  },
  actionBtn: {
    padding: '4px 12px',
    background: '#252545',
    color: '#a0a0c0',
    border: '1px solid #35355a',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
  },
  cloudBtn: {
    padding: '4px 12px',
    background: '#1e3050',
    color: '#64b5f6',
    border: '1px solid #2a4a80',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  cloudBtnActive: {
    background: '#2a4878',
    borderColor: '#4488cc',
  },
  levelBadge: {
    fontSize: 11,
    color: '#90caf9',
    background: '#1a3060',
    padding: '1px 6px',
    borderRadius: 10,
    maxWidth: 120,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  signInBtn: {
    padding: '4px 14px',
    background: '#30306a',
    color: '#a0a0ff',
    border: '1px solid #4444a0',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
  },
  userEmail: {
    fontSize: 11,
    color: '#606080',
    maxWidth: 160,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  canvasWrap: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  statusBar: {
    padding: '4px 12px',
    background: '#1e1e3f',
    borderTop: '1px solid #2d2d60',
    fontSize: 12,
    color: '#a0a0c0',
    flexShrink: 0,
  },
  hint: {
    opacity: 0.5,
    fontSize: 11,
  },
  snapInput: {
    width: 54,
    padding: '3px 6px',
    background: '#1a1a38',
    color: '#c0c0e0',
    border: '1px solid #3a3a70',
    borderRadius: 4,
    fontSize: 13,
    textAlign: 'right',
  },
};
