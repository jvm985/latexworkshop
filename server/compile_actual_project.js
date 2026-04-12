import mongoose from 'mongoose';
import { compileProject } from './dist/index.js';
import fs from 'fs';

const projectID = '69d8080ed0dd6fef006ae994';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/latexworkshop';

async function run() {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected.");

    const projectSchema = new mongoose.Schema({
        name: String,
        type: String,
        compiler: String,
    });
    const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);

    const documentSchema = new mongoose.Schema({
        project: mongoose.Schema.Types.ObjectId,
        name: String,
        path: String,
        content: String,
        isBinary: Boolean,
        binaryData: Buffer,
        isMain: Boolean
    });
    const Document = mongoose.models.Document || mongoose.model('Document', documentSchema);

    const project = await Project.findById(projectID);
    if (!project) {
        console.error("Project not found!");
        process.exit(1);
    }
    console.log(`Compiling project: ${project.name} (${project.compiler})`);

    const documents = await Document.find({ project: projectID, isFolder: false });
    console.log(`Found ${documents.length} non-folder documents.`);

    const options = {
        preferredMain: '5_geschiedenis.tex',
        mode: 'normal',
        usePreamble: true
    };

    console.log("\n--- TESTING ACTUAL PROJECT ---");
    try {
        const result = await compileProject(project, documents, options);
        console.log("✅ SUCCESS");
        console.log("PDF Path:", result.pdfPath);
        process.exit(0);
    } catch (err) {
        console.log("❌ FAILED");
        console.log("Error:", err.error);
        console.log("Logs (last 20 lines):");
        const lines = (err.logs || "").split('\n');
        console.log(lines.slice(-20).join('\n'));
        process.exit(1);
    }
}

run();
