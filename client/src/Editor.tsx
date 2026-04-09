import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { 
  Play, ChevronLeft, AlertCircle, FileText, 
  Settings, Terminal, Eye, Folder, ChevronRight, ChevronDown, Plus, FilePlus, FolderPlus
} from 'lucide-react';

const API_URL = '/api';

export default function EditorView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [activeDoc, setActiveDoc] = useState<any>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [view, setView] = useState<'split' | 'logs'>('split');
  const socketRef = useRef<Socket | null>(null);

  const token = localStorage.getItem('latex_token');

  const loadData = async () => {
    try {
      const res = await axios.get(`${API_URL}/projects/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setProject(res.data.project);
      setDocuments(res.data.documents);
      if (res.data.documents.length > 0 && !activeDoc) {
        const main = res.data.documents.find((d: any) => d.name === 'main.tex' || d.name === 'main.typ') || res.data.documents[0];
        setActiveDoc(main);
      }
    } catch (e) { navigate('/'); }
  };

  useEffect(() => {
    if (!token) return navigate('/login');
    loadData();
    socketRef.current = io({ path: '/socket.io' });
    return () => { socketRef.current?.disconnect(); };
  }, [id]);

  useEffect(() => {
    if (!activeDoc || !socketRef.current) return;
    const socket = socketRef.current;
    socket.emit('join-document', activeDoc._id);
    const onUpdate = (content: string) => setActiveDoc((prev: any) => (prev?._id === activeDoc._id ? { ...prev, content } : prev));
    socket.on('document-updated', onUpdate);
    return () => {
      socket.emit('leave-document', activeDoc._id);
      socket.off('document-updated', onUpdate);
    };
  }, [activeDoc?._id]);

  const handleEditorChange = (value: string | undefined) => {
    if (!value || !activeDoc) return;
    setActiveDoc({ ...activeDoc, content: value });
    setDocuments(docs => docs.map(d => d._id === activeDoc._id ? { ...d, content: value } : d));
    socketRef.current?.emit('edit-document', { documentId: activeDoc._id, content: value });
  };

  const addFile = async (isFolder: boolean) => {
    const name = prompt(`Naam voor nieuw ${isFolder ? 'map' : 'bestand'}:`);
    if (!name) return;
    await axios.post(`${API_URL}/projects/${id}/files`, { name, isFolder, path: '' }, { headers: { Authorization: `Bearer ${token}` } });
    loadData();
  };

  const compile = async () => {
    setCompiling(true);
    setLogs(null);
    try {
      const res = await axios.post(`${API_URL}/compile/${id}`, {}, { headers: { Authorization: `Bearer ${token}` }, responseType: 'blob' });
      setPdfUrl(window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' })));
      setView('split');
    } catch (err: any) {
      if (err.response?.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => {
          try { const result = JSON.parse(reader.result as string); setLogs(result.logs); setView('logs'); } catch(e) { setLogs('Error parsing logs'); setView('logs'); }
        };
        reader.readAsText(err.response.data);
      }
    } finally { setCompiling(false); }
  };

  if (!project) return <div style={{ background: '#1e1e1e', height: '100vh', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Laden...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1e1e1e', color: 'white', fontFamily: 'Inter, sans-serif' }}>
      {/* NAVBAR */}
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px', height: '50px', background: '#252526', borderBottom: '1px solid #3c3c3c', zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer' }}><ChevronLeft size={20}/></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <FileText size={18} color="#0071e3"/>
            <span style={{ fontWeight: 600 }}>{project.name}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <button onClick={() => setView(view === 'logs' ? 'split' : 'logs')} style={{ background: 'none', border: 'none', color: logs ? '#ff5f56' : '#ccc', cursor: 'pointer', fontSize: '13px' }}>
            <Terminal size={16} style={{ verticalAlign: 'middle', marginRight: '5px' }}/> {logs ? 'Errors' : 'Logs'}
          </button>
          <button onClick={compile} disabled={compiling} style={{ background: '#28a745', color: 'white', border: 'none', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Play size={14} fill="currentColor"/> {compiling ? 'Compiling...' : 'Recompile'}
          </button>
        </div>
      </nav>

      <main style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* FILE TREE SIDEBAR */}
        <aside style={{ width: '250px', background: '#252526', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#888' }}>Explorer</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <FilePlus size={14} style={{ cursor: 'pointer' }} onClick={() => addFile(false)} title="Nieuw bestand"/>
              <FolderPlus size={14} style={{ cursor: 'pointer' }} onClick={() => addFile(true)} title="Nieuwe map"/>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
            {documents.map(doc => (
              <div 
                key={doc._id} 
                onClick={() => !doc.isFolder && setActiveDoc(doc)}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  padding: '4px 20px', 
                  cursor: 'pointer', 
                  fontSize: '13px',
                  background: activeDoc?._id === doc._id ? '#37373d' : 'transparent',
                  color: activeDoc?._id === doc._id ? 'white' : '#ccc'
                }}
              >
                {doc.isFolder ? <Folder size={14} style={{ marginRight: '8px', color: '#dcb67a' }}/> : <FileText size={14} style={{ marginRight: '8px', color: '#519aba' }}/>}
                {doc.name}
              </div>
            ))}
          </div>
        </aside>

        {view === 'split' ? (
          <>
            {/* EDITOR */}
            <div style={{ flex: 1, borderRight: '1px solid #333' }}>
              <Editor
                height="100%"
                language={project.type === 'typst' ? 'rust' : 'latex'}
                theme="vs-dark"
                value={activeDoc?.content || ''}
                onChange={handleEditorChange}
                options={{ wordWrap: 'on', fontSize: 15, minimap: { enabled: false } }}
              />
            </div>
            {/* PDF PREVIEW */}
            <div style={{ flex: 1, background: '#323639' }}>
              {pdfUrl ? <iframe src={pdfUrl} width="100%" height="100%" style={{ border: 'none' }} /> : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}><Eye size={48} style={{ opacity: 0.2 }}/></div>}
            </div>
          </>
        ) : (
          /* LOGS */
          <div style={{ flex: 1, background: '#000', overflowY: 'auto', padding: '40px' }}>
            <pre style={{ color: '#d4d4d4', fontSize: '14px', whiteSpace: 'pre-wrap' }}>{logs || 'No logs.'}</pre>
          </div>
        )}
      </main>
    </div>
  );
}
