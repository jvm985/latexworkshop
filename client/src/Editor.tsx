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
  Settings, Download, Maximize2, LogOut, Loader2, Upload,
  MoreVertical, Copy, Move, FileCode, ImageIcon, ZoomIn, ZoomOut,
  List, ScrollText, Edit3, MoreHorizontal
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
  
  const [activeBuffer, setActiveBuffer] = useState<'a' | 'b'>('a');
  const [pdfUrlA, setPdfUrlA] = useState<string | null>(null);
  const [pdfUrlB, setPdfUrlB] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  
  const [compiling, setCompiling] = useState(false);
  const [autoCompile, setAutoCompile] = useState(true);
  const [lastStatus, setLastStatus] = useState<'success' | 'error' | 'none'>('success');
  const [logs, setLogs] = useState<string | null>(null);
  const [parsedErrors, setParsedErrors] = useState<any[]>([]);
  const [logView, setLogView] = useState<'ordered' | 'raw'>('ordered');
  
  const [showShare, setShowShare] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [sharePerm, setSharePerm] = useState('read');
  const [showSettings, setShowSettings] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showFullLogs, setShowFullLogs] = useState(false);
  
  const [leftWidth, setLeftWidth] = useState(240);
  const [editorWidth, setEditorWidth] = useState(50);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ '/': true });
  
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, doc: any } | null>(null);
  
  const isResizingRef = useRef(false);
  const isResizingSidebarRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const editorRef = useRef<any>(null);
  const compileTimeoutRef = useRef<any>(null);
  const activeDocIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  
  const token = localStorage.getItem('latex_token');

  const parseLogErrors = (rawLogs: string, type: 'latex' | 'typst' | 'markdown') => {
      const errors: any[] = [];
      if (!rawLogs) return errors;
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
              const fileMatch = lines[i].match(/\(([^()]*?\.(?:tex|md|sty|cls))/);
              if (fileMatch) {
                  const cleaned = fileMatch[1].replace(/^\.\//, '');
                  if (!cleaned.includes('/usr/')) currentFile = cleaned;
              }
              const lineMatch = lines[i].match(/^l\.(\d+)/) || lines[i].match(/at line (\d+)/);
              if (lineMatch) {
                  errors.push({
                      file: currentFile,
                      line: parseInt(lineMatch[1]),
                      message: lines[i-1]?.startsWith('!') ? lines[i-1].substring(1).trim() : 'Error'
                  });
              }
          }
      }
      return errors;
  };

  const compile = async (isAutoMode = false, typeOverride?: string) => {
    if (compiling && isAutoMode) return;
    setCompiling(true);
    const pType = typeOverride || project?.type || 'latex';
    try {
      const currentDocName = activeDocIdRef.current ? documents.find(d => d._id === activeDocIdRef.current)?.name : null;
      const res = await axios.post(`${API_URL}/compile/${id}`, {
          preferredMain: currentDocName
      }, { 
        headers: { Authorization: `Bearer ${token}` }, 
        responseType: 'blob' 
      });
      
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      
      if (activeBuffer === 'a') {
          setPdfUrlB(url);
          setActiveBuffer('b');
          if (pdfUrlA) setTimeout(() => window.URL.revokeObjectURL(pdfUrlA), 3000);
      } else {
          setPdfUrlA(url);
          setActiveBuffer('a');
          if (pdfUrlB) setTimeout(() => window.URL.revokeObjectURL(pdfUrlB), 3000);
      }
      
      setLogs(null);
      setParsedErrors([]);
      setLastStatus('success');
    } catch (err: any) {
      setLastStatus('error');
      if (err.response?.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const result = JSON.parse(reader.result as string);
            const rawLogs = result.logs || 'Compilation failed.';
            setLogs(rawLogs);
            setParsedErrors(parseLogErrors(rawLogs, pType as any));
          } catch(e) { setLogs('Compilation error.'); }
        };
        reader.readAsText(err.response.data);
      }
    } finally { setCompiling(false); }
  };

  const fetchAll = async (doAutoCompile = false) => {
    try {
      const res = await axios.get(`${API_URL}/projects/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setProject(res.data.project);
      setDocuments(res.data.documents);
      
      if (res.data.documents.length > 0 && !activeDocIdRef.current) {
        const main = res.data.documents.find((d: any) => d.isMain) || res.data.documents.find((d: any) => d.name === 'main.tex' || d.name === 'main.typ' || d.name === 'main.md') || res.data.documents.find((d: any) => !d.isFolder && !d.isBinary) || res.data.documents[0];
        switchDoc(main);
      }
      if (doAutoCompile) compile(true, res.data.project.type);
    } catch (e) { navigate('/'); }
  };

  useEffect(() => {
    if (!token) {
        navigate('/login');
        return;
    }
    fetchAll(true);
    socketRef.current = io({ path: '/socket.io', transports: ['websocket'] });
    return () => { socketRef.current?.disconnect(); };
  }, [id, token]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        compile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [project, documents]);

  useEffect(() => {
    const docId = activeDoc?._id;
    if (!docId || !socketRef.current || activeDoc.isBinary || activeDoc.isFolder) return;
    const socket = socketRef.current;
    socket.emit('join-document', docId);
    
    const onUpdate = (content: string) => {
      if (activeDocIdRef.current === docId) {
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
    setDocuments(prev => prev.map(d => d._id === activeDoc._id ? { ...d, content: value } : d));
    socketRef.current?.emit('edit-document', { documentId: activeDoc._id, content: value });
    
    if (autoCompile) {
      if (compileTimeoutRef.current) clearTimeout(compileTimeoutRef.current);
      compileTimeoutRef.current = setTimeout(() => compile(true), 2000); 
    }
  };

  const jumpToError = (error: any) => {
      const foundDoc = documents.find(d => {
          const fullPath = (d.path + d.name).replace(/^\//, '');
          return fullPath === error.file || d.name === error.file || error.file.endsWith(d.name);
      });
      if (foundDoc) {
          switchDoc(foundDoc);
          setTimeout(() => {
              if (editorRef.current) {
                  editorRef.current.revealLineInCenter(error.line);
                  editorRef.current.setPosition({ lineNumber: error.line, column: 1 });
                  editorRef.current.focus();
              }
          }, 300);
      }
  };

  const switchDoc = (item: any, folderPath?: string) => {
      if (!item) return;
      if (item._isFolder) {
          if (folderPath) setExpandedFolders(prev => ({ ...prev, [folderPath]: !prev[folderPath] }));
          setActiveDoc(item._doc || { isFolder: true, path: item._path || '', name: item._name || '' }); 
          return;
      }
      setActiveDoc(item);
      activeDocIdRef.current = item._id;
      currentContentRef.current = item.content || '';
  };

  const setAsMain = async (fileId: string) => {
      await axios.post(`${API_URL}/projects/${id}/files/${fileId}/main`, {}, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
  };

  const renameFile = async (doc: any) => {
      const newName = prompt('Enter new name:', doc.name);
      if (!newName || newName === doc.name) return;
      await axios.patch(`${API_URL}/projects/${id}/files/${doc._id}`, { name: newName }, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
  };

  const updateProject = async (updates: any) => {
      const res = await axios.patch(`${API_URL}/projects/${id}`, updates, { headers: { Authorization: `Bearer ${token}` } });
      setProject(res.data);
  };

  const addFile = async (isFolder: boolean, targetDoc?: any) => {
    const name = prompt(`Enter ${isFolder ? 'folder' : 'file'} name:`);
    if (!name) return;
    
    let path = "";
    const base = targetDoc || activeDoc;
    if (base && base.isFolder) path = base.path + base.name + "/";
    else if (base && base.path) path = base.path;

    await axios.post(`${API_URL}/projects/${id}/files`, { name, isFolder, path }, { headers: { Authorization: `Bearer ${token}` } });
    fetchAll();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, isFolder = false, targetDoc?: any) => {
      const files = e.target.files;
      if (!files) return;
      
      let basePath = "";
      const base = targetDoc || activeDoc;
      if (base && base.isFolder) basePath = base.path + base.name + "/";
      else if (base && base.path) basePath = base.path;

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

  const copyFile = async (doc: any) => {
      const newName = prompt('Enter new name:', doc.name + ' (copy)');
      if (!newName) return;
      await axios.post(`${API_URL}/projects/${id}/files`, { name: newName, isFolder: doc.isFolder, isBinary: doc.isBinary, path: doc.path, content: doc.content, binaryData: doc.binaryData }, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
  };

  const moveFile = async (doc: any) => {
      const newPath = prompt('Enter new path (e.g. "subfolder/"):', doc.path);
      if (newPath === null) return;
      await axios.patch(`${API_URL}/projects/${id}/files/${doc._id}`, { path: newPath }, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
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
      if (isResizingSidebarRef.current) setLeftWidth(Math.max(150, Math.min(500, e.clientX)));
    };
    const handleMouseUp = () => {
      isResizingRef.current = false;
      isResizingSidebarRef.current = false;
      setContextMenu(null);
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
            current._children[part] = { _isFolder: true, _children: {}, _doc: null, _path: doc.path, _name: part };
          }
          if (isLast && doc.isFolder) current._children[part]._doc = doc;
          current = current._children[part];
        }
      });
    });
    return root;
  };

  const [activeItemMenu, setActiveItemMenu] = useState<string | null>(null);

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
      const itemId = doc?._id || folderPath;

      return (
        <div key={folderPath}>
          <div 
            onClick={() => switchDoc(item, folderPath)} 
            onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, doc }); }}
            style={{ display: 'flex', alignItems: 'center', padding: `4px 12px 4px ${depth * 12 + 12}px`, cursor: 'pointer', fontSize: '13px', background: activeDoc?._id === doc?._id ? '#37373d' : 'transparent', color: activeDoc?._id === doc?._id ? '#fff' : (doc?.isMain ? '#4ade80' : '#aaa'), gap: '8px', justifyContent: 'space-between', position: 'relative' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                {isFolderNode ? (isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>) : null}
                {isFolderNode ? <Folder size={14} style={{ color: '#dcb67a' }}/> : (doc?.isBinary ? <ImageIcon size={14} color="#dcb67a"/> : <FileText size={14} color="#519aba"/>)}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key}</span>
                {doc?.isMain && <CheckCircle2 size={12} color="#4ade80"/>}
            </div>
            
            {/* Explorer Item Menu (...) */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <button 
                    onClick={(e) => { e.stopPropagation(); setActiveItemMenu(activeItemMenu === itemId ? null : itemId); }}
                    style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '2px' }}
                >
                    <MoreVertical size={14}/>
                </button>
                {activeItemMenu === itemId && (
                    <div style={{ position: 'absolute', top: '100%', right: 0, background: '#252526', border: '1px solid #444', borderRadius: '6px', zIndex: 200, width: '140px', padding: '4px', boxShadow: '0 5px 15px rgba(0,0,0,0.5)' }}>
                        <button onClick={(e) => { e.stopPropagation(); if (doc) renameFile(doc); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><Edit3 size={12}/> Rename</button>
                        {doc && !doc.isFolder && <a href={`${API_URL}/projects/${id}/files/${doc._id}/raw`} download={doc.name} onClick={(e) => e.stopPropagation()} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}><Download size={12}/> Download</a>}
                        <button onClick={(e) => { e.stopPropagation(); if (doc) deleteFile(doc._id); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ff5f56', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><Trash2 size={12}/> Delete</button>
                        <div style={{ borderTop: '1px solid #333', margin: '4px 0' }}></div>
                        <button onClick={(e) => { e.stopPropagation(); addFile(false, doc || item); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><FilePlus size={12}/> New File</button>
                        <button onClick={(e) => { e.stopPropagation(); addFile(true, doc || item); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><FolderPlus size={12}/> New Folder</button>
                        <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><Upload size={12}/> Upload</button>
                    </div>
                )}
            </div>
          </div>
          {isFolderNode && isExpanded && renderNode(item, folderPath, depth + 1)}
        </div>
      );
    });
  };

  const currentPdfUrl = activeBuffer === 'a' ? pdfUrlA : pdfUrlB;

  if (!project) return <div style={{ background: '#1e1e1e', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>Laden...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#1e1e1e', color: 'white', overflow: 'hidden' }} onClick={() => { setActiveItemMenu(null); setShowProjectMenu(false); }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px', height: '48px', background: '#252526', borderBottom: '1px solid #333', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><ChevronLeft size={20}/></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 700 }}>{project?.name || 'Loading...'}</span>
            <span style={{ fontSize: '10px', background: '#333', padding: '2px 6px', borderRadius: '4px', color: '#888', fontWeight: 700 }}>{project?.type?.toUpperCase()}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ position: 'relative' }}>
              <button onClick={(e) => { e.stopPropagation(); setShowProjectMenu(!showProjectMenu); }} style={{ background: '#333', border: 'none', color: '#ccc', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>Project <ChevronDown size={14}/></button>
              {showProjectMenu && (
                  <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', background: '#252526', border: '1px solid #444', borderRadius: '8px', zIndex: 100, width: '180px', padding: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                      <button onClick={() => setShowShare(true)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '8px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}><Share2 size={14}/> Share</button>
                      <button onClick={() => setShowSettings(true)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '8px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}><Settings size={14}/> Settings</button>
                      <button onClick={convertProject} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '8px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}><RefreshCw size={14}/> Convert</button>
                  </div>
              )}
          </div>
          <button onClick={logout} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }} title="Logout"><LogOut size={18}/></button>
        </div>
      </nav>

      <main style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <aside style={{ width: `${leftWidth}px`, background: '#181818', borderRight: '1px solid #282828', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase' }}>Explorer</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }} onClick={() => addFile(false)} title="New File"><FilePlus size={14}/></button>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }} onClick={() => addFile(true)} title="New Folder"><FolderPlus size={14}/></button>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }} onClick={() => fileInputRef.current?.click()} title="Upload Files"><Upload size={14}/></button>
              <input type="file" ref={fileInputRef} onChange={(e) => handleUpload(e, false)} multiple style={{ display: 'none' }}/>
              <input type="file" ref={folderInputRef} onChange={(e) => handleUpload(e, true)} multiple {...{webkitdirectory: "", directory: ""} as any} style={{ display: 'none' }}/>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>{renderNode(buildTree(), '/', 0)}</div>
        </aside>
        <div onMouseDown={() => isResizingSidebarRef.current = true} style={{ width: '4px', cursor: 'col-resize', background: 'transparent', zIndex: 50 }}></div>
        
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Editor Area */}
            <div style={{ width: `${editorWidth}%`, height: '100%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #333' }}>
                <div style={{ background: '#2d2d2d', padding: '8px 16px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '12px', color: '#aaa', fontWeight: 600 }}>{activeDoc?.name || 'No file selected'}</span>
                        <div style={{ width: '8px', height: '8px', borderRadius: '4px', background: lastStatus === 'success' ? '#4ade80' : lastStatus === 'error' ? '#ff5f56' : '#666', cursor: 'pointer' }} onClick={() => { if (lastStatus === 'error') setParsedErrors(parseLogErrors(logs || '', project.type)); }} title={lastStatus === 'error' ? 'Show Errors' : 'Status OK'}/>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#888' }}>
                            <input type="checkbox" checked={autoCompile} onChange={(e) => setAutoCompile(e.target.checked)} style={{ cursor: 'pointer' }}/>
                            <span>Auto</span>
                        </div>
                        <button onClick={() => compile()} disabled={compiling} style={{ background: '#28a745', color: 'white', border: 'none', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}><Play size={12} fill="white"/> {compiling ? '...' : 'Compile'}</button>
                    </div>
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                    {activeDoc && !activeDoc.isBinary && !activeDoc.isFolder ? (
                        <Editor height="100%" language={activeDoc.name?.endsWith('.tex') ? 'latex' : (activeDoc.name?.endsWith('.md') ? 'markdown' : (project?.type === 'typst' ? 'typst' : 'latex'))} theme="vs-dark" value={activeDoc.content || ''} onChange={handleEditorChange} onMount={(editor) => editorRef.current = editor} options={{ fontSize: 16, minimap: { enabled: false }, wordWrap: 'on', lineNumbers: 'on', padding: { top: 16 }, renderWhitespace: 'none', cursorBlinking: 'smooth', smoothScrolling: true }} />
                    ) : activeDoc?.isBinary ? (
                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#1e1e1e', padding: '40px' }}>
                            {activeDoc.name.match(/\.(png|jpg|jpeg|gif|svg)$/i) ? <img src={`${API_URL}/projects/${id}/files/${activeDoc._id}/raw`} style={{ maxWidth: '100%', maxHeight: '100%', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', borderRadius: '8px' }} alt={activeDoc.name}/> : <div style={{ textAlign: 'center', color: '#444' }}><FileCode size={64} style={{ opacity: 0.1, marginBottom: '20px' }}/><div>Binary file: {activeDoc.name}</div></div>}
                        </div>
                    ) : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}>Select a file.</div>}
                </div>
            </div>

            <div onMouseDown={() => isResizingRef.current = true} style={{ width: '6px', cursor: 'col-resize', background: '#111', zIndex: 50 }}></div>

            {/* PDF Area */}
            <div style={{ flex: 1, background: '#2d2d2d', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                <div style={{ background: '#2d2d2d', padding: '8px 16px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setZoom(z => Math.max(50, z - 10))} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px', borderRadius: '4px', cursor: 'pointer' }} title="Zoom Out"><ZoomOut size={14}/></button>
                        <span style={{ fontSize: '11px', minWidth: '40px', textAlign: 'center' }}>{zoom}%</span>
                        <button onClick={() => setZoom(z => Math.min(200, z + 10))} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px', borderRadius: '4px', cursor: 'pointer' }} title="Zoom In"><ZoomIn size={14}/></button>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button onClick={() => setLogView(logView === 'ordered' ? 'raw' : 'ordered')} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>{logView === 'ordered' ? <ScrollText size={14}/> : <List size={14}/>} {logView === 'ordered' ? 'Raw' : 'Errors'}</button>
                        {(pdfUrlA || pdfUrlB) && <a href={currentPdfUrl || '#'} download={`${project?.name}.pdf`} style={{ background: '#333', color: '#ccc', padding: '4px', borderRadius: '4px' }}><Download size={14}/></a>}
                    </div>
                </div>
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {logs && !compiling && parsedErrors.length > 0 ? (
                    <div style={{ padding: '24px', height: '100%', overflowY: 'auto', background: '#1e1e1e' }}>
                        <h2 style={{ color: '#ff5f56', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '18px', marginBottom: '24px' }}><AlertCircle /> Compilation Error</h2>
                        {logView === 'ordered' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {parsedErrors.map((err, i) => (
                                    <div key={i} onClick={() => jumpToError(err)} style={{ background: '#2d2d2d', padding: '12px 16px', borderRadius: '8px', cursor: 'pointer', borderLeft: '4px solid #ff5f56' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span style={{ color: '#ff5f56', fontWeight: 700, fontSize: '12px' }}>{err.file}</span><span style={{ color: '#888', fontSize: '11px' }}>Line {err.line}</span></div>
                                        <div style={{ color: '#ddd', fontSize: '13px', fontFamily: 'monospace' }}>{err.message}</div>
                                    </div>
                                ))}
                            </div>
                        ) : <pre style={{ padding: '12px', background: '#000', color: '#aaa', fontSize: '11px', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{logs}</pre>}
                        {logView === 'ordered' && <button onClick={() => setShowFullLogs(!showFullLogs)} style={{ marginTop: '20px', background: 'none', border: 'none', color: '#666', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}>Toon volledige logs</button>}
                        {showFullLogs && logView === 'ordered' && <pre style={{ marginTop: '12px', padding: '12px', background: '#000', color: '#aaa', fontSize: '11px', whiteSpace: 'pre-wrap' }}>{logs}</pre>}
                    </div>
                ) : (
                    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
                        {compiling && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader2 size={32} className="animate-spin" color="#0071e3"/></div>}
                        {(pdfUrlA || pdfUrlB) && <div style={{ position: 'absolute', top: 10, right: 20, zIndex: 10, display: 'flex', gap: '8px' }}><button onClick={() => window.open(currentPdfUrl || '', '_blank')} style={{ background: '#333', color: 'white', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer' }} title="Open in new tab"><Maximize2 size={16}/></button></div>}
                        <iframe src={pdfUrlA ? `${pdfUrlA}#toolbar=0&navpanes=0&scrollbar=0&view=FitH&zoom=${zoom}` : 'about:blank'} style={{ width: '100%', height: '100%', border: 'none', background: '#2d2d2d', position: 'absolute', inset: 0, opacity: activeBuffer === 'a' ? 1 : 0, pointerEvents: activeBuffer === 'a' ? 'auto' : 'none' }} />
                        <iframe src={pdfUrlB ? `${pdfUrlB}#toolbar=0&navpanes=0&scrollbar=0&view=FitH&zoom=${zoom}` : 'about:blank'} style={{ width: '100%', height: '100%', border: 'none', background: '#2d2d2d', position: 'absolute', inset: 0, opacity: activeBuffer === 'b' ? 1 : 0, pointerEvents: activeBuffer === 'b' ? 'auto' : 'none' }} />
                        {!pdfUrlA && !pdfUrlB && !compiling && !logs && <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#444' }}><Eye size={48} style={{ opacity: 0.1, marginBottom: '10px' }}/><span>PDF Loading...</span></div>}
                    </div>
                )}
                </div>
            </div>
        </div>
      </main>

      {/* Context Menu */}
      {contextMenu && (
          <div style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, background: '#252526', border: '1px solid #444', borderRadius: '8px', zIndex: 1000, width: '160px', padding: '6px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
              <button onClick={() => copyFile(contextMenu.doc)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '8px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}><Copy size={14}/> Copy</button>
              <button onClick={() => moveFile(contextMenu.doc)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '8px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}><Move size={14}/> Move</button>
              <div style={{ borderTop: '1px solid #333', margin: '4px 0' }}></div>
              {!contextMenu.doc.isMain && !contextMenu.doc.isBinary && !contextMenu.doc.isFolder && <button onClick={() => setAsMain(contextMenu.doc._id)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#4ade80', padding: '8px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}><CheckCircle2 size={14}/> Set Main</button>}
              <button onClick={() => deleteFile(contextMenu.doc._id)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ff5f56', padding: '8px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}><Trash2 size={14}/> Delete</button>
          </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#252526', width: '400px', borderRadius: '12px', border: '1px solid #333', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Project Settings</h2>
              <X style={{ cursor: 'pointer', color: '#666' }} onClick={() => setShowSettings(false)}/>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#888', marginBottom: '8px' }}>Compiler</label>
              <select value={project?.compiler} onChange={(e) => updateProject({ compiler: e.target.value })} style={{ width: '100%', background: '#333', color: 'white', border: '1px solid #444', padding: '8px', borderRadius: '4px' }}>
                <option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option><option value="typst">Typst</option><option value="pandoc">Pandoc (Markdown)</option>
              </select>
            </div>
            <button onClick={() => setShowSettings(false)} style={{ width: '100%', background: '#0071e3', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', fontWeight: 600 }}>Save</button>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShare && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#252526', width: '450px', borderRadius: '16px', border: '1px solid #333', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}><UserPlus color="#0071e3"/> Share Project</h2>
              <X style={{ cursor: 'pointer', color: '#666' }} onClick={() => setShowShare(false)}/>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
              <input value={shareEmail} onChange={e => setShareEmail(e.target.value)} placeholder="Email address..." style={{ flex: 1, background: '#1e1e1e', border: '1px solid #333', padding: '10px', borderRadius: '8px', outline: 'none' }}/>
              <select value={sharePerm} onChange={e => setSharePerm(e.target.value)} style={{ background: '#333', border: 'none', padding: '10px', borderRadius: '8px' }}><option value="read">Read</option><option value="write">Write</option></select>
              <button onClick={() => { axios.post(`${API_URL}/projects/${id}/share`, { email: shareEmail, permission: sharePerm }, { headers: { Authorization: `Bearer ${token}` } }).then(() => { setShareEmail(''); fetchAll(); }); }} style={{ background: '#0071e3', border: 'none', color: 'white', padding: '10px 20px', borderRadius: '8px', fontWeight: 600 }}>Invite</button>
            </div>
            <div style={{ borderTop: '1px solid #333', paddingTop: '20px' }}><span style={{ fontSize: '12px', fontWeight: 700, color: '#555', textTransform: 'uppercase' }}>Access</span><div style={{ marginTop: '12px' }}><div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}><div style={{ width: '32px', height: '32px', borderRadius: '16px', background: '#0071e3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Shield size={16}/></div><div style={{ flex: 1 }}><div style={{ fontSize: '14px', fontWeight: 600 }}>{project?.owner?.email}</div><div style={{ fontSize: '12px', color: '#666' }}>Owner</div></div></div>{project?.sharedWith?.map((s: any) => (<div key={s.email} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}><div style={{ width: '32px', height: '32px', borderRadius: '16px', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><UserIcon size={16}/></div><div style={{ flex: 1 }}><div style={{ fontSize: '14px' }}>{s.email}</div><div style={{ fontSize: '12px', color: '#666' }}>Can {s.permission === 'read' ? 'read' : 'write'}</div></div></div>))}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}
