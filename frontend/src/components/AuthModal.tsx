import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { LogIn, UserPlus, X, Loader2 } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

export const AuthModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  
  const { login, register, isLoading, error } = useStore();
  const modalRef = useFocusTrap(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLogin) {
      await login(email, password);
    } else {
      await register(email, password, name);
    }
  };

  const { auth } = useStore();
  if (auth.isAuthenticated) {
    onClose();
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        className="w-full max-w-md rounded-xl border border-white/10 bg-[#0a0a0a] p-8 shadow-2xl"
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 id="auth-modal-title" className="text-2xl font-bold text-white">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h2>
          <button data-close onClick={onClose} className="text-white/40 hover:text-white" aria-label="Close authentication dialog">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {!isLogin && (
            <div>
              <label htmlFor="auth-name" className="mb-1 block text-sm text-white/60">Name</label>
              <input
                id="auth-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-white focus:border-cyan-500 focus:outline-none"
                placeholder="John Doe"
                autoComplete="name"
              />
            </div>
          )}
          <div>
            <label htmlFor="auth-email" className="mb-1 block text-sm text-white/60">Email</label>
            <input
              id="auth-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-white focus:border-cyan-500 focus:outline-none"
              placeholder="you@example.com"
              autoComplete="email"
              aria-describedby={error ? 'auth-error' : undefined}
            />
          </div>
          <div>
            <label htmlFor="auth-password" className="mb-1 block text-sm text-white/60">Password</label>
            <input
              id="auth-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-white focus:border-cyan-500 focus:outline-none"
              placeholder="••••••••"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <p id="auth-error" className="text-sm text-red-400" role="alert">{error}</p>}

          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 py-3 font-semibold text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            aria-busy={isLoading}
          >
            {isLoading ? (
              <Loader2 className="animate-spin" size={20} />
            ) : isLogin ? (
              <>
                <LogIn size={20} /> Sign In
              </>
            ) : (
              <>
                <UserPlus size={20} /> Create Account
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm text-cyan-500 hover:underline"
          >
            {isLogin ? "Don't have an account? Register" : 'Already have an account? Login'}
          </button>
        </div>
      </div>
    </div>
  );
};
