import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

export default function AuthModal({ onClose }) {
  const [mode, setMode]         = useState('signin');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [message, setMessage]   = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setMessage('Check your email to confirm your account, then sign in.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else onClose();
    }

    setLoading(false);
  }

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        <button style={s.closeBtn} onClick={onClose}>×</button>
        <h2 style={s.title}>{mode === 'signin' ? 'Sign In' : 'Create Account'}</h2>

        <form onSubmit={handleSubmit} style={s.form}>
          <input
            style={s.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoFocus
            required
          />
          <input
            style={s.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          {error   && <div style={s.error}>{error}</div>}
          {message && <div style={s.success}>{message}</div>}
          <button style={s.submitBtn} type="submit" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <div style={s.toggle}>
          {mode === 'signin' ? (
            <>No account?{' '}
              <button style={s.link} onClick={() => { setMode('signup'); setError(null); setMessage(null); }}>
                Sign up
              </button>
            </>
          ) : (
            <>Have an account?{' '}
              <button style={s.link} onClick={() => { setMode('signin'); setError(null); setMessage(null); }}>
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay:   { position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 },
  modal:     { background:'#1e1e3f', border:'1px solid #3a3a70', borderRadius:8, padding:'32px 28px', width:320, position:'relative' },
  closeBtn:  { position:'absolute', top:10, right:14, background:'none', border:'none', color:'#606090', fontSize:22, cursor:'pointer', lineHeight:1 },
  title:     { color:'#7c7cff', fontSize:17, fontWeight:700, marginBottom:20 },
  form:      { display:'flex', flexDirection:'column', gap:10 },
  input:     { padding:'8px 10px', background:'#12122a', border:'1px solid #3a3a70', borderRadius:4, color:'#e0e0e0', fontSize:14, outline:'none' },
  error:     { color:'#ff5252', fontSize:12 },
  success:   { color:'#69f0ae', fontSize:12 },
  submitBtn: { padding:'8px 0', background:'#4444b0', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontSize:14, fontWeight:600 },
  toggle:    { marginTop:16, fontSize:12, color:'#707090', textAlign:'center' },
  link:      { background:'none', border:'none', color:'#7c7cff', cursor:'pointer', fontSize:12, textDecoration:'underline' },
};
