import mongoose from 'mongoose';
import { compileProject } from './dist/index.js';
import fs from 'fs';

const projectID = '69da29cd8c9f0dce52ed3e71';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/latexworkshop';

async function run() {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected.");

    // Models are already handled in compileProject import or defined below
    const Project = mongoose.models.Project || mongoose.model('Project', new mongoose.Schema({
        name: String,
        type: String,
        compiler: String,
    }));

    const Document = mongoose.models.Document || mongoose.model('Document', new mongoose.Schema({
        project: mongoose.Schema.Types.ObjectId,
        name: String,
        path: String,
        content: String,
        isBinary: Boolean,
        binaryData: Buffer,
        isMain: Boolean
    }));

    const project = await Project.findById(projectID);
    if (!project) {
        console.error("Project not found!");
        process.exit(1);
    }
    console.log(`Compiling project: ${project.name} (${project.compiler})`);

    const documents = await Document.find({ project: projectID, isFolder: false });
    console.log(`Found ${documents.length} non-folder documents.`);

    const options = {
        preferredMain: 'main.typ',
        mode: 'normal',
        usePreamble: false
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
