import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signIn } from 'aws-amplify/auth';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (import.meta.env.VITE_USE_MOCK === "true") {
        setTimeout(() => {
          onLogin(email);
          navigate('/dashboard');
        }, 500);
      } else {
        await signIn({ username: email, password });
        onLogin(email);
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err.message || 'Error signing in');
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-xl shadow border border-gray-100 p-8">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-6">AURA Login</h2>
        {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                   className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-gray-900" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                   className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-gray-900" />
          </div>
          <button type="submit" disabled={loading}
                  className="w-full py-2 px-4 shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none disabled:opacity-50">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
