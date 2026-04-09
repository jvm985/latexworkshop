import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor, { loader } from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { 
  Play, ChevronLeft, FileText, 
  Terminal, Eye, Folder, FilePlus, FolderPlus, 
  Settings, AlertCircle, Share2, Download
} from 'lucide-react';

const API_URL = '/api';

// Custom Typst syntax highlighting for Monaco (basic)
loader.init().then(monaco => {
  monaco.languages.register({ id: 'typst' });
  monaco.languages.setMonarchTokensProvider('typst', {
    tokenizer: {
      root: [
        [/^#.*/, 'comment'],
        [/^= .*/, 'keyword'],
        [/\[/, { token: 'string', bracket: '@open', next: '@string' }],
        [/\$.*\$/, 'variable'],
        [/[{}()\[\]]/, '@brackets'],
        [/[a-zA-Z_]\w*/, 'identifier'],
      ],
      string: [
        [/[^\]]+/, 'string'],
        [/\]/, { token: 'string', bracket: '@close', next: '@pop' }],
      ],
    }
  });
});

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
  const compileTimeoutRef = useRef<any>(null);

  const token = localStorage.getItem('latex_token');

  const fetchAll = async () => {
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
    fetchAll();
    socketRef.current = io({ path: '/socket.io' });
    return () => { socketRef.current?.disconnect(); };
  }, [id, navigate, token]);

  useEffect(() => {
    if (!activeDoc || !socketRef.current) return;
    const socket = socketRef.current;
    socket.emit('join-document', activeDoc._id);
    const onUpdate = (content: string) => {
      if (activeDoc.content !== content) {
        setActiveDoc((prev: any) => (prev?._id === activeDoc._id ? { ...prev, content } : prev));
      }
    };
    socket.on('document-updated', onUpdate);
    return () => {
      socket.emit('leave-document', activeDoc._id);
      socket.off('document-updated', onUpdate);
    };
  }, [activeDoc?._id]);

  const compile = async (isAuto = false) => {
    if (compiling && isAuto) return;
    if (!isAuto) setCompiling(true);
    setLogs(null);
    try {
      const res = await axios.post(`${API_URL}/compile/${id}`, {}, { 
        headers: { Authorization: `Bearer ${token}` }, 
        responseType: 'blob' 
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      setPdfUrl(url);
    } catch (err: any) {
      if (!isAuto) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const result = JSON.parse(reader.result as string);
            setLogs(result.logs);
            setView('logs');
          } catch(e) { setLogs('Compilation error.'); setView('logs'); }
        };
        if (err.response?.data) reader.readAsText(err.response.data);
      }
    } finally { if (!isAuto) setCompiling(false); }
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined || !activeDoc) return;
    setActiveDoc({ ...activeDoc, content: value });
    socketRef.current?.emit('edit-document', { documentId: activeDoc._id, content: value });

    // Real-time Typst Compilation
    if (project?.type === 'typst') {
      if (compileTimeoutRef.current) clearTimeout(compileTimeoutRef.current);
      compileTimeoutRef.current = setTimeout(() => compile(true), 1000);
    }
  };

  const addFile = async (isFolder: boolean) => {
    const name = prompt(`Enter ${isFolder ? 'folder' : 'file'} name:`);
    if (!name) return;
    await axios.post(`${API_URL}/projects/${id}/files`, { name, isFolder, path: '' }, { headers: { Authorization: `Bearer ${token}` } });
    fetchAll();
  };

  if (!project) return <div style={{ background: '#1e1e1e', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading Editor...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1e1e1e', color: 'white', overflow: 'hidden' }}>
      {/* NAVBAR */}
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px', height: '48px', background: '#252526', borderBottom: '1px solid #333', zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex' }}><ChevronLeft size={20}/></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={16} color={project.type === 'typst' ? '#4ade80' : '#0071e3'}/>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>{project.name}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => setView(view === 'logs' ? 'split' : 'logs')} style={{ background: 'none', border: 'none', color: logs ? '#ff5f56' : '#888', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Terminal size={14}/> {logs ? 'Error Logs' : 'Logs'}
          </button>
          <button onClick={() => compile()} disabled={compiling} style={{ background: compiling ? '#444' : '#28a745', color: 'white', border: 'none', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Play size={12} fill="white"/> {compiling ? 'Compiling...' : 'Recompile'}
          </button>
        </div>
      </nav>

      <main style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* SIDEBAR */}
        <aside style={{ width: '220px', background: '#181818', borderRight: '1px solid #282828', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Files</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <FilePlus size={14} color="#888" style={{ cursor: 'pointer' }} onClick={() => addFile(false)}/>
              <FolderPlus size={14} color="#888" style={{ cursor: 'pointer' }} onClick={() => addFile(true)}/>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {documents.map(doc => (
              <div 
                key={doc._id} 
                onClick={() => !doc.isFolder && setActiveDoc(doc)}
                style={{ 
                  display: 'flex', alignItems: 'center', padding: '6px 16px', cursor: 'pointer', fontSize: '13px',
                  background: activeDoc?._id === doc._id ? '#2d2d2d' : 'transparent',
                  color: activeDoc?._id === doc._id ? '#fff' : '#aaa',
                  borderLeft: activeDoc?._id === doc._id ? '2px solid #0071e3' : '2px solid transparent'
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
            <div style={{ flex: 1, position: 'relative' }}>
              <Editor
                height="100%"
                width="100%"
                language={project.type === 'typst' ? 'typst' : 'latex'}
                theme="vs-dark"
                value={activeDoc?.content || ''}
                onChange={handleEditorChange}
                options={{ 
                  fontSize: 16, 
                  fontFamily: '"JetBrains Mono", monospace',
                  minimap: { enabled: false }, 
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  padding: { top: 16 },
                  smoothScrolling: true,
                  cursorBlink: 'smooth'
                }}
              />
            </div>
            {/* PREVIEW */}
            <div style={{ flex: 1, background: '#2d2d2d', borderLeft: '1px solid #111' }}>
              {pdfUrl ? (
                <iframe src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0`} width="100%" height="100%" style={{ border: 'none' }} />
              ) : (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
                  <Eye size={48} style={{ marginBottom: '16px', opacity: 0.1 }}/>
                  <p style={{ fontSize: '14px' }}>Compiling preview...</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, background: '#000', padding: '40px', overflowY: 'auto' }}>
            <div style={{ maxWidth: '800px', margin: '0 auto' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#ff5f56', marginBottom: '24px' }}><AlertCircle /> Compilation Error Logs</h2>
              <pre style={{ background: '#111', padding: '24px', borderRadius: '12px', color: '#ddd', fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-wrap', border: '1px solid #222' }}>{logs}</pre>
              <button onClick={() => setView('split')} style={{ marginTop: '24px', background: '#333', border: 'none', color: 'white', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer' }}>Back to Editor</button>
            </div>
          </div>
        )}
      </main>

      <footer style={{ height: '24px', background: '#0071e3', display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: '11px', fontWeight: 600, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '16px' }}><span>READY</span><span>UTF-8</span></div>
        <div style={{ display: 'flex', gap: '16px' }}><span>{project.compiler.toUpperCase()}</span><span>CHARS: {activeDoc?.content.length || 0}</span></div>
      </footer>
    </div>
  );
}
