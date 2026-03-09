import { useState, useRef } from 'react';
import LevelCanvas from './components/LevelCanvas.jsx';
import useLevelStore from './store/useLevelStore.js';

const TOOLS = [
  { id: 'addVertex', label: 'Add Vertex', key: 'V' },
  { id: 'addWall',   label: 'Add Wall',   key: 'W' },
  { id: 'move',      label: 'Move',       key: 'M' },
  { id: 'delete',    label: 'Delete',     key: 'D' },
];

const TOOL_COLORS = {
  addVertex: '#00e5ff',
  addWall:   '#69f0ae',
  move:      '#ffeb3b',
  delete:    '#ff5252',
};

export default function App() {
  const [tool, setTool] = useState('addVertex');
  const [status, setStatus] = useState('Click to place a vertex');
  const fileInputRef = useRef(null);
  const { clearLevel, loadLevel } = useLevelStore();

  function handleSave() {
    const { vertices, walls } = useLevelStore.getState();
    const data = JSON.stringify({ vertices, walls }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'level.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        loadLevel(data);
      } catch {
        alert('Invalid level file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleNew() {
    if (confirm('Clear the current level?')) clearLevel();
  }

  return (
    <div style={styles.root}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <span style={styles.appTitle}>Level Maker</span>

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

        <div style={styles.toolGroup}>
          <button style={styles.actionBtn} onClick={handleNew}>New</button>
          <button style={styles.actionBtn} onClick={handleSave}>Save JSON</button>
          <button style={styles.actionBtn} onClick={() => fileInputRef.current.click()}>Load JSON</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleLoad}
          />
        </div>
      </div>

      {/* Canvas */}
      <div style={styles.canvasWrap}>
        <LevelCanvas tool={tool} onStatus={setStatus} onToolChange={setTool} />
      </div>

      {/* Status bar */}
      <div style={styles.statusBar}>
        <span style={{ color: TOOL_COLORS[tool], fontWeight: 600, marginRight: 8 }}>
          [{TOOLS.find(t => t.id === tool)?.label}]
        </span>
        {status}
        <span style={styles.hint}>&nbsp;&nbsp;Scroll to zoom &nbsp;|&nbsp; Right-drag to pan &nbsp;|&nbsp; Esc to cancel</span>
      </div>
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
    gap: 16,
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
    marginRight: 8,
    letterSpacing: 1,
  },
  toolGroup: {
    display: 'flex',
    gap: 6,
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
    padding: '4px 14px',
    background: '#252545',
    color: '#a0a0c0',
    border: '1px solid #35355a',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
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
};
