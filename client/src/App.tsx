import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import { 
  FileText, LogOut, Layout, Clock, 
  Search, ExternalLink
} from 'lucide-react';
import EditorView from './Editor';

const API_URL = '/api';

function Login() {
  const navigate = useNavigate();
  const handleLogin = async (res: any) => {
    const { data } = await axios.post(`${API_URL}/auth/google`, { credential: res.credential });
    localStorage.setItem('latex_token', data.token);
    localStorage.setItem('latex_user', JSON.stringify(data.user));
    navigate('/');
  };
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', background: '#0f0f0f' }}>
      <div style={{ background: '#1e1e1e', padding: '60px', borderRadius: '24px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', textAlign: 'center', border: '1px solid #333', width: '400px' }}>
        <div style={{ background: 'linear-gradient(135deg, #0071e3 0%, #003f8c 100%)', width: '80px', height: '80px', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 32px' }}>
          <Layout color="white" size={40} />
        </div>
        <h1 style={{ color: 'white', marginBottom: '8px', fontSize: '32px', fontWeight: 800 }}>LaTeX Workshop</h1>
        <p style={{ color: '#888', marginBottom: '48px' }}>Professional typesetting reinvented.</p>
        <GoogleLogin onSuccess={handleLogin} theme="filled_blue" shape="pill" />
      </div>
    </div>
  );
}

function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('latex');
  const navigate = useNavigate();
  const token = localStorage.getItem('latex_token');
  const user = JSON.parse(localStorage.getItem('latex_user') || '{}');

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    const fetchProjects = async () => {
      try {
        const res = await axios.get(`${API_URL}/projects`, { headers: { Authorization: `Bearer ${token}` } });
        setProjects(res.data);
      } catch (e) { /* silent fail */ }
    };
    fetchProjects();
  }, [token, navigate]);

  const create = async () => {
    if (!name) return;
    const res = await axios.post(`${API_URL}/projects`, { name, type }, { headers: { Authorization: `Bearer ${token}` } });
    navigate(`/project/${res.data._id}`);
  };

  const filteredProjects = projects.filter((p: any) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100vw', background: '#121212', color: 'white', fontFamily: '"Inter", sans-serif' }}>
      <aside style={{ width: '220px', background: '#181818', borderRight: '1px solid #282828', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid #282828' }}>
          <div style={{ background: '#0071e3', padding: '6px', borderRadius: '8px' }}><Layout size={18}/></div>
          <span style={{ fontWeight: 800, fontSize: '16px' }}>Workshop</span>
        </div>
        <nav style={{ flex: 1, padding: '20px 12px' }}>
          <div style={{ background: '#282828', padding: '8px 12px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', cursor: 'pointer' }}>
            <FileText size={16} color="#0071e3"/> Projects
          </div>
        </nav>
        <div style={{ padding: '20px', borderTop: '1px solid #282828', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '14px', background: '#333', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{user.name?.[0]}</div>
          <button onClick={() => { localStorage.clear(); navigate('/login'); }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0 }} title="Logout"><LogOut size={16}/></button>
        </div>
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '20px 40px', borderBottom: '1px solid #282828', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#666' }}/>
            <input 
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search projects..." 
              style={{ background: '#181818', border: '1px solid #282828', color: 'white', padding: '8px 12px 8px 36px', borderRadius: '8px', width: '300px', outline: 'none', fontSize: '14px' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', background: '#181818', borderRadius: '8px', border: '1px solid #282828', padding: '4px' }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Project name..." style={{ background: 'none', border: 'none', color: 'white', padding: '0 12px', width: '180px', outline: 'none', fontSize: '14px' }}/>
            <select value={type} onChange={e => setType(e.target.value)} style={{ background: '#282828', border: 'none', color: 'white', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>
              <option value="latex">LaTeX</option>
              <option value="typst">Typst</option>
            </select>
            <button onClick={create} style={{ background: '#0071e3', border: 'none', color: 'white', padding: '4px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>Create</button>
          </div>
        </header>

        <div style={{ flex: 1, padding: '40px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ color: '#666', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid #282828' }}>
                <th style={{ padding: '12px 20px', fontWeight: 600 }}>Project Name</th>
                <th style={{ padding: '12px 20px', fontWeight: 600 }}>Type</th>
                <th style={{ padding: '12px 20px', fontWeight: 600 }}>Owner</th>
                <th style={{ padding: '12px 20px', fontWeight: 600 }}>Last Modified</th>
                <th style={{ padding: '12px 20px', width: '40px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p: any) => (
                <tr 
                  key={p._id} 
                  onClick={() => navigate(`/project/${p._id}`)}
                  style={{ borderBottom: '1px solid #1e1e1e', cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseOver={e => e.currentTarget.style.background = '#181818'}
                  onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <FileText size={18} color={p.type === 'typst' ? '#4ade80' : '#0071e3'}/>
                      <span style={{ fontWeight: 500, fontSize: '15px' }}>{p.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <span style={{ fontSize: '11px', background: '#222', color: '#888', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>{p.type.toUpperCase()}</span>
                  </td>
                  <td style={{ padding: '16px 20px', fontSize: '14px', color: '#aaa' }}>
                    {p.owner.email === user.email ? 'You' : p.owner.name || p.owner.email}
                  </td>
                  <td style={{ padding: '16px 20px', fontSize: '14px', color: '#666' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Clock size={14}/> {new Date(p.lastModified).toLocaleDateString()}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}><ExternalLink size={14} color="#333"/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
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
