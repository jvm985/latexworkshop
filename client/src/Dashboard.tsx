import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  FileText, LogOut, Search, Clock, 
  Trash2, ExternalLink, Layout, RefreshCw,
  Plus, Users
} from 'lucide-react';

const API_URL = '/api';

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [tab, setTab] = useState<'my' | 'shared'>('my');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const token = localStorage.getItem('latex_token');
  const user = JSON.parse(localStorage.getItem('latex_user') || '{}');

  const fetchProjects = async () => {
    try {
      const res = await axios.get(`${API_URL}/projects`, { headers: { Authorization: `Bearer ${token}` } });
      setProjects(res.data);
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 401) navigate('/login');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) { navigate('/login'); return; }
    fetchProjects();
  }, [token]);

  const create = async () => {
    if (!name) return;
    try {
        const res = await axios.post(`${API_URL}/projects`, { name }, { headers: { Authorization: `Bearer ${token}` } });
        navigate(`/project/${res.data._id}`);
    } catch (e) { alert('Fout bij aanmaken project'); }
  };

  const deleteProject = async (id: string) => {
    if (!confirm('Project verwijderen?')) return;
    try {
      await axios.delete(`${API_URL}/projects/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      fetchProjects();
    } catch (e) { alert('Verwijderen mislukt'); }
  };

  const filteredProjects = projects.filter((p: any) => {
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
      // HEEL BELANGRIJK: Wees tolerant in de match voor owner
      const isMine = p.owner?._id === user._id || p.owner === user._id || p.owner?.email === user.email;
      if (tab === 'my') return matchesSearch && isMine;
      return matchesSearch && !isMine;
  });

  if (loading) return (
    <div style={{ background: '#1e1e1e', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
      <RefreshCw className="animate-spin" />
    </div>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100vw', background: '#121212', color: 'white', fontFamily: '"Inter", sans-serif' }}>
      <aside style={{ width: '260px', background: '#181818', borderRight: '1px solid #282828', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid #282828' }}>
          <div style={{ background: '#0071e3', padding: '6px', borderRadius: '8px' }}><Layout size={18}/></div>
          <span style={{ fontWeight: 800, fontSize: '16px' }}>Docs</span>
        </div>
        <nav style={{ flex: 1, padding: '20px 12px' }}>
          <div 
            onClick={() => setTab('my')}
            style={{ 
                background: tab === 'my' ? '#282828' : 'transparent', 
                padding: '8px 12px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', cursor: 'pointer', marginBottom: '4px',
                color: tab === 'my' ? 'white' : '#888'
            }}
          >
            <FileText size={16} color={tab === 'my' ? "#0071e3" : "#666"}/> My Projects
          </div>
          <div 
            onClick={() => setTab('shared')}
            style={{ 
                background: tab === 'shared' ? '#282828' : 'transparent', 
                padding: '8px 12px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', cursor: 'pointer',
                color: tab === 'shared' ? 'white' : '#888'
            }}
          >
            <Users size={16} color={tab === 'shared' ? "#0071e3" : "#666"}/> Shared with me
          </div>

          <div style={{ marginTop: '32px', padding: '0 12px' }}>
              <div style={{ fontSize: '10px', fontWeight: 800, color: '#444', textTransform: 'uppercase', marginBottom: '12px' }}>New Project</div>
              <input 
                value={name} onChange={e => setName(e.target.value)} 
                placeholder="Project name..." 
                style={{ width: '100%', background: '#222', border: '1px solid #333', color: 'white', padding: '8px 12px', borderRadius: '6px', marginBottom: '8px', fontSize: '13px' }}
              />
              <button 
                onClick={create} 
                style={{ width: '100%', background: '#0071e3', border: 'none', color: 'white', padding: '8px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <Plus size={14}/> Create
              </button>
          </div>
        </nav>
        <div style={{ padding: '20px', borderTop: '1px solid #282828', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '14px', background: '#333', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{user.name?.[0]}</div>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: '12px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div></div>
          <button onClick={() => { localStorage.clear(); navigate('/login'); }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><LogOut size={16}/></button>
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
          <div style={{ fontSize: '13px', color: '#666' }}>{user.email}</div>
        </header>

        <div style={{ flex: 1, padding: '40px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ color: '#666', fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid #282828' }}>
                <th style={{ padding: '12px 20px' }}>Project Name</th>
                <th style={{ padding: '12px 20px' }}>Owner</th>
                <th style={{ padding: '12px 20px' }}>Last Modified</th>
                <th style={{ padding: '12px 20px', width: '80px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p: any) => (
                <tr 
                  key={p._id} 
                  onClick={() => navigate(`/project/${p._id}`)}
                  style={{ borderBottom: '1px solid #1e1e1e', cursor: 'pointer' }}
                  onMouseOver={e => e.currentTarget.style.background = '#181818'}
                  onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <FileText size={18} color="#0071e3"/>
                      <span style={{ fontWeight: 500, fontSize: '15px' }}>{p.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px', fontSize: '14px', color: '#aaa' }}>
                    {p.owner?.email === user.email ? 'You' : p.owner?.name || p.owner?.email}
                  </td>
                  <td style={{ padding: '16px 20px', fontSize: '14px', color: '#666' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Clock size={14}/> {new Date(p.lastModified).toLocaleDateString()}</div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                      <button onClick={(e) => { e.stopPropagation(); deleteProject(p._id); }} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredProjects.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: '#444' }}>No projects found.</div>}
        </div>
      </main>
    </div>
  );
}
