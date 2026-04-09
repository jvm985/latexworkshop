import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor, { loader } from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { 
  Play, ChevronLeft, FileText, 
  Eye, Folder, FilePlus, FolderPlus, 
  AlertCircle, Share2, X, UserPlus, Shield, User as UserIcon,
  ChevronDown, ChevronRight, Trash2, CheckCircle2, RefreshCw,
  Settings, Download, Maximize2, LogOut, Loader2, Upload
} from 'lucide-react';

const API_URL = '/api';

// --- ADVANCED MONACO SETUP ---
loader.init().then(monaco => {
  monaco.languages.register({ id: 'latex' });
  monaco.languages.setMonarchTokensProvider('latex', {
    defaultToken: '',
    tokenPostfix: '.latex',
    tokenizer: {
      root: [
        [/\\(?:[a-zA-Z]+|.)/, 'keyword'],
        [/\{/, { token: 'delimiter.curly', bracket: '@open' }],
        [/\}/, { token: 'delimiter.curly', bracket: '@close' }],
        [/\[/, { token: 'delimiter.square', bracket: '@open' }],
        [/\]/, { token: 'delimiter.square', bracket: '@close' }],
        [/%/, { token: 'comment', next: '@comment' }],
        [/\$.*?\$/, 'variable'],
        [/&/, 'operator'],
        [/\\\\/, 'operator'],
      ],
      comment: [
        [/[^%]+/, 'comment'],
        [/$/, 'comment', '@pop'],
      ],
    }
  });

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
  const [parsedErrors, setParsedErrors] = useState<any[]>([]);
  const [showShare, setShowShare] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [sharePerm, setSharePerm] = useState('read');
  const [showSettings, setShowSettings] = useState(false);
  const [showFullLogs, setShowFullLogs] = useState(false);
  
  const [leftWidth, setLeftWidth] = useState(240);
  const [editorWidth, setEditorWidth] = useState(50);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ '/': true });
  
  const isResizingRef = useRef(false);
  const isResizingSidebarRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const editorRef = useRef<any>(null);
  const compileTimeoutRef = useRef<any>(null);
  const currentContentRef = useRef<string>('');
  const activeDocIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  
  const token = localStorage.getItem('latex_token');

  const parseLogErrors = (rawLogs: string, type: 'latex' | 'typst') => {
      const errors: any[] = [];
      const lines = rawLogs.split('\n');
      if (type === 'typst') {
          for (let i = 0; i < lines.length; i++) {
              const match = lines[i].match(/┌─\s+(.*?):(\d+):(\d+)/);
              if (match) {
                  errors.push({
                      file: match[1].trim(),
                      line: parseInt(match[2]),
                      message: lines[i-1]?.trim() || 'Typst Error'
                  });
              }
          }
      } else {
          let currentFile = 'main.tex';
          for (let i = 0; i < lines.length; i++) {
              const fileMatch = lines[i].match(/\((.*?\.tex)/);
              if (fileMatch) currentFile = fileMatch[1].replace('./', '');
              const lineMatch = lines[i].match(/^l\.(\d+)/);
              if (lineMatch) {
                  errors.push({
                      file: currentFile,
                      line: parseInt(lineMatch[1]),
                      message: lines[i-1]?.startsWith('!') ? lines[i-1].substring(1).trim() : 'LaTeX Error'
                  });
              }
          }
      }
      return errors;
  };

  const compile = async (isAuto = false) => {
    if (compiling && isAuto) return;
    setCompiling(true);
    try {
      const res = await axios.post(`${API_URL}/compile/${id}`, {}, { 
        headers: { Authorization: `Bearer ${token}` }, 
        responseType: 'blob' 
      });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      setPdfUrl(prev => {
          if (prev) setTimeout(() => window.URL.revokeObjectURL(prev), 5000);
          return url;
      });
      setLogs(null);
      setParsedErrors([]);
    } catch (err: any) {
      if (err.response?.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const result = JSON.parse(reader.result as string);
            const rawLogs = result.logs || 'Compilation failed.';
            setLogs(rawLogs);
            setParsedErrors(parseLogErrors(rawLogs, project?.type || 'latex'));
            setPdfUrl(null);
          } catch(e) { setLogs('Compilation error.'); setPdfUrl(null); }
        };
        reader.readAsText(err.response.data);
      }
    } finally { setCompiling(false); }
  };

  const fetchAll = async (autoCompile = false) => {
    try {
      const res = await axios.get(`${API_URL}/projects/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setProject(res.data.project);
      setDocuments(res.data.documents);
      
      if (res.data.documents.length > 0 && !activeDocIdRef.current) {
        const main = res.data.documents.find((d: any) => d.isMain) || res.data.documents.find((d: any) => d.name === 'main.tex' || d.name === 'main.typ') || res.data.documents.find((d: any) => !d.isFolder && !d.isBinary) || res.data.documents[0];
        setActiveDoc(main);
        activeDocIdRef.current = main._id;
        currentContentRef.current = main.content || '';
      }
      if (autoCompile) compile(true);
    } catch (e) { navigate('/'); }
  };

  useEffect(() => {
    if (!token) {
        navigate('/login');
        return;
    }
    fetchAll(true);
    socketRef.current = io({ path: '/socket.io', transports: ['websocket'] });
    return () => { 
        socketRef.current?.disconnect(); 
    };
  }, [id, token]);

  useEffect(() => {
    const docId = activeDoc?._id;
    if (!docId || !socketRef.current || activeDoc.isBinary || activeDoc.isFolder) return;
    const socket = socketRef.current;
    socket.emit('join-document', docId);
    
    const onUpdate = (content: string) => {
      if (activeDocIdRef.current === docId && currentContentRef.current !== content) {
        currentContentRef.current = content;
        setActiveDoc((prev: any) => (prev?._id === docId ? { ...prev, content } : prev));
        setDocuments(prev => prev.map(d => d._id === docId ? { ...d, content } : d));
      }
    };
    socket.on('document-updated', onUpdate);
    
    return () => {
      socket.emit('leave-document', docId);
      socket.off('document-updated', onUpdate);
    };
  }, [activeDoc?._id]);

  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined || !activeDoc) return;
    currentContentRef.current = value;
    setDocuments(prev => prev.map(d => d._id === activeDoc._id ? { ...d, content: value } : d));
    socketRef.current?.emit('edit-document', { documentId: activeDoc._id, content: value });
    
    if (project?.type === 'typst') {
      if (compileTimeoutRef.current) clearTimeout(compileTimeoutRef.current);
      compileTimeoutRef.current = setTimeout(() => compile(true), 2000); 
    }
  };

  const jumpToError = (error: any) => {
      const foundDoc = documents.find(d => d.name === error.file || d.name.endsWith(error.file));
      if (foundDoc) {
          switchDoc(foundDoc);
          setTimeout(() => {
              if (editorRef.current) {
                  editorRef.current.revealLineInCenter(error.line);
                  editorRef.current.setPosition({ lineNumber: error.line, column: 1 });
                  editorRef.current.focus();
              }
          }, 100);
      }
  };

  const switchDoc = (newDoc: any) => {
      if (newDoc.isFolder) {
          setExpandedFolders(prev => ({ ...prev, [newDoc.path + newDoc.name + "/"]: !prev[newDoc.path + newDoc.name + "/"] }));
          setActiveDoc(newDoc); 
          return;
      }
      setActiveDoc(newDoc);
      activeDocIdRef.current = newDoc._id;
      currentContentRef.current = newDoc.content || '';
  };

  const setAsMain = async (fileId: string) => {
      await axios.post(`${API_URL}/projects/${id}/files/${fileId}/main`, {}, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
  };

  const updateProject = async (updates: any) => {
      const res = await axios.patch(`${API_URL}/projects/${id}`, updates, { headers: { Authorization: `Bearer ${token}` } });
      setProject(res.data);
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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, isFolder = false) => {
      const files = e.target.files;
      if (!files) return;
      let basePath = "";
      if (activeDoc && activeDoc.isFolder) basePath = activeDoc.path + activeDoc.name + "/";
      else if (activeDoc && activeDoc.path) basePath = activeDoc.path;

      for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const relativePath = (file as any).webkitRelativePath || "";
          let finalPath = basePath;
          let name = file.name;
          if (isFolder && relativePath) {
              const parts = relativePath.split('/');
              name = parts.pop()!;
              finalPath = basePath + parts.join('/') + (parts.length > 0 ? "/" : "");
          }
          const reader = new FileReader();
          reader.onload = () => {
              const base64 = (reader.result as string).split(',')[1];
              axios.post(`${API_URL}/projects/${id}/files`, { name, isFolder: false, isBinary: true, path: finalPath, binaryData: base64 }, { headers: { Authorization: `Bearer ${token}` } }).then(() => {
                  if (i === files.length - 1) fetchAll();
              });
          };
          reader.readAsDataURL(file);
      }
  };

  const deleteFile = async (docId: string) => {
    if (!confirm('Delete this item?')) return;
    await axios.delete(`${API_URL}/projects/${id}/files/${docId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (activeDoc?._id === docId) setActiveDoc(null);
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

  const logout = () => {
      localStorage.removeItem('latex_token');
      navigate('/login');
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

  const buildTree = () => {
    const root: any = { _isFolder: true, _children: {}, _doc: null };
    documents.forEach(doc => {
      const parts = (doc.path + (doc.isFolder ? "" : doc.name)).split('/').filter(Boolean);
      if (doc.isFolder) parts.push(doc.name); 
      let current = root;
      parts.forEach((part: string, index: number) => {
        const isLast = index === parts.length - 1;
        if (isLast && !doc.isFolder) {
          current._children[part] = doc;
        } else {
          if (!current._children[part] || !current._children[part]._isFolder) {
            current._children[part] = { _isFolder: true, _children: {}, _doc: null };
          }
          if (isLast && doc.isFolder) current._children[part]._doc = doc;
          current = current._children[part];
        }
      });
    });
    return root;
  };

  const renderNode = (node: any, path: string, depth: number) => {
    if (!node || !node._children) return null;
    const keys = Object.keys(node._children).sort((a, b) => {
      const itemA = node._children[a];
      const itemB = node._children[b];
      const isFolderA = !!itemA._isFolder;
      const isFolderB = !!itemB._isFolder;
      if (isFolderA && !isFolderB) return -1;
      if (!isFolderA && isFolderB) return 1;
      return a.localeCompare(b);
    });

    return keys.map(key => {
      const item = node._children[key];
      const isFolderNode = !!item._isFolder;
      const folderPath = `${path}${key}/`;
      const isExpanded = expandedFolders[folderPath];
      const doc = isFolderNode ? item._doc : item;

      return (
        <div key={folderPath}>
          <div 
            onClick={() => switchDoc(item)} 
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
            {activeDoc?._id === (doc?._id || null) && doc && (
                <div style={{ display: 'flex', gap: '8px' }}>
                    {!isFolderNode && !doc.isMain && !doc.isBinary && <Play size={12} onClick={(e) => { e.stopPropagation(); setAsMain(doc._id); }}/>}
                    <Trash2 size={12} color="#666" onClick={(e) => { e.stopPropagation(); deleteFile(doc._id); }}/>
                </div>
            )}
          </div>
          {isFolderNode && isExpanded && renderNode(item, folderPath, depth + 1)}
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
          <button onClick={() => setShowSettings(true)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }} title="Settings"><Settings size={18}/></button>
          <button onClick={convertProject} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }} title="Convert Project">
            <RefreshCw size={16}/> {project.type === 'latex' ? '-> Typst' : '-> LaTeX'}
          </button>
          <button onClick={() => setShowShare(true)} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}><Share2 size={16}/> Share</button>
          <button onClick={logout} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }} title="Logout"><LogOut size={18}/></button>
          {project.type === 'latex' && (
            <button onClick={() => compile()} disabled={compiling} style={{ background: '#28a745', color: 'white', border: 'none', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Play size={12} fill="white"/> {compiling ? '...' : 'Recompile'}
            </button>
          )}
        </div>
      </nav>

      <main style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <aside style={{ width: `${leftWidth}px`, background: '#181818', borderRight: '1px solid #282828', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase' }}>Bestanden</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }} onClick={() => addFile(false)} title="New File"><FilePlus size={14}/></button>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }} onClick={() => addFile(true)} title="New Folder"><FolderPlus size={14}/></button>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }} onClick={() => fileInputRef.current?.click()} title="Upload Files"><Upload size={14}/></button>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }} onClick={() => folderInputRef.current?.click()} title="Upload Folder"><Folder size={14}/></button>
              <input type="file" ref={fileInputRef} onChange={(e) => handleUpload(e, false)} multiple style={{ display: 'none' }}/>
              <input type="file" ref={folderInputRef} onChange={(e) => handleUpload(e, true)} multiple {...{webkitdirectory: "", directory: ""} as any} style={{ display: 'none' }}/>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>{renderNode(buildTree(), '/', 0)}</div>
          <div style={{ padding: '12px', borderTop: '1px solid #222', display: 'flex', justifyContent: 'center' }}>
              <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', color: '#666', fontSize: '12px', cursor: 'pointer' }}><LogOut size={14}/> Logout</button>
          </div>
        </aside>

        <div onMouseDown={() => isResizingSidebarRef.current = true} style={{ width: '4px', cursor: 'col-resize', background: 'transparent' }}></div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ width: `${editorWidth}%`, height: '100%' }}>
            {activeDoc && !activeDoc.isBinary && !activeDoc.isFolder ? (
                <Editor
                    height="100%"
                    language={activeDoc.name.endsWith('.tex') ? 'latex' : (project.type === 'typst' ? 'typst' : 'latex')}
                    theme="vs-dark"
                    value={activeDoc.content || ''}
                    onChange={handleEditorChange}
                    onMount={(editor) => editorRef.current = editor}
                    options={{ fontSize: 16, minimap: { enabled: false }, wordWrap: 'on', lineNumbers: 'on', padding: { top: 16 }, renderWhitespace: 'none', cursorBlinking: 'smooth', smoothScrolling: true }}
                />
            ) : (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', textAlign: 'center', padding: '20px' }}>
                    {activeDoc?.isBinary ? `Binaire bestanden (${activeDoc.name}) kunnen niet worden bewerkt.` : "Selecteer een bestand."}
                </div>
            )}
            </div>
            <div onMouseDown={() => isResizingRef.current = true} style={{ width: '6px', cursor: 'col-resize', background: '#111', borderLeft: '1px solid #333', borderRight: '1px solid #333' }}></div>
            <div style={{ flex: 1, background: '#2d2d2d', overflow: 'hidden', position: 'relative' }}>
            {pdfUrl ? (
                <div style={{ height: '100%', width: '100%' }}>
                    {compiling && (
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Loader2 size={32} className="animate-spin" color="#0071e3"/>
                        </div>
                    )}
                    <div style={{ position: 'absolute', top: 10, right: 20, zIndex: 10, display: 'flex', gap: '8px' }}>
                        <a href={pdfUrl} download={`${project.name}.pdf`} style={{ background: '#333', color: 'white', padding: '6px', borderRadius: '4px', display: 'flex', alignItems: 'center' }} title="Download PDF"><Download size={16}/></a>
                        <button onClick={() => window.open(pdfUrl, '_blank')} style={{ background: '#333', color: 'white', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer' }} title="Open in new tab"><Maximize2 size={16}/></button>
                    </div>
                    <iframe key={pdfUrl} src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0`} style={{ width: '100%', height: '100%', border: 'none', background: '#2d2d2d' }} />
                </div>
            ) : (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}>
                    {parsedErrors.length > 0 ? (
                        <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
                            <h2 style={{ color: '#ff5f56', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '18px', marginBottom: '24px' }}><AlertCircle /> Compilatie Fouten</h2>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {parsedErrors.map((err, i) => (
                                    <div key={i} onClick={() => jumpToError(err)} style={{ background: '#2d2d2d', padding: '12px 16px', borderRadius: '8px', cursor: 'pointer', borderLeft: '4px solid #ff5f56' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                            <span style={{ color: '#ff5f56', fontWeight: 700, fontSize: '12px' }}>{err.file}</span>
                                            <span style={{ color: '#888', fontSize: '11px' }}>Lijn {err.line}</span>
                                        </div>
                                        <div style={{ color: '#ddd', fontSize: '13px', fontFamily: 'monospace' }}>{err.message}</div>
                                    </div>
                                ))}
                            </div>
                            <button onClick={() => setShowFullLogs(!showFullLogs)} style={{ marginTop: '20px', background: 'none', border: 'none', color: '#666', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}>Toon volledige logs</button>
                            {showFullLogs && <pre style={{ marginTop: '12px', padding: '12px', background: '#000', color: '#aaa', fontSize: '11px', whiteSpace: 'pre-wrap' }}>{logs}</pre>}
                        </div>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#444' }}>
                            {compiling ? <Loader2 size={48} className="animate-spin" style={{ opacity: 0.1, marginBottom: '10px' }}/> : <Eye size={48} style={{ opacity: 0.1, marginBottom: '10px' }}/>}
                            <span>{compiling ? "Bezig met compileren..." : "Geen PDF beschikbaar."}</span>
                        </div>
                    )}
                </div>
            )}
            </div>
        </div>
      </main>

      {showSettings && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#252526', width: '400px', borderRadius: '12px', border: '1px solid #333', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Project Settings</h2>
              <X style={{ cursor: 'pointer', color: '#666' }} onClick={() => setShowSettings(false)}/>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#888', marginBottom: '8px' }}>Compiler</label>
              <select value={project.compiler} onChange={(e) => updateProject({ compiler: e.target.value })} style={{ width: '100%', background: '#333', color: 'white', border: '1px solid #444', padding: '8px', borderRadius: '4px' }}>
                <option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option>
              </select>
            </div>
            <button onClick={() => setShowSettings(false)} style={{ width: '100%', background: '#0071e3', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', fontWeight: 600 }}>Save</button>
          </div>
        </div>
      )}

      {showShare && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#252526', width: '450px', borderRadius: '16px', border: '1px solid #333', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}><UserPlus color="#0071e3"/> Deel Project</h2>
              <X style={{ cursor: 'pointer', color: '#666' }} onClick={() => setShowShare(false)}/>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
              <input value={shareEmail} onChange={e => setShareEmail(e.target.value)} placeholder="Email adres..." style={{ flex: 1, background: '#1e1e1e', border: '1px solid #333', padding: '10px', borderRadius: '8px', outline: 'none' }}/>
              <select value={sharePerm} onChange={e => setSharePerm(e.target.value)} style={{ background: '#333', border: 'none', padding: '10px', borderRadius: '8px' }}><option value="read">Lezen</option><option value="write">Bewerken</option></select>
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
