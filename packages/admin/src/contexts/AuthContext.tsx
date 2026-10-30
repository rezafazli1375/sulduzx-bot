import { createContext, useContext, useState } from 'react';
import axios from 'axios';

axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('admin');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

interface AuthContextType {
  token: string | null;
  admin: any;
  login: (username: string, password: string) => Promise<void>;
  updateSession: (token: string, admin: any) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  admin: null,
  login: async () => {},
  updateSession: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [admin, setAdmin] = useState<any>(JSON.parse(localStorage.getItem('admin') || 'null'));

  const login = async (username: string, password: string) => {
    const res = await axios.post('/api/auth/login', { username, password });
    setToken(res.data.token);
    setAdmin(res.data.admin);
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('admin', JSON.stringify(res.data.admin));
  };

  const updateSession = (nextToken: string, nextAdmin: any) => {
    setToken(nextToken);
    setAdmin(nextAdmin);
    localStorage.setItem('token', nextToken);
    localStorage.setItem('admin', JSON.stringify(nextAdmin));
  };

  const logout = () => {
    setToken(null);
    setAdmin(null);
    localStorage.removeItem('token');
    localStorage.removeItem('admin');
  };

  return (
    <AuthContext.Provider value={{ token, admin, login, updateSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
