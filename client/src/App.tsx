import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import { FileText, LogOut, Plus, Layout } from 'lucide-react';
import EditorView from './Editor';

const API_URL = '/api';

function Login() {
  const navigate = useNavigate();

  const handleLogin = async (credentialResponse: any) => {
    try {
      const res = await axios.post(`${API_URL}/auth/google`, { credential: credentialResponse.credential });
      localStorage.setItem('latex_token', res.data.token);
      localStorage.setItem('latex_user', JSON.stringify(res.data.user));
      navigate('/');
    } catch (err) {
      alert('Login failed');
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#f5f5f7' }}>
      <div style={{ background: 'white', padding: '40px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '20px' }}><Layout style={{ marginRight: '10px', verticalAlign: 'middle' }}/> LaTeX Workshop</h1>
        <p style={{ color: '#666', marginBottom: '30px' }}>Log in om verder te gaan</p>
        <GoogleLogin onSuccess={handleLogin} onError={() => console.log('Login Failed')} />
      </div>
    </div>
  );
}

function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const navigate = useNavigate();
  const token = localStorage.getItem('latex_token');

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    const fetchProjects = async () => {
      try {
        const res = await axios.get(`${API_URL}/projects`, { headers: { Authorization: `Bearer ${token}` } });
        setProjects(res.data);
      } catch(e) {
        if (axios.isAxiosError(e) && e.response?.status === 401) {
          navigate('/login');
        }
      }
    };
    fetchProjects();
  }, [navigate, token]);

  const createProject = async () => {
    if (!newProjectName) return;
    const res = await axios.post(`${API_URL}/projects`, { name: newProjectName }, { headers: { Authorization: `Bearer ${token}` } });
    navigate(`/project/${res.data._id}`);
  };

  const logout = () => {
    localStorage.removeItem('latex_token');
    localStorage.removeItem('latex_user');
    navigate('/login');
  };

  return (
    <div style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
        <h1>Mijn Projecten</h1>
        <button onClick={logout} style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', background: '#eee', border: 'none', borderRadius: '8px', cursor: 'pointer' }}><LogOut size={16} style={{ marginRight: '8px' }}/> Uitloggen</button>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
        <input 
          value={newProjectName} 
          onChange={(e) => setNewProjectName(e.target.value)} 
          placeholder="Nieuwe project naam..." 
          style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc', flex: 1 }}
        />
        <button onClick={createProject} style={{ display: 'flex', alignItems: 'center', padding: '10px 20px', background: '#0071e3', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
          <Plus size={18} style={{ marginRight: '8px' }}/> Nieuw Project
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px' }}>
        {projects.map((p: any) => (
          <div key={p._id} onClick={() => navigate(`/project/${p._id}`)} style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', cursor: 'pointer', border: '1px solid transparent', transition: 'border-color 0.2s' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', margin: '0 0 10px 0' }}><FileText size={18} style={{ marginRight: '10px', color: '#666' }}/> {p.name}</h3>
            <p style={{ color: '#888', fontSize: '12px', margin: 0 }}>Aangepast: {new Date(p.lastModified).toLocaleDateString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/project/:id" element={<EditorView />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
