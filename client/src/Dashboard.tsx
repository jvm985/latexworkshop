import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  FileText, LogOut, Search, Clock, 
  Trash2, ExternalLink, RefreshCw
} from 'lucide-react';

const API_URL = '/api';

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const token = localStorage.getItem('latex_token');
  const user = JSON.parse(localStorage.getItem('latex_user') || '{}');

  const fetchProjects = async () => {
    try {
      const res = await axios.get(`${API_URL}/projects`, { headers: { Authorization: `Bearer ${token}` } });
      setProjects(res.data);
    } catch (e) {
      navigate('/login');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    fetchProjects();
  }, [token]);

  const create = async () => {
    if (!name) return;
    try {
        const res = await axios.post(`${API_URL}/projects`, { name, type: 'latex' }, { headers: { Authorization: `Bearer ${token}` } });
        navigate(`/project/${res.data._id}`);
    } catch (e) {
        alert('Creation failed');
    }
  };

  const deleteProject = async (id: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    try {
      await axios.delete(`${API_URL}/projects/${id}`, { 
        headers: { Authorization: `Bearer ${token}` } 
      });
      fetchProjects();
    } catch (e) {
      alert('Failed to delete project.');
    }
  };

  const filteredProjects = projects.filter((p: any) => p.name.toLowerCase().includes(search.toLowerCase()));

  if (loading) return (
    <div style={{ background: '#1e1e1e', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
      <RefreshCw className="animate-spin" />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100vw', background: '#0f0f0f', color: 'white', fontFamily: '"Inter", sans-serif' }}>
      <nav style={{ padding: '12px 40px', background: '#181818', borderBottom: '1px solid #282828', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: '#0071e3', padding: '6px', borderRadius: '8px' }}><FileText size={18}/></div>
            <span style={{ fontWeight: 800, fontSize: '18px' }}>LaTeX Workshop</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ fontSize: '13px', color: '#888' }}>{user.email}</div>
            <button onClick={() => { localStorage.clear(); navigate('/login'); }} style={{ background: '#222', border: '1px solid #333', color: '#aaa', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <LogOut size={14}/> Logout
            </button>
        </div>
      </nav>

      <main style={{ flex: 1, padding: '40px 80px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 700 }}>Your Projects</h2>
            <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#666' }}/>
                    <input 
                        value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search projects..." 
                        style={{ background: '#181818', border: '1px solid #282828', color: 'white', padding: '8px 12px 8px 36px', borderRadius: '8px', width: '240px', outline: 'none', fontSize: '14px' }}
                    />
                </div>
                <div style={{ display: 'flex', gap: '8px', background: '#181818', borderRadius: '8px', border: '1px solid #282828', padding: '4px' }}>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="New project name..." style={{ background: 'none', border: 'none', color: 'white', padding: '0 12px', width: '180px', outline: 'none', fontSize: '13px' }}/>
                    <button onClick={create} style={{ background: '#0071e3', border: 'none', color: 'white', padding: '4px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>Create</button>
                </div>
            </div>
        </div>

        <div style={{ background: '#181818', borderRadius: '12px', border: '1px solid #282828', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ color: '#666', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid #282828', background: '#1e1e1e' }}>
                <th style={{ padding: '12px 20px', fontWeight: 600 }}>Name</th>
                <th style={{ padding: '12px 20px', fontWeight: 600 }}>Type</th>
                <th style={{ padding: '12px 20px', fontWeight: 600 }}>Last Modified</th>
                <th style={{ padding: '12px 20px', width: '80px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p: any) => (
                <tr 
                  key={p._id} 
                  onClick={() => navigate(`/project/${p._id}`)}
                  style={{ borderBottom: '1px solid #1e1e1e', cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseOver={e => e.currentTarget.style.background = '#1e1e1e'}
                  onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <FileText size={18} color="#0071e3"/>
                      <span style={{ fontWeight: 500, fontSize: '15px' }}>{p.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <span style={{ fontSize: '10px', background: '#222', color: '#888', padding: '2px 8px', borderRadius: '4px', fontWeight: 700, textTransform: 'uppercase' }}>{p.type}</span>
                  </td>
                  <td style={{ padding: '16px 20px', fontSize: '14px', color: '#666' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Clock size={14}/> {new Date(p.lastModified).toLocaleDateString()}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <button 
                            onClick={(e) => { e.stopPropagation(); deleteProject(p._id); }}
                            style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', padding: '4px' }}
                        >
                            <Trash2 size={16} />
                        </button>
                        <ExternalLink size={14} color="#333"/>
                      </div>
                  </td>
                </tr>
              ))}
              {filteredProjects.length === 0 && (
                  <tr>
                      <td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: '#444' }}>No projects found.</td>
                  </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
