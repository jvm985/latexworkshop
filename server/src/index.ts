import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { 
  cors: { origin: '*', methods: ['GET', 'POST'] },
  allowEIO3: true
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/latexworkshop';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '339058057860-i6ne31mqs27mqm2ulac7al9vi26pmgo1.apps.googleusercontent.com';

mongoose.connect(MONGO_URI).then(() => console.log('✅ Connected to MongoDB'));

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// --- MODELS ---
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  name: String,
  picture: String,
});
const User = mongoose.model('User', userSchema);

const projectSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['latex', 'typst'], default: 'latex' },
  compiler: { type: String, enum: ['pdflatex', 'xelatex', 'lualatex', 'typst'], default: 'pdflatex' },
  sharedWith: [{
    email: String,
    permission: { type: String, enum: ['read', 'write'], default: 'read' }
  }],
  lastModified: { type: Date, default: Date.now }
});
const Project = mongoose.model('Project', projectSchema);

const documentSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  name: { type: String, required: true },
  path: { type: String, default: '' },
  content: { type: String, default: '' },
  binaryData: { type: Buffer },
  isBinary: { type: Boolean, default: false },
  isFolder: { type: Boolean, default: false },
  isMain: { type: Boolean, default: false }
});
const Document = mongoose.model('Document', documentSchema);

// --- AUTH MIDDLEWARE ---
const authenticate = async (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send('Unauthorized');
  
  if (process.env.NODE_ENV === 'test' && token === 'mock-token') {
      req.user = await User.findOne({ email: 'test@gemini.com' });
      if (!req.user) req.user = await User.create({ email: 'test@gemini.com', name: 'Gemini Tester' });
      return next();
  }

  try {
    const ticket = await client.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) throw new Error('Invalid token');
    req.user = await User.findOne({ email: payload.email });
    if (!req.user) req.user = await User.create({ email: payload.email, name: payload.name, picture: payload.picture });
    next();
  } catch (err) { res.status(401).send('Invalid token'); }
};

// --- ROUTES ---
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload) throw new Error('No payload');
    let user = await User.findOne({ email: payload.email });
    if (!user) user = await User.create({ email: payload.email, name: payload.name, picture: payload.picture });
    res.json({ token: credential, user });
  } catch (err) { res.status(400).send('Login failed'); }
});

app.get('/api/projects', authenticate, async (req: any, res) => {
  const projects = await Project.find({ $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] }).populate('owner', 'name email').sort({ lastModified: -1 });
  res.json(projects);
});

app.post('/api/projects', authenticate, async (req: any, res) => {
  const { name, type } = req.body;
  const compiler = type === 'typst' ? 'typst' : 'pdflatex';
  const project = await Project.create({ owner: req.user._id, name, type, compiler });
  const mainFile = type === 'typst' ? 'main.typ' : 'main.tex';
  const content = type === 'typst' ? '#set page(paper: "a4")\n= Hello Typst' : '\\documentclass{article}\n\\begin{document}\nHello LaTeX!\n\\end{document}';
  await Document.create({ project: project._id, name: mainFile, content, isMain: true });
  res.json(project);
});

app.get('/api/projects/:id', authenticate, async (req: any, res) => {
  const project = await Project.findOne({ _id: req.params.id, $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] }).populate('owner', 'name email');
  if (!project) return res.status(404).send('Not found');
  const documents = await Document.find({ project: project._id }, { binaryData: 0 });
  res.json({ project, documents });
});

app.post('/api/projects/:id/files', authenticate, async (req: any, res) => {
  const { name, path, isFolder, isBinary, content, binaryData } = req.body;
  const doc = await Document.create({ 
    project: req.params.id, name, path, isFolder, isBinary, 
    content: content || '', 
    binaryData: binaryData ? Buffer.from(binaryData, 'base64') : null 
  });
  res.json(doc);
});

app.delete('/api/projects/:id/files/:fileId', authenticate, async (req: any, res) => {
    await Document.deleteOne({ _id: req.params.fileId, project: req.params.id });
    res.json({ success: true });
});

app.post('/api/projects/:id/files/:fileId/main', authenticate, async (req: any, res) => {
    await Document.updateMany({ project: req.params.id }, { isMain: false });
    await Document.updateOne({ _id: req.params.fileId, project: req.params.id }, { isMain: true });
    res.json({ success: true });
});

app.patch('/api/projects/:id', authenticate, async (req: any, res) => {
  const project = await Project.findOneAndUpdate({ _id: req.params.id, owner: req.user._id }, req.body, { new: true });
  res.json(project);
});

app.post('/api/projects/:id/share', authenticate, async (req: any, res) => {
  const { email, permission } = req.body;
  const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
  if (!project) return res.status(404).send('Not found');
  project.sharedWith.push({ email, permission });
  await project.save();
  res.json(project);
});

