import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';

export default function Login({ supabase, onAuthed }) {
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  const title = useMemo(() => (authMode === 'login' ? 'Authenticate' : 'Request Access'), [authMode]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      let error;
      if (authMode === 'login') {
        ({ error } = await supabase.auth.signInWithPassword({ email, password }));
      } else {
        ({ error } = await supabase.auth.signUp({ email, password }));
      }
      if (error) throw error;
      if (onAuthed) onAuthed();
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="vault-bg h-full w-full flex items-center justify-center px-6">
      <div className="absolute inset-0 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="relative w-full max-w-md"
      >
        <div className="rounded-2xl border border-neutral-800 bg-space-900/80 backdrop-blur-xl shadow-glow p-7">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-neon-yellow to-neon-green grid place-items-center text-space-950 font-bold">
                NQ
              </div>
              <div>
                <div className="text-[11px] tracking-[0.28em] text-neutral-400">NEXUS QUANT</div>
                <div className="text-sm font-semibold text-neutral-100">Institutional Access Control</div>
              </div>
            </div>
            <div className="text-[10px] font-mono text-neutral-500 tracking-widest">
              VAULT
            </div>
          </div>

          <div className="mt-6">
            <div className="text-lg font-semibold text-neutral-100">{title}</div>
            <div className="mt-1 text-sm text-neutral-400">
              Secure session handshake to the trading terminal.
            </div>
          </div>

          <form onSubmit={handleAuth} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label className="text-[11px] tracking-widest text-neutral-400">EMAIL</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alias@node.io"
                className="w-full rounded-xl bg-space-950/60 border border-neutral-800 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none transition-all duration-200 focus:border-neon-green/60 focus:ring-2 focus:ring-neon-green/30"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[11px] tracking-widest text-neutral-400">PASSPHRASE</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl bg-space-950/60 border border-neutral-800 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none transition-all duration-200 focus:border-neon-green/60 focus:ring-2 focus:ring-neon-green/30"
              />
            </div>

            {authError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {authError}
              </div>
            ) : null}

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.99 }}
              type="submit"
              disabled={authLoading}
              className="w-full rounded-xl bg-neon-green text-space-950 font-semibold py-3 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_0_0_1px_rgba(0,255,163,0.25),0_18px_50px_rgba(0,0,0,0.55)] hover:shadow-[0_0_0_1px_rgba(0,255,163,0.35),0_22px_70px_rgba(0,0,0,0.65)]"
            >
              {authLoading ? 'Establishing…' : title}
            </motion.button>
          </form>

          <div className="mt-5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login');
                setAuthError(null);
              }}
              className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              {authMode === 'login' ? 'No account? Request access' : 'Already verified? Authenticate'}
            </button>
            <div className="text-[10px] font-mono text-neutral-600 tracking-widest">v2.2</div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

