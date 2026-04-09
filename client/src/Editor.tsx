import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor, { loader } from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { 
  Play, ChevronLeft, FileText, 
  Terminal, Eye, Folder, FilePlus, FolderPlus, 
  AlertCircle, Share2, X, UserPlus, Shield, User as UserIcon,
  ChevronDown, ChevronRight, Trash2, CheckCircle2, RefreshCw
} from 'lucide-react';

import { Viewer, Worker } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';

const API_URL = '/api';

// --- CUSTOM MONACO SETUP ---
loader.init().then(monaco => {
  // LaTeX is built-in but Typst needs Monarch
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
  
  const [leftWidth, setLeftWidth] = useState(240);
  const [editorWidth, setEditorWidth] = useState(50);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ '/': true });
  
  const isResizingRef = useRef(false);
  const isResizingSidebarRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const compileTimeoutRef = useRef<any>(null);
  const defaultLayoutPluginInstance = defaultLayoutPlugin();
  const token = localStorage.getItem('latex_token');

  const compile = async (isAuto = false) => {
    if (compiling && isAuto) return;
    if (!isAuto) setCompiling(true);
    try {
      const res = await axios.post(`${API_URL}/compile/${id}`, {}, { 
        headers: { Authorization: `Bearer ${token}` }, 
        responseType: 'blob' 
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      
      // Update PDF URL only if it changed to prevent flash
      setPdfUrl(prev => {
          if (prev) window.URL.revokeObjectURL(prev);
          return url;
      });
      setLogs(null);
    } catch (err: any) {
      if (!isAuto) {
        if (err.response?.data instanceof Blob) {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const result = JSON.parse(reader.result as string);
              setLogs(result.logs || 'Compilation failed.');
              if (!isAuto) setView('logs');
            } catch(e) { setLogs('Compilation error.'); if (!isAuto) setView('logs'); }
          };
          reader.readAsText(err.response.data);
        } else {
          setLogs('Server error during compilation.');
          setView('logs');
        }
      }
    } finally { if (!isAuto) setCompiling(false); }
  };

  const fetchAll = async (autoCompile = false) => {
    try {
      const res = await axios.get(`${API_URL}/projects/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setProject(res.data.project);
      setDocuments(res.data.documents);
      
      if (res.data.documents.length > 0 && !activeDoc) {
        const main = res.data.documents.find((d: any) => d.isMain) || res.data.documents.find((d: any) => d.name === 'main.tex' || d.name === 'main.typ') || res.data.documents.find((d: any) => !d.isFolder && !d.isBinary) || res.data.documents[0];
        setActiveDoc(main);
      }
      if (autoCompile) compile(true);
    } catch (e) { navigate('/'); }
  };

  useEffect(() => {
    if (!token) return navigate('/login');
    fetchAll(true);
    socketRef.current = io({ path: '/socket.io', transports: ['websocket'] });
    return () => { socketRef.current?.disconnect(); };
  }, [id, token, navigate]);

  useEffect(() => {
    if (!activeDoc || !socketRef.current || activeDoc.isBinary || activeDoc.isFolder) return;
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

  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined || !activeDoc) return;
    setActiveDoc({ ...activeDoc, content: value });
    socketRef.current?.emit('edit-document', { documentId: activeDoc._id, content: value });
    
    if (project?.type === 'typst') {
      if (compileTimeoutRef.current) clearTimeout(compileTimeoutRef.current);
      compileTimeoutRef.current = setTimeout(() => compile(true), 1500);
    }
  };

  const setAsMain = async (fileId: string) => {
      await axios.post(`${API_URL}/projects/${id}/files/${fileId}/main`, {}, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
  };

  const addFile = async (isFolder: boolean) => {
    const name = prompt(`Enter ${isFolder ? 'folder' : 'file'} name:`);
    if (!name) return;
    let path = "";
    if (activeDoc && activeDoc.isFolder) path = activeDoc.path + activeDoc.name + "/";
    else if (activeDoc && activeDoc.path) path = activeDoc.path;

    await axios.post(`${API_URL}/projects/${id}/files`, { name, isFolder, path }, { headers: { Authorization: `Bearer ${token}` } });
    fetchAll();
  };

  const deleteFile = async (docId: string) => {
    if (!confirm('Delete this item?')) return;
    await axios.delete(`${API_URL}/projects/${id}/files/${docId}`, { headers: { Authorization: `Bearer ${token}` } });
    fetchAll();
  };

  const convertProject = async () => {
      if (!confirm(`Convert this project to ${project.type === 'latex' ? 'Typst' : 'LaTeX'}?`)) return;
      setCompiling(true);
      try {
          const res = await axios.post(`${API_URL}/convert/${id}`, {}, { headers: { Authorization: `Bearer ${token}` } });
          setProject(res.data);
          fetchAll(true);
      } catch(e) { alert('Conversion failed.'); }
      finally { setCompiling(false); }
  };

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

  // --- TREE LOGIC ---
  const buildTree = () => {
    const root: any = { _children: {} };
    documents.forEach(doc => {
      const parts = doc.path.split('/').filter(Boolean);
      let current = root;
      parts.forEach((part: string) => {
        if (!current._children[part]) current._children[part] = { _isFolderNode: true, _children: {} };
        current = current._children[part];
      });
      if (doc.isFolder) {
        if (!current._children[doc.name]) current._children[doc.name] = { _isFolderNode: true, _children: {} };
        current._children[doc.name]._doc = doc;
      } else {
        current._children[doc.name] = doc;
      }
    });
    return root;
  };

  const renderNode = (node: any, path: string, depth: number) => {
    const keys = Object.keys(node).sort((a,b) => {
        const isAFolder = !!node[a]._isFolderNode;
        const isBFolder = !!node[b]._isFolderNode;
        if (isAFolder && !isBFolder) return -1;
        if (!isAFolder && isBFolder) return 1;
        return a.localeCompare(b);
    });

    return keys.map(key => {
      const item = node[key];
      const isFolderNode = !!item._isFolderNode;
      const folderPath = `${path}${key}/`;
      const isExpanded = expandedFolders[folderPath];
      const doc = isFolderNode ? item._doc : item;

      return (
        <div key={folderPath}>
          <div 
            onClick={() => isFolderNode ? setExpandedFolders(prev => ({ ...prev, [folderPath]: !prev[folderPath] })) : setActiveDoc(item)} 
            style={{ 
              display: 'flex', alignItems: 'center', padding: `4px 16px 4px ${depth * 12 + 12}px`, 
              cursor: 'pointer', fontSize: '13px', 
              background: activeDoc?._id === (doc?._id || null) ? '#37373d' : 'transparent', 
              color: activeDoc?._id === (doc?._id || null) ? '#fff' : (doc?.isMain ? '#4ade80' : '#aaa'), 
              gap: '8px',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                {isFolderNode ? (isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>) : null}
                {isFolderNode ? <Folder size={14} style={{ color: '#dcb67a' }}/> : <FileText size={14} color={item.isBinary ? "#dcb67a" : "#519aba"}/>}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key}</span>
                {doc?.isMain && <CheckCircle2 size={12} color="#4ade80"/>}
            </div>
            {activeDoc?._id === doc?._id && (
                <div style={{ display: 'flex', gap: '8px' }}>
                    {doc && !isFolderNode && !doc.isMain && !doc.isBinary && <Play size={12} onClick={(e) => { e.stopPropagation(); setAsMain(doc._id); }}/>}
                    {doc && <Trash2 size={12} color="#666" onClick={(e) => { e.stopPropagation(); deleteFile(doc._id); }}/>}
                </div>
            )}
          </div>
          {isFolderNode && isExpanded && renderNode(item._children, folderPath, depth + 1)}
        </div>
      );
    });
  };

  if (!project) return <div style={{ background: '#1e1e1e', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>Laden...</div>;

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
          <button onClick={convertProject} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }} title="Convert Project">
            <RefreshCw size={16}/> {project.type === 'latex' ? '-> Typst' : '-> LaTeX'}
          </button>
          <button onClick={() => setShowShare(true)} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
            <Share2 size={16}/> Share
          </button>
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
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase' }}>Bestanden</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }} onClick={() => addFile(false)}><FilePlus size={14}/></button>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }} onClick={() => addFile(true)}><FolderPlus size={14}/></button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>{renderNode(buildTree()._children, '/', 0)}</div>
        </aside>

        <div onMouseDown={() => isResizingSidebarRef.current = true} style={{ width: '4px', cursor: 'col-resize', background: 'transparent' }}></div>

        {view === 'split' ? (
          <>
            <div style={{ width: `${editorWidth}%`, height: '100%' }}>
              {activeDoc && !activeDoc.isBinary && !activeDoc.isFolder ? (
                <Editor
                    height="100%"
                    language={activeDoc.name.endsWith('.tex') ? 'latex' : (project.type === 'typst' ? 'typst' : 'latex')}
                    theme="vs-dark"
                    value={activeDoc.content || ''}
                    onChange={handleEditorChange}
                    options={{ fontSize: 16, minimap: { enabled: false }, wordWrap: 'on', lineNumbers: 'on', padding: { top: 16 }, renderWhitespace: 'none', cursorBlinking: 'smooth', smoothScrolling: true }}
                />
              ) : (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}>
                    {activeDoc?.isBinary ? "Binaire bestanden (afbeeldingen) kunnen niet worden bewerkt." : "Selecteer een bestand."}
                </div>
              )}
            </div>
            <div onMouseDown={() => isResizingRef.current = true} style={{ width: '6px', cursor: 'col-resize', background: '#111', borderLeft: '1px solid #333', borderRight: '1px solid #333' }}></div>
            <div style={{ flex: 1, background: '#2d2d2d', overflow: 'hidden' }}>
              {pdfUrl ? (
                <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js">
                  <Viewer fileUrl={pdfUrl} theme="dark" plugins={[defaultLayoutPluginInstance]} />
                </Worker>
              ) : (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#444' }}>
                  <Eye size={48} style={{ opacity: 0.1, marginBottom: '10px' }}/>
                  <span>PDF wordt geladen...</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, background: '#000', padding: '40px', overflowY: 'auto' }}>
            <h2 style={{ color: '#ff5f56', display: 'flex', alignItems: 'center', gap: '12px' }}><AlertCircle /> Compilatie Fouten</h2>
            <pre style={{ background: '#111', padding: '24px', borderRadius: '12px', color: '#ddd', fontSize: '14px', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{logs}</pre>
            <button onClick={() => setView('split')} style={{ marginTop: '20px', background: '#333', color: 'white', border: 'none', padding: '10px 24px', borderRadius: '6px', cursor: 'pointer' }}>Sluiten</button>
          </div>
        )}
      </main>

      {showShare && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#252526', width: '450px', borderRadius: '16px', border: '1px solid #333', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}><UserPlus color="#0071e3"/> Deel Project</h2>
              <X style={{ cursor: 'pointer', color: '#666' }} onClick={() => setShowShare(false)}/>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
              <input value={shareEmail} onChange={e => setShareEmail(e.target.value)} placeholder="Email adres..." style={{ flex: 1, background: '#1e1e1e', border: '1px solid #333', padding: '10px', borderRadius: '8px', outline: 'none' }}/>
              <select value={sharePerm} onChange={e => setSharePerm(e.target.value)} style={{ background: '#333', border: 'none', padding: '10px', borderRadius: '8px' }}>
                <option value="read">Lezen</option>
                <option value="write">Bewerken</option>
              </select>
              <button onClick={() => { axios.post(`${API_URL}/projects/${id}/share`, { email: shareEmail, permission: sharePerm }, { headers: { Authorization: `Bearer ${token}` } }).then(() => { setShareEmail(''); fetchAll(); }); }} style={{ background: '#0071e3', border: 'none', color: 'white', padding: '10px 20px', borderRadius: '8px', fontWeight: 600 }}>Invite</button>
            </div>
            <div style={{ borderTop: '1px solid #333', paddingTop: '20px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#555', textTransform: 'uppercase' }}>Toegang</span>
              <div style={{ marginTop: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '16px', background: '#0071e3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Shield size={16}/></div>
                  <div style={{ flex: 1 }}><div style={{ fontSize: '14px', fontWeight: 600 }}>{project.owner.email}</div><div style={{ fontSize: '12px', color: '#666' }}>Eigenaar</div></div>
                </div>
                {project.sharedWith.map((s: any) => (
                  <div key={s.email} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '16px', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><UserIcon size={16}/></div>
                    <div style={{ flex: 1 }}><div style={{ fontSize: '14px' }}>{s.email}</div><div style={{ fontSize: '12px', color: '#666' }}>Kan {s.permission === 'read' ? 'lezen' : 'bewerken'}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