app.delete('/api/projects/:id', authenticate, async (req: any, res) => {
    await Project.deleteOne({ _id: req.params.id, owner: req.user._id });
    await Document.deleteMany({ project: req.params.id });
    res.json({ success: true });
});

// --- CONVERSION ENGINE (Pandoc) ---
app.post('/api/convert/:id', authenticate, async (req: any, res) => {
    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) return res.status(404).send('Not found');

    const targetType = project.type === 'latex' ? 'typst' : 'latex';
    const documents = await Document.find({ project: project._id, isFolder: false, isBinary: false });
    
    for (const doc of documents) {
        if (doc.name.endsWith('.tex') || doc.name.endsWith('.typ')) {
            const inputFormat = project.type === 'latex' ? 'latex' : 'typst';
            const outputFormat = targetType;
            const newName = doc.name.replace(/\.(tex|typ)$/, outputFormat === 'latex' ? '.tex' : '.typ');
            
            const cmd = `echo ${JSON.stringify(doc.content)} | pandoc -f ${inputFormat} -t ${outputFormat}`;
            exec(cmd, async (error, stdout) => {
                if (!error) {
                    await Document.create({ project: project._id, name: newName, content: stdout, path: doc.path });
                }
            });
        }
    }
    project.type = targetType;
    project.compiler = targetType === 'typst' ? 'typst' : 'pdflatex';
    await project.save();
    res.json(project);
});

// --- COMPILATION ENGINE ---
app.post('/api/compile/:id', authenticate, async (req: any, res) => {
  const project = await Project.findOne({ _id: req.params.id, $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] });
  if (!project) return res.status(404).send('Not found');
  
  const documents = await Document.find({ project: project._id, isFolder: false });
  const workDir = path.join('/tmp', `build_${project._id}_${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  let mainFile = '';
  let fallbackFile = '';

  for (const doc of documents) {
    const fullPath = path.join(workDir, doc.path, doc.name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    
    if (doc.isBinary && doc.binaryData) {
        fs.writeFileSync(fullPath, doc.binaryData);
    } else {
        fs.writeFileSync(fullPath, doc.content);
    }
    
    if (doc.isMain) mainFile = doc.name;

    if (project.type === 'typst') {
        if (!fallbackFile && doc.name.endsWith('.typ')) fallbackFile = doc.name;
    } else {
        if (!fallbackFile && doc.name.endsWith('.tex') && doc.content.includes('\\documentclass')) fallbackFile = doc.name;
    }
  }

  if (!mainFile) mainFile = fallbackFile || (documents.find(d => d.name.endsWith('.tex') || d.name.endsWith('.typ'))?.name || '');

  if (!mainFile) {
      return res.status(400).json({ error: 'Geen compileerbaar bestand gevonden.' });
  }

  let command = '';
  if (project.type === 'typst') {
    if (mainFile.endsWith('.tex')) {
        const newMain = mainFile.replace('.tex', '.typ');
        if (fs.existsSync(path.join(workDir, mainFile))) fs.renameSync(path.join(workDir, mainFile), path.join(workDir, newMain));
        mainFile = newMain;
    }
    command = `typst compile ${mainFile} main.pdf`;
  } else {
    const compiler = project.compiler === 'pdflatex' ? 'pdf' : project.compiler;
    // FIXED: Use -jobname=main to ensure output is always main.pdf
    command = `latexmk -${compiler} -interaction=nonstopmode -jobname=main -f "${mainFile}"`;
  }

  console.log(`Compiling project ${project.name} (${project.type}) with command: ${command}`);

  exec(command, { cwd: workDir, timeout: 60000 }, (error, stdout, stderr) => {
    const pdfPath = path.join(workDir, 'main.pdf');
    if (fs.existsSync(pdfPath)) {
      console.log(`✅ Compilation successful for ${project.name}`);
      res.sendFile(pdfPath, () => fs.rmSync(workDir, { recursive: true, force: true }));
    } else {
      console.error(`❌ Compilation failed for ${project.name}`);
      console.error(`STDOUT: ${stdout}`);
      console.error(`STDERR: ${stderr}`);
      res.status(500).json({ error: 'Compilatie mislukt.', logs: stdout + "\n" + stderr });
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});

io.on('connection', (socket) => {
  socket.on('join-document', (documentId) => socket.join(documentId));
  socket.on('edit-document', async ({ documentId, content }) => {
    socket.to(documentId).emit('document-updated', content);
    await Document.findByIdAndUpdate(documentId, { content });
  });
});

httpServer.listen(PORT, () => console.log(`🚀 LaTeX Workshop Backend running on port ${PORT}`));
