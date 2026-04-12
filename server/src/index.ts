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
import mime from 'mime-types';

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
  type: { type: String, enum: ['latex', 'typst', 'markdown'], default: 'latex' },
  compiler: { type: String, enum: ['pdflatex', 'xelatex', 'lualatex', 'typst', 'pandoc'], default: 'pdflatex' },
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
  let compiler = 'pdflatex';
  if (type === 'typst') compiler = 'typst';
  if (type === 'markdown') compiler = 'pandoc';
  
  const project = await Project.create({ owner: req.user._id, name, type, compiler });
  
  let mainFile = 'main.tex';
  let content = '\\documentclass{article}\n\\begin{document}\nHello LaTeX!\n\\end{document}';
  if (type === 'typst') {
      mainFile = 'main.typ';
      content = '#set page(paper: "a4")\n= Hello Typst';
  } else if (type === 'markdown') {
      mainFile = 'main.md';
      content = '# Hello Markdown\n\nThis is a professional document.';
  }
  
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

app.get('/api/projects/:id/files/:fileId/raw', authenticate, async (req: any, res) => {
    const doc = await Document.findOne({ _id: req.params.fileId, project: req.params.id });
    if (!doc) return res.status(404).send('File not found');
    
    const contentType = mime.lookup(doc.name) || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);

    if (doc.isBinary && doc.binaryData) {
        res.send(doc.binaryData);
    } else {
        res.send(doc.content);
    }
});

app.patch('/api/projects/:id/files/:fileId', authenticate, async (req: any, res) => {
    const oldDoc = await Document.findOne({ _id: req.params.fileId, project: req.params.id });
    if (!oldDoc) return res.status(404).send('File not found');

    const { path: newPath, name: newName } = req.body;

    if (oldDoc.isFolder && (newPath !== undefined || newName !== undefined)) {
        const oldFolderPath = oldDoc.path + oldDoc.name + "/";
        const folderName = newName !== undefined ? newName : oldDoc.name;
        const folderParentPath = newPath !== undefined ? newPath : oldDoc.path;
        const newFolderPath = folderParentPath + folderName + "/";

        const children = await Document.find({ project: req.params.id, path: new RegExp('^' + oldFolderPath) });
        for (const child of children) {
            const updatedPath = child.path.replace(oldFolderPath, newFolderPath);
            await Document.updateOne({ _id: child._id }, { path: updatedPath });
        }
    }

    const doc = await Document.findOneAndUpdate(
        { _id: req.params.fileId, project: req.params.id }, 
        req.body, 
        { new: true }
    );
    res.json(doc);
});

