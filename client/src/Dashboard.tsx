import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  FileText, LogOut, Search, Clock, 
  Trash2, ExternalLink, Layout, RefreshCw,
  Plus, Users, ArrowUp, ArrowDown, Globe
} from 'lucide-react';

const API_URL = '/api';

type TabType = 'my' | 'shared' | 'all';
type SortField = 'name' | 'owner' | 'lastModified';
type SortDir = 'asc' | 'desc';

export default function Dashboard() {
  const [projects, setProjects] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [tab, setTab] = useState<TabType>('my');
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('lastModified');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  
  const navigate = useNavigate();
  const token = localStorage.getItem('latex_token');
  const user = JSON.parse(localStorage.getItem('latex_user') || '{}');

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const endpoint = tab === 'all' ? `${API_URL}/projects/all` : `${API_URL}/projects`;
      const res = await axios.get(endpoint, { headers: { Authorization: `Bearer ${token}` } });
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
  }, [token, tab]);

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

  const toggleSort = (field: SortField) => {
      if (sortField === field) {
          setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
      } else {
          setSortField(field);
          setSortDir('asc');
      }
  };

  const filteredProjects = projects.filter((p: any) => {
      const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) || 
                            (p.owner?.name || '').toLowerCase().includes(search.toLowerCase()) ||
                            (p.owner?.email || '').toLowerCase().includes(search.toLowerCase());
      
      if (tab === 'all') return matchesSearch;
      
      const isMine = p.owner?._id === user._id || p.owner === user._id || p.owner?.email === user.email;
      if (tab === 'my') return matchesSearch && isMine;
      return matchesSearch && !isMine;
  }).sort((a, b) => {
      let valA, valB;
      if (sortField === 'name') {
          valA = a.name.toLowerCase(); valB = b.name.toLowerCase();
      } else if (sortField === 'owner') {
          valA = (a.owner?.name || a.owner?.email || '').toLowerCase();
          valB = (b.owner?.name || b.owner?.email || '').toLowerCase();
      } else {
          valA = new Date(a.lastModified).getTime();
          valB = new Date(b.lastModified).getTime();
      }
      
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
  });

  const SortIcon = ({ field }: { field: SortField }) => {
      if (sortField !== field) return null;
      return sortDir === 'asc' ? <ArrowUp size={12} style={{ marginLeft: 4 }}/> : <ArrowDown size={12} style={{ marginLeft: 4 }}/>;
  };

  if (loading && projects.length === 0) return (
    <div style={{ background: '#1e1e1e', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
      <RefreshCw className="animate-spin" />
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#121212', color: 'white', fontFamily: '"Inter", sans-serif', overflow: 'hidden' }}>
      <aside style={{ width: '260px', background: '#181818', borderRight: '1px solid #282828', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid #282828' }}>
          <div style={{ background: '#0071e3', padding: '6px', borderRadius: '8px' }}><Layout size={18}/></div>
          <span style={{ fontWeight: 800, fontSize: '16px' }}>Docs</span>
        </div>
        <nav style={{ flex: 1, padding: '20px 12px', overflowY: 'auto' }}>
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
                padding: '8px 12px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', cursor: 'pointer', marginBottom: '4px',
                color: tab === 'shared' ? 'white' : '#888'
            }}
          >
            <Users size={16} color={tab === 'shared' ? "#0071e3" : "#666"}/> Shared with me
          </div>
          <div 
            onClick={() => setTab('all')}
            style={{ 
                background: tab === 'all' ? '#282828' : 'transparent', 
                padding: '8px 12px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', cursor: 'pointer',
                color: tab === 'all' ? 'white' : '#888'
            }}
          >
            <Globe size={16} color={tab === 'all' ? "#0071e3" : "#666"}/> All Projects
          </div>

          <div style={{ marginTop: '32px', padding: '0 12px' }}>
              <div style={{ fontSize: '10px', fontWeight: 800, color: '#444', textTransform: 'uppercase', marginBottom: '12px' }}>New Project</div>
              <input 
                value={name} onChange={e => setName(e.target.value)} 
                placeholder="Project name..." 
                style={{ width: '100%', background: '#222', border: '1px solid #333', color: 'white', padding: '8px 12px', borderRadius: '6px', marginBottom: '8px', fontSize: '13px', outline: 'none' }}
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

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{ padding: '20px 40px', borderBottom: '1px solid #282828', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#666' }}/>
            <input 
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search projects or owners..." 
              style={{ background: '#181818', border: '1px solid #282828', color: 'white', padding: '8px 12px 8px 36px', borderRadius: '8px', width: '350px', outline: 'none', fontSize: '14px' }}
            />
          </div>
          <div style={{ fontSize: '13px', color: '#666' }}>{user.email}</div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 40px' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0', textAlign: 'left' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#121212', zIndex: 10 }}>
              <tr style={{ color: '#666', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                <th onClick={() => toggleSort('name')} style={{ padding: '20px 20px', fontWeight: 600, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>Project Name <SortIcon field="name"/></div>
                </th>
                <th onClick={() => toggleSort('owner')} style={{ padding: '20px 20px', fontWeight: 600, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>Owner <SortIcon field="owner"/></div>
                </th>
                <th onClick={() => toggleSort('lastModified')} style={{ padding: '20px 20px', fontWeight: 600, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>Last Modified <SortIcon field="lastModified"/></div>
                </th>
                <th style={{ padding: '20px 20px', width: '80px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p: any) => (
                <tr 
                  key={p._id} 
                  onClick={() => navigate(`/project/${p._id}`)}
                  style={{ cursor: 'pointer' }}
                  onMouseOver={e => e.currentTarget.style.background = '#181818'}
                  onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '16px 20px', borderBottom: '1px solid #1e1e1e' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <FileText size={18} color="#0071e3"/>
                      <span style={{ fontWeight: 500, fontSize: '14px' }}>{p.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px', fontSize: '13px', color: '#aaa', borderBottom: '1px solid #1e1e1e' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span>{p.owner?.email === user.email ? 'You' : p.owner?.name || 'Unknown'}</span>
                        {p.owner?.email !== user.email && <span style={{ fontSize: '10px', color: '#555' }}>{p.owner?.email}</span>}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px', fontSize: '13px', color: '#666', borderBottom: '1px solid #1e1e1e' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Clock size={14}/> {new Date(p.lastModified).toLocaleString()}</div>
                  </td>
                  <td style={{ padding: '16px 20px', borderBottom: '1px solid #1e1e1e' }}>
                      {(p.owner?._id === user._id || p.owner === user._id) && (
                        <button onClick={(e) => { e.stopPropagation(); deleteProject(p._id); }} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', padding: '4px' }} title="Delete"><Trash2 size={16} /></button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredProjects.length === 0 && !loading && (
              <div style={{ padding: '80px 0', textAlign: 'center', color: '#444' }}>
                  <Globe size={48} style={{ opacity: 0.1, marginBottom: 16 }}/>
                  <div>Geen projecten gevonden.</div>
              </div>
          )}
          {loading && (
              <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
                  <RefreshCw className="animate-spin" size={24}/>
              </div>
          )}
        </div>
      </main>
    </div>
  );
}
