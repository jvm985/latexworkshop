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
const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());

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
  isFolder: { type: Boolean, default: false }
});
const Document = mongoose.model('Document', documentSchema);

// --- AUTH MIDDLEWARE ---
const authenticate = async (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send('Unauthorized');
  try {
    const ticket = await client.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) throw new Error('Invalid token');
    req.user = await User.findOne({ email: payload.email });
    if (!req.user) {
        req.user = await User.create({ email: payload.email, name: payload.name, picture: payload.picture });
    }
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
  const projects = await Project.find({
    $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }]
  }).populate('owner', 'name email').sort({ lastModified: -1 });
  res.json(projects);
});

app.post('/api/projects', authenticate, async (req: any, res) => {
  const { name, type } = req.body;
  const compiler = type === 'typst' ? 'typst' : 'pdflatex';
  const project = await Project.create({ owner: req.user._id, name, type, compiler });
  const mainFile = type === 'typst' ? 'main.typ' : 'main.tex';
  const content = type === 'typst' ? '#set page(paper: "a4")\n= Hello Typst' : '\\documentclass{article}\n\\begin{document}\nHello LaTeX!\n\\end{document}';
  await Document.create({ project: project._id, name: mainFile, content });
  res.json(project);
});

app.get('/api/projects/:id', authenticate, async (req: any, res) => {
  const project = await Project.findOne({ _id: req.params.id, $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] }).populate('owner', 'name email');
  if (!project) return res.status(404).send('Not found');
  const documents = await Document.find({ project: project._id });
  res.json({ project, documents });
});

app.post('/api/projects/:id/files', authenticate, async (req: any, res) => {
  const { name, path, isFolder } = req.body;
  const doc = await Document.create({ project: req.params.id, name, path, isFolder, content: '' });
  res.json(doc);
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

// --- COMPILATION ENGINE ---
app.post('/api/compile/:id', authenticate, async (req: any, res) => {
  const project = await Project.findOne({ _id: req.params.id, $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] });
  if (!project) return res.status(404).send('Not found');
  
  const documents = await Document.find({ project: project._id, isFolder: false });
  const workDir = path.join('/tmp', `build_${project._id}_${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  let mainFile = '';
  for (const doc of documents) {
    const fullPath = path.join(workDir, doc.path, doc.name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, doc.content);
    
    // Determine main file based on project type
    if (project.type === 'typst') {
        if (doc.name === 'main.typ' || doc.name === 'main.tex') mainFile = doc.name;
    } else {
        if (doc.name === 'main.tex') mainFile = doc.name;
    }
  }
  
  // Fallback if no explicit main found
  if (!mainFile) {
      const ext = project.type === 'typst' ? '.typ' : '.tex';
      const fallback = documents.find(d => d.name.endsWith(ext));
      mainFile = fallback ? fallback.name : (documents[0]?.name || '');
  }

  let command = '';
  if (project.type === 'typst') {
    // If it's a .tex file being compiled as Typst (migration case), rename it temporarily
    if (mainFile.endsWith('.tex')) {
        const newMain = mainFile.replace('.tex', '.typ');
        fs.renameSync(path.join(workDir, mainFile), path.join(workDir, newMain));
        mainFile = newMain;
    }
    command = `typst compile ${mainFile} main.pdf`;
  } else {
    command = `${project.compiler} -interaction=nonstopmode -halt-on-error ${mainFile}`;
  }

  exec(command, { cwd: workDir, timeout: 30000 }, (error, stdout, stderr) => {
    const pdfPath = path.join(workDir, 'main.pdf');
    if (fs.existsSync(pdfPath)) {
      res.sendFile(pdfPath, () => fs.rmSync(workDir, { recursive: true, force: true }));
    } else {
      res.status(500).json({ 
        error: 'Compilation failed', 
        logs: stdout + "\n" + stderr + (error ? "\n" + error.message : "")
      });
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
