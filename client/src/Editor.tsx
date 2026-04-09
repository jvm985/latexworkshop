import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor, { loader } from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { 
  Play, ChevronLeft, FileText, 
  Terminal, Eye, Folder, FilePlus, FolderPlus, 
  AlertCircle, Share2, X, UserPlus, Shield, User as UserIcon
} from 'lucide-react';

import { Viewer, Worker } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';

const API_URL = '/api';

// --- CUSTOM MONACO SETUP ---
loader.init().then(monaco => {
  // Ensure LaTeX is registered correctly
  monaco.languages.register({ id: 'latex' });
  
  // Custom Typst syntax highlighting
  monaco.languages.register({ id: 'typst' });
  monaco.languages.setMonarchTokensProvider('typst', {
    tokenizer: {
      root: [
        [/^#.*/, 'comment'],
        [/^= .*/, 'keyword'],
        [/\[/, { token: 'string', bracket: '@open', next: '@string' } as any],
        [/\$.*\$/, 'variable'],
        [/[{}()\[\]]/, '@brackets'],
        [/[a-zA-Z_]\w*/, 'identifier'],
      ],
      string: [
        [/[^\]]+/, 'string'],
        [/\]/, { token: 'string', bracket: '@close', next: '@pop' } as any],
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
  const [showShare, setShowShare] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [sharePerm, setSharePerm] = useState('read');
  
  const [leftWidth, setLeftWidth] = useState(220);
  const [editorWidth, setEditorWidth] = useState(50);
  const isResizingRef = useRef(false);
  const isResizingSidebarRef = useRef(false);

  const socketRef = useRef<Socket | null>(null);
  const compileTimeoutRef = useRef<any>(null);
  const defaultLayoutPluginInstance = defaultLayoutPlugin();
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
  }, [id, token, navigate]);

  useEffect(() => {
    if (!activeDoc || !socketRef.current) return;
    const socket = socketRef.current;
    socket.emit('join-document', activeDoc._id);
    const onUpdate = (content: string) => {
      setActiveDoc((prev: any) => (prev?._id === activeDoc._id ? { ...prev, content } : prev));
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
    try {
      const res = await axios.post(`${API_URL}/compile/${id}`, {}, { 
        headers: { Authorization: `Bearer ${token}` }, 
        responseType: 'blob' 
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      setPdfUrl(url);
      setLogs(null);
    } catch (err: any) {
      if (!isAuto) {
        if (err.response?.data instanceof Blob) {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const result = JSON.parse(reader.result as string);
              setLogs(result.logs || 'Compilation failed without logs.');
              setView('logs');
            } catch(e) { setLogs('Error parsing compiler logs.'); setView('logs'); }
          };
          reader.readAsText(err.response.data);
        } else {
          setLogs('Compiler server unreachable or crashed.');
          setView('logs');
        }
      }
    } finally { if (!isAuto) setCompiling(false); }
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined || !activeDoc) return;
    setActiveDoc({ ...activeDoc, content: value });
    socketRef.current?.emit('edit-document', { documentId: activeDoc._id, content: value });
    
    if (project?.type === 'typst') {
      if (compileTimeoutRef.current) clearTimeout(compileTimeoutRef.current);
      compileTimeoutRef.current = setTimeout(() => compile(true), 1000);
    }
  };

  const handleShare = async () => {
    if (!shareEmail) return;
    await axios.post(`${API_URL}/projects/${id}/share`, { email: shareEmail, permission: sharePerm }, { headers: { Authorization: `Bearer ${token}` } });
    setShareEmail('');
    const res = await axios.get(`${API_URL}/projects/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    setProject(res.data.project);
  };

  const startResizing = () => isResizingRef.current = true;
  const startResizingSidebar = () => isResizingSidebarRef.current = true;

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingRef.current) {
        const offset = leftWidth + 4;
        const availableWidth = window.innerWidth - offset;
        const percentage = ((e.clientX - offset) / availableWidth) * 100;
        setEditorWidth(Math.max(10, Math.min(90, percentage)));
      }
      if (isResizingSidebarRef.current) {
        setLeftWidth(Math.max(150, Math.min(500, e.clientX)));
      }
    };
    const handleMouseUp = () => {
      isResizingRef.current = false;
      isResizingSidebarRef.current = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [leftWidth]);

  if (!project) return <div style={{ background: '#1e1e1e', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#1e1e1e', color: 'white', overflow: 'hidden' }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px', height: '48px', background: '#252526', borderBottom: '1px solid #333', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><ChevronLeft size={20}/></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 700 }}>{project.name}</span>
            <span style={{ fontSize: '10px', background: '#333', padding: '2px 6px', borderRadius: '4px', color: '#888' }}>{project.type.toUpperCase()}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => setShowShare(true)} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
            <Share2 size={16}/> Share
          </button>
          <div style={{ width: '1px', height: '20px', background: '#444' }}></div>
          <button onClick={() => setView(view === 'logs' ? 'split' : 'logs')} style={{ background: 'none', border: 'none', color: logs ? '#ff5f56' : '#888', cursor: 'pointer', fontSize: '12px' }}>
            <Terminal size={14} style={{ verticalAlign: 'middle', marginRight: '5px' }}/> {logs ? 'Errors' : 'Logs'}
          </button>
          
          {project.type === 'latex' && (
            <button onClick={() => compile()} disabled={compiling} style={{ background: '#28a745', color: 'white', border: 'none', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Play size={12} fill="white"/> {compiling ? '...' : 'Recompile'}
            </button>
          )}
        </div>
      </nav>

      <main style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <aside style={{ width: `${leftWidth}px`, background: '#181818', borderRight: '1px solid #282828', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase' }}>Files</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }}><FilePlus size={14}/></button>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }}><FolderPlus size={14}/></button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {documents.map(doc => (
              <div key={doc._id} onClick={() => !doc.isFolder && setActiveDoc(doc)} style={{ display: 'flex', alignItems: 'center', padding: '6px 16px', cursor: 'pointer', fontSize: '13px', background: activeDoc?._id === doc._id ? '#2d2d2d' : 'transparent', color: activeDoc?._id === doc._id ? '#fff' : '#aaa', gap: '8px' }}>
                {doc.isFolder ? <Folder size={14} color="#dcb67a"/> : <FileText size={14} color="#519aba"/>}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</span>
              </div>
            ))}
          </div>
        </aside>

        <div onMouseDown={startResizingSidebar} style={{ width: '4px', cursor: 'col-resize', background: 'transparent' }}></div>

        {view === 'split' ? (
          <>
            <div style={{ width: `${editorWidth}%`, height: '100%' }}>
              <Editor
                height="100%"
                language={project.type === 'typst' ? 'typst' : 'latex'}
                theme="vs-dark"
                value={activeDoc?.content || ''}
                onChange={handleEditorChange}
                options={{ 
                  fontSize: 16, 
                  minimap: { enabled: false }, 
                  wordWrap: 'on', 
                  lineNumbers: 'on', 
                  padding: { top: 16 },
                  renderWhitespace: 'none',
                  cursorBlinking: 'smooth',
                  smoothScrolling: true
                }}
              />
            </div>
            <div onMouseDown={startResizing} style={{ width: '6px', cursor: 'col-resize', background: '#111', borderLeft: '1px solid #333', borderRight: '1px solid #333' }}></div>
            <div style={{ flex: 1, background: '#2d2d2d', overflow: 'hidden' }}>
              {pdfUrl ? (
                <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js">
                  <Viewer fileUrl={pdfUrl} theme="dark" plugins={[defaultLayoutPluginInstance]} />
                </Worker>
              ) : (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#444' }}>
                  <Eye size={48} style={{ opacity: 0.1, marginBottom: '10px' }}/>
                  <span>Compiling preview...</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, background: '#000', padding: '40px', overflowY: 'auto' }}>
            <h2 style={{ color: '#ff5f56', display: 'flex', alignItems: 'center', gap: '12px' }}><AlertCircle /> Compilation Error Logs</h2>
            <pre style={{ background: '#111', padding: '24px', borderRadius: '12px', color: '#ddd', fontSize: '14px', whiteSpace: 'pre-wrap', fontFamily: '"JetBrains Mono", monospace' }}>{logs}</pre>
            <button onClick={() => setView('split')} style={{ marginTop: '20px', background: '#333', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer' }}>Close</button>
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
