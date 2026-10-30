import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Channels from './pages/Channels';
import Settings from './pages/Settings';
import Proxies from './pages/Proxies';
import Users from './pages/Users';
import Tickets from './pages/Tickets';
import Broadcast from './pages/Broadcast';
import Shop from './pages/Shop';
import Menu from './pages/Menu';
import Texts from './pages/Texts';
import Bots from './pages/Bots';
import Backup from './pages/Backup';
import Account from './pages/Account';
import Configs from './pages/Configs';
import Layout from './components/Layout';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  return token ? <>{children}</> : <Navigate to="/login" />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="bots" element={<Bots />} />
        <Route path="channels" element={<Channels />} />
        <Route path="shop" element={<Shop />} />
        <Route path="menu" element={<Menu />} />
        <Route path="texts" element={<Texts />} />
        <Route path="settings" element={<Settings />} />
        <Route path="proxies" element={<Proxies />} />
        <Route path="users" element={<Users />} />
        <Route path="configs" element={<Configs />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="broadcast" element={<Broadcast />} />
        <Route path="backup" element={<Backup />} />
        <Route path="account" element={<Account />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