app.delete('/api/projects/:id/files/:fileId', authenticate, async (req: any, res) => {
    const doc = await Document.findOne({ _id: req.params.fileId, project: req.params.id });
    if (doc?.isFolder) {
        const folderPath = doc.path + doc.name + "/";
        await Document.deleteMany({ project: req.params.id, path: new RegExp('^' + folderPath) });
    }
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

// --- COMPILATION ENGINE ---
export const compileProject = async (project: any, documents: any[], options: any) => {
    const { preferredMain, mode, usePreamble, currentContent, currentFileId } = options;
    
    // RAM-DISK Support
    const baseDir = fs.existsSync('/dev/shm') ? '/dev/shm' : '/tmp';
    const workDir = path.join(baseDir, `workshop_project_${project._id}`);
    const cacheDir = path.join(baseDir, `workshop_cache_${project._id}`);
    
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    // CRITICAL: Delete old PDF to prevent sending stale versions
    const pdfPath = path.join(workDir, 'main.pdf');
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

    let mainFile = '';
    let fallbackFile = '';
    let latestModTime = 0;

    for (const doc of documents) {
        const fullPath = path.join(workDir, doc.path, doc.name);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        
        // Use currentContent if this is the file being edited
        const contentToUse = (currentFileId && doc._id.toString() === currentFileId) ? currentContent : doc.content;
        let newContent = doc.isBinary && doc.binaryData ? doc.binaryData : Buffer.from(contentToUse || '');
        
        if (!fs.existsSync(fullPath) || !fs.readFileSync(fullPath).equals(newContent)) {
            fs.writeFileSync(fullPath, newContent);
        }
        
        // Track the latest modification time among all files
        const stats = fs.statSync(fullPath);
        if (stats.mtimeMs > latestModTime) latestModTime = stats.mtimeMs;
        
        const relPath = path.join(doc.path, doc.name);
        if (preferredMain && doc.name === preferredMain) {
            if (project.type === 'typst' && preferredMain.endsWith('.typ')) mainFile = relPath;
            else if (project.type === 'markdown' && preferredMain.endsWith('.md')) mainFile = relPath;
            else if (project.type === 'latex' && (doc.content?.includes('\\documentclass') || contentToUse?.includes('\\documentclass'))) mainFile = relPath;
        }
        if (doc.isMain && !mainFile) mainFile = relPath;
        if (project.type === 'typst' && !fallbackFile && doc.name.endsWith('.typ')) fallbackFile = relPath;
        if (project.type === 'markdown' && !fallbackFile && doc.name.endsWith('.md')) fallbackFile = relPath;
        if (project.type === 'latex' && !fallbackFile && (doc.name.endsWith('.tex') || doc.name.endsWith('.cls') || doc.name.endsWith('.sty')) && (doc.content?.includes('\\documentclass') || contentToUse?.includes('\\documentclass'))) fallbackFile = relPath;
    }

    if (!mainFile) mainFile = fallbackFile || (documents.find(d => d.name.endsWith('.tex') || d.name.endsWith('.typ') || d.name.endsWith('.md'))?.name || '');
    if (!mainFile) {
        return { 
            error: 'Geen compileerbaar bestand gevonden.', 
            logs: 'De compiler kon geen hoofdbestand (.tex, .typ, of .md) vinden om te verwerken. Zorg ervoor dat er een bestand is met \\documentclass (voor LaTeX) of gebruik de "Set Main" optie.' 
        };
    }

    // Use a fixed job name internally for consistency
    const jobName = '__main__';
    const mainDir = path.dirname(mainFile);
    const compileDir = path.join(workDir, mainDir);
    const ext = path.extname(mainFile);
    const compilationTarget = `${jobName}${ext}`;
    const targetPath = path.join(compileDir, compilationTarget);

    const absLogPath = path.join(compileDir, `${jobName}.log`);
    const absSynctexPath = path.join(compileDir, `${jobName}.synctex.gz`);
    const absActualPdfPath = path.join(compileDir, `${jobName}.pdf`);

    // Clean up old output files
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    if (fs.existsSync(absActualPdfPath)) fs.unlinkSync(absActualPdfPath);
    if (fs.existsSync(absLogPath)) fs.unlinkSync(absLogPath);
    if (fs.existsSync(absSynctexPath)) fs.unlinkSync(absSynctexPath);

    // Prepare compilation target in the same directory as the original main file to preserve relative paths
    let targetContent = fs.readFileSync(path.join(workDir, mainFile), 'utf8');
    if (project.type === 'latex' && usePreamble && !targetContent.includes('endpreamble')) {
        // Find a safe spot for endpreamble: BEFORE packages that load native fonts or any input/include
        const problematicRegex = /(\\usepackage\s*\{(?:fontspec|polyglossia|unicode-math)\}|\\input\s*\{|\\include\s*\{)/i;
        
        // Add safety definition at the very top (mylatexformat ignores things before \documentclass)
        targetContent = '\\ifdefined\\endpreamble\\else\\let\\endpreamble\\relax\\fi\n' + targetContent;

        const marker = '\n\\endpreamble\n';
        
        if (problematicRegex.test(targetContent)) {
            targetContent = targetContent.replace(problematicRegex, `${marker}$1`);
        } else {
            targetContent = targetContent.replace(/\\begin\s*\{document\}/i, `${marker}\\begin{document}`);
        }
    }
    console.log('--- TARGET CONTENT HEAD ---');
    console.log(targetContent.slice(0, 500));
    console.log('---------------------------');
    fs.writeFileSync(targetPath, targetContent);

    let command = '';
    const env = { ...process.env, TYPST_CACHE_DIR: cacheDir };

    if (project.type === 'typst') {
        command = `typst compile "${compilationTarget}" "${absActualPdfPath}"`;
    } else if (project.type === 'markdown') {
        command = `pandoc "${compilationTarget}" -o "${absActualPdfPath}"`;
    } else {
        const compiler = project.compiler === 'pdflatex' ? 'pdflatex' : project.compiler;
        // Include compiler name in fmt name to avoid engine conflicts
        const fmtName = `${jobName}_${compiler}`;
        const fmtPath = path.join(compileDir, `${fmtName}.fmt`);
        
        if (usePreamble) {
            let shouldRegenerate = !fs.existsSync(fmtPath);
            if (!shouldRegenerate) {
                const fmtStats = fs.statSync(fmtPath);
                if (latestModTime > fmtStats.mtimeMs) shouldRegenerate = true;
            }

            if (shouldRegenerate) {
                const dumpCmd = `${compiler} -ini -interaction=nonstopmode -jobname="${fmtName}" "&${compiler}" mylatexformat.ltx "${compilationTarget}"`;
                await new Promise((resolve) => {
                    exec(dumpCmd, { cwd: compileDir, env }, (error, stdout, stderr) => {
                        if (error) {
                            console.error('Preamble dump failed!');
                            console.error('Command:', dumpCmd);
                            console.error('STDOUT:', stdout);
                            console.error('STDERR:', stderr);
                        }
                        resolve(true);
                    });
                });
            }
        }

        const fmtFlag = (usePreamble && fs.existsSync(fmtPath)) ? `-fmt "${fmtName}"` : '';
        if (mode === 'draft') {
            command = `${compiler} -interaction=nonstopmode -synctex=1 ${fmtFlag} -jobname="${jobName}" "${compilationTarget}"`;
        } else {
            let latexmkCompiler = '-pdf';
            if (project.compiler === 'xelatex') latexmkCompiler = '-pdfxe';
            else if (project.compiler === 'lualatex') latexmkCompiler = '-pdflua';
            
            // Simpler flags are more robust
            const latexmkFmt = fmtFlag ? `-latexoption="${fmtFlag}"` : '';
            command = `latexmk ${latexmkCompiler} -interaction=nonstopmode -jobname="${jobName}" -f -synctex=1 ${latexmkFmt} "${compilationTarget}"`;
        }
    }

    return new Promise((resolve, reject) => {
        exec(command, { cwd: compileDir, timeout: 60000, env }, (error, stdout, stderr) => {
            let combinedLogs = "";
            if (error) {
                combinedLogs += `--- EXECUTION ERROR ---\n${error.message}\n\n`;
            }
            combinedLogs += `--- STDOUT ---\n${stdout}\n--- STDERR ---\n${stderr}`;
            
            if (fs.existsSync(absLogPath)) {
                combinedLogs += "\n\n--- FULL LATEX LOG ---\n" + fs.readFileSync(absLogPath, 'utf8');
            }

            if (fs.existsSync(absActualPdfPath)) {
                fs.renameSync(absActualPdfPath, pdfPath);
                if (fs.existsSync(absSynctexPath)) {
                    fs.copyFileSync(absSynctexPath, path.join('/tmp', `synctex_${project._id}.gz`));
                }
                resolve({ pdfPath, logs: combinedLogs });
            } else {
                reject({ error: 'Compilatie mislukt.', logs: combinedLogs });
            }
        });
    });
};

app.post('/api/compile/:id', authenticate, async (req: any, res: any) => {
  const project = await Project.findOne({ _id: req.params.id, $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] });
  if (!project) return res.status(404).send('Not found');
  
  const documents = await Document.find({ project: project._id, isFolder: false });
  try {
      const result: any = await compileProject(project, documents, req.body);
      if (result.pdfPath) {
          res.sendFile(result.pdfPath);
      } else {
          // This handles the case where compileProject returned a success object but without a PDF path (e.g. the mainFile check)
          res.status(400).json(result);
      }
  } catch (err: any) {
      // Ensure we send a proper JSON object even if it's an Error instance
      if (err instanceof Error) {
          res.status(500).json({ error: err.message, logs: err.stack });
      } else {
          res.status(500).json(err);
      }
  }
});

// SyncTeX API
app.get('/api/projects/:id/synctex', authenticate, async (req: any, res) => {
    const { line, file } = req.query;
    const synctexFile = path.join('/tmp', `synctex_${req.params.id}.gz`);
    if (!fs.existsSync(synctexFile)) return res.status(404).send('SyncTeX file not found');

    const command = `synctex view -i ${line}:0:${file} -o dummy.pdf`;
    exec(command, { cwd: '/tmp' }, (error, stdout) => {
        if (error) return res.status(500).send('SyncTeX error');
        const pageMatch = stdout.match(/Page:(\d+)/);
        const yMatch = stdout.match(/y:([\d.]+)/);
        if (pageMatch) {
            res.json({
                page: parseInt(pageMatch[1]),
                y: yMatch ? parseFloat(yMatch[1]) : 0
            });
        } else {
            res.status(404).send('Position not found');
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

// --- CLEANUP TASK ---
const cleanupOldProjects = () => {
    const baseDir = fs.existsSync('/dev/shm') ? '/dev/shm' : '/tmp';
    const dirs = fs.readdirSync(baseDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const dir of dirs) {
        if (dir.startsWith('workshop_project_') || dir.startsWith('workshop_cache_')) {
            const fullPath = path.join(baseDir, dir);
            try {
                const stats = fs.statSync(fullPath);
                const age = now - Math.max(stats.atimeMs, stats.mtimeMs);
                if (age > maxAge) {
                    console.log(`🧹 Cleaning up old project directory: ${dir}`);
                    fs.rmSync(fullPath, { recursive: true, force: true });
                }
            } catch (err) {
                console.error(`❌ Error during cleanup of ${dir}:`, err);
            }
        }
    }
};
setInterval(cleanupOldProjects, 60 * 60 * 1000); // Run every hour
cleanupOldProjects(); // Run once at start

if (!process.env.NO_LISTEN) {
    httpServer.listen(PORT, () => console.log(`🚀 Workshop Backend running on port ${PORT}`));
}
