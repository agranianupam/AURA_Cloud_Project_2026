import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './layout/Layout';
import Overview from './pages/Overview';
import Forecast from './pages/Forecast';
import Allocation from './pages/Allocation';
import CarbonEnergy from './pages/CarbonEnergy';
import Alerts from './pages/Alerts';
import Architecture from './pages/Architecture';
import Simulator from './pages/Simulator';
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

  const allowed = user || import.meta.env.VITE_USE_MOCK === "true" || import.meta.env.VITE_AUTH_DISABLED === "true";

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/dashboard" element={<Navigate to="/overview" replace />} />
        <Route path="/login" element={<Login onLogin={(email) => setUser(email)} />} />
        <Route element={allowed ? <Layout userEmail={user || 'admin@aura.demo'} onLogout={handleLogout} /> : <Navigate to="/login" replace />}>
          <Route path="/overview" element={<Overview />} />
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/allocation" element={<Allocation />} />
          <Route path="/carbon" element={<CarbonEnergy />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/architecture" element={<Architecture />} />
          <Route path="/simulator" element={<Simulator />} />
        </Route>
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
export default App;
