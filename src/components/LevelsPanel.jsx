import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import useLevelStore from '../store/useLevelStore.js';

export default function LevelsPanel({ onClose, currentLevel, setCurrentLevel }) {
  const [levels, setLevels]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saveName, setSaveName] = useState(currentLevel?.name ?? '');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);

  const fetchLevels = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('levels')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setLevels(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchLevels(); }, [fetchLevels]);

  // Keep name input in sync when a level is loaded externally.
  useEffect(() => { if (currentLevel?.name) setSaveName(currentLevel.name); }, [currentLevel]);

  async function handleSave() {
    const name = saveName.trim();
    if (!name) return;
    setSaving(true);
    setError(null);

    const { vertices, lines } = useLevelStore.getState();
    const payload = { name, data: { version: 1, vertices, lines } };

    let result;
    if (currentLevel && name === currentLevel.name) {
      // Overwrite the record we loaded.
      result = await supabase
        .from('levels')
        .update(payload)
        .eq('id', currentLevel.id)
        .select('id, name')
        .single();
    } else {
      result = await supabase
        .from('levels')
        .insert(payload)
        .select('id, name')
        .single();
    }

    if (result.error) {
      setError(result.error.message);
    } else {
      setCurrentLevel({ id: result.data.id, name: result.data.name });
      await fetchLevels();
    }
    setSaving(false);
  }

  async function handleLoad(lvl) {
    const { data, error } = await supabase
      .from('levels')
      .select('id, name, data')
      .eq('id', lvl.id)
      .single();
    if (error) { setError(error.message); return; }
    useLevelStore.getState().loadLevel(data.data);
    setCurrentLevel({ id: data.id, name: data.name });
    setSaveName(data.name);
    onClose();
  }

  async function handleDelete(lvl) {
    if (!confirm(`Delete "${lvl.name}"?`)) return;
    const { error } = await supabase.from('levels').delete().eq('id', lvl.id);
    if (error) { setError(error.message); return; }
    if (currentLevel?.id === lvl.id) setCurrentLevel(null);
    await fetchLevels();
  }

  return (
    <div style={s.panel}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.title}>Cloud Levels</span>
        <button style={s.closeBtn} onClick={onClose}>×</button>
      </div>

      {/* Save section */}
      <div style={s.saveSection}>
        <div style={s.sectionLabel}>Save current level</div>
        <div style={s.saveRow}>
          <input
            style={s.input}
            placeholder="Level name…"
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <button
            style={{ ...s.saveBtn, opacity: (!saveName.trim() || saving) ? 0.5 : 1 }}
            onClick={handleSave}
            disabled={saving || !saveName.trim()}
          >
            {saving ? '…' : currentLevel && saveName.trim() === currentLevel.name ? 'Overwrite' : 'Save New'}
          </button>
        </div>
        {error && <div style={s.error}>{error}</div>}
      </div>

      {/* Level list */}
      <div style={s.sectionLabel}>Saved levels</div>
      <div style={s.list}>
        {loading && <div style={s.dim}>Loading…</div>}
        {!loading && levels.length === 0 && <div style={s.dim}>No saved levels yet.</div>}
        {levels.map(lvl => (
          <div
            key={lvl.id}
            style={{ ...s.row, ...(currentLevel?.id === lvl.id ? s.rowActive : {}) }}
          >
            <div style={s.rowInfo}>
              <div style={s.rowName}>{lvl.name}</div>
              <div style={s.rowDate}>{new Date(lvl.created_at).toLocaleString()}</div>
            </div>
            <div style={s.rowActions}>
              <button style={s.actionBtn} onClick={() => handleLoad(lvl)}>Load</button>
              <button style={{ ...s.actionBtn, color: '#ff5252' }} onClick={() => handleDelete(lvl)}>Del</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const s = {
  panel:       { position:'absolute', top:0, right:0, width:290, height:'100%', background:'#1a1a38', borderLeft:'1px solid #2d2d60', display:'flex', flexDirection:'column', zIndex:50, boxShadow:'-4px 0 20px rgba(0,0,0,0.4)' },
  header:      { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', borderBottom:'1px solid #2d2d60', flexShrink:0 },
  title:       { color:'#7c7cff', fontWeight:700, fontSize:14, letterSpacing:0.5 },
  closeBtn:    { background:'none', border:'none', color:'#606090', fontSize:22, cursor:'pointer', lineHeight:1 },
  saveSection: { padding:'10px 14px 12px', borderBottom:'1px solid #2d2d60', flexShrink:0 },
  sectionLabel:{ color:'#505078', fontSize:11, textTransform:'uppercase', letterSpacing:1, padding:'8px 14px 4px', flexShrink:0 },
  saveRow:     { display:'flex', gap:6 },
  input:       { flex:1, padding:'5px 8px', background:'#12122a', border:'1px solid #3a3a70', borderRadius:4, color:'#e0e0e0', fontSize:13, outline:'none' },
  saveBtn:     { padding:'5px 12px', background:'#4444b0', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontSize:13, fontWeight:600, flexShrink:0 },
  error:       { color:'#ff5252', fontSize:11, marginTop:6 },
  list:        { flex:1, overflowY:'auto' },
  dim:         { color:'#505070', fontSize:13, padding:'16px 14px' },
  row:         { display:'flex', alignItems:'center', gap:8, padding:'8px 14px', borderBottom:'1px solid #1e1e40' },
  rowActive:   { background:'#22224a' },
  rowInfo:     { flex:1, overflow:'hidden' },
  rowName:     { color:'#c0c0e0', fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  rowDate:     { color:'#404060', fontSize:11, marginTop:2 },
  rowActions:  { display:'flex', gap:4, flexShrink:0 },
  actionBtn:   { padding:'3px 8px', background:'#252550', border:'1px solid #3a3a70', borderRadius:3, color:'#a0a0c0', cursor:'pointer', fontSize:12 },
};
