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

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { 
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/latexworkshop';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '339058057860-i6ne31mqs27mqm2ulac7al9vi26pmgo1.apps.googleusercontent.com';

mongoose.connect(MONGO_URI).then(() => console.log('✅ Connected to MongoDB (latexworkshop)'));

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
  type: { type: String, default: 'latex' },
  compiler: { type: String, default: 'pdflatex' },
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
  const authHeader = req.headers.authorization;
  console.log('Auth check for path:', req.path, 'Has header:', !!authHeader);
  const token = authHeader?.split(' ')[1];
  if (!token) return res.status(401).send('Unauthorized');
  try {
    const ticket = await client.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) throw new Error('Invalid token');
    let user = await User.findOne({ email: payload.email });
    if (!user) user = await User.create({ email: payload.email, name: payload.name, picture: payload.picture });
    req.user = user;
    next();
  } catch (err) { 
    console.error('Auth check failed:', err);
    res.status(401).send('Invalid token'); 
  }
};

// --- ROUTES ---
app.post('/api/auth/google', async (req, res) => {
  console.log('--- LOGIN ATTEMPT ---');
  const { credential } = req.body;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    console.log('Login for:', payload?.email);
    if (!payload || !payload.email) throw new Error('No email in payload');
    let user = await User.findOne({ email: payload.email });
    if (!user) user = await User.create({ email: payload.email, name: payload.name, picture: payload.picture });
    res.json({ token: credential, user });
  } catch (err: any) { 
    console.error('Login error:', err.message);
    res.status(400).send('Login failed'); 
  }
});

app.get('/api/projects', authenticate, async (req: any, res) => {
  console.log('Fetching projects for user:', JSON.stringify(req.user));
  const projects = await Project.find({ $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] }).populate('owner', 'name email');
  console.log('Found projects count:', projects.length);
  res.json(projects);
});

app.post('/api/projects', authenticate, async (req: any, res) => {
  const { name, type } = req.body;
  const project = await Project.create({ owner: req.user._id, name, type: type || 'latex' });
  await Document.create({ project: project._id, name: 'main.tex', content: 'Hello', isMain: true });
  res.json(project);
});

app.get('/api/projects/:id', authenticate, async (req: any, res) => {
  const project = await Project.findOne({ _id: req.params.id, $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] }).populate('owner', 'name email');
  if (!project) return res.status(404).send('Not found');
  const documents = await Document.find({ project: project._id });
  res.json({ project, documents });
});

// Basic placeholders for missing routes during restore
app.post('/api/projects/:id/files', authenticate, async (req: any, res) => {
    const { name, path, isFolder, isBinary, content, binaryData } = req.body;
    const doc = await Document.create({ project: req.params.id, name, path, isFolder, isBinary, content: content || '', binaryData: binaryData ? Buffer.from(binaryData, 'base64') : null });
    res.json(doc);
});

app.patch('/api/projects/:id/files/:fileId', authenticate, async (req: any, res) => {
    const doc = await Document.findOneAndUpdate({ _id: req.params.fileId, project: req.params.id }, req.body, { new: true });
    res.json(doc);
});

app.delete('/api/projects/:id/files/:fileId', authenticate, async (req: any, res) => {
    await Document.deleteOne({ _id: req.params.fileId, project: req.params.id });
    res.json({ success: true });
});

io.on('connection', (socket) => {
  socket.on('join-document', (documentId) => socket.join(documentId));
  socket.on('edit-document', async ({ documentId, content }) => {
    socket.to(documentId).emit('document-updated', content);
    await Document.findByIdAndUpdate(documentId, { content });
  });
});

httpServer.listen(PORT, () => console.log(`🚀 Workshop Backend running on port ${PORT}`));
