import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import { Amplify } from 'aws-amplify';
import { signOut } from 'aws-amplify/auth';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || ''
    }
  }
});

function App() {
  const [user, setUser] = useState(null);

  const handleLogout = async () => {
    if (import.meta.env.VITE_USE_MOCK !== "true") {
      try { await signOut(); } catch (e) { console.error(e); }
    }
    setUser(null);
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Login onLogin={(email) => setUser(email)} />} />
        <Route path="/dashboard" element={
          user || import.meta.env.VITE_USE_MOCK === "true" ? 
            <Dashboard userEmail={user || 'admin@aura.demo'} onLogout={handleLogout} /> 
            : <Navigate to="/login" replace />
        } />
      </Routes>
    </BrowserRouter>
  );
}
export default App;
