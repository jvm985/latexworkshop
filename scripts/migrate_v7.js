import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';

const sourceUri = 'mongodb://mongo:27017/sharelatex';
const destUri = 'mongodb://latexworkshop-db:27017/latexworkshop';
const userFilesPath = '/user_files'; 

async function migrate() {
    console.log('🚀 Start Migratie V7 (Exact Embedded Structure Sync)...');
    
    const sourceClient = new MongoClient(sourceUri);
    const destClient = new MongoClient(destUri);

    try {
        await sourceClient.connect();
        await destClient.connect();
        
        const sourceDb = sourceClient.db('sharelatex');
        const destDb = destClient.db('latexworkshop');

        // Clear existing garbage
        await destDb.collection('projects').deleteMany({});
        await destDb.collection('documents').deleteMany({});

        const sourceUsers = await sourceDb.collection('users').find({}).toArray();
        const userMap = {}; 
        for (const oldUser of sourceUsers) {
            let email = oldUser.email || `user_${oldUser._id}@irishof.cloud`;
            let newUser = await destDb.collection('users').findOne({ email });
            if (!newUser) {
                const res = await destDb.collection('users').insertOne({
                    email: email,
                    name: oldUser.first_name ? `${oldUser.first_name} ${oldUser.last_name || ''}`.trim() : email.split('@')[0]
                });
                newUser = { _id: res.insertedId };
            }
            userMap[oldUser._id.toString()] = newUser._id;
        }

        const sourceProjects = await sourceDb.collection('projects').find({}).toArray();
        
        for (const oldProject of sourceProjects) {
            const ownerIdStr = oldProject.owner_ref ? oldProject.owner_ref.toString() : null;
            const newOwnerId = ownerIdStr ? userMap[ownerIdStr] : null;
            if (!newOwnerId) continue;

            console.log(`Migrating Project: ${oldProject.name}...`);

            const newProjRes = await destDb.collection('projects').insertOne({
                name: oldProject.name || 'Untitled',
                owner: newOwnerId,
                type: 'latex',
                compiler: 'pdflatex',
                sharedWith: [],
                lastModified: oldProject.lastUpdated || new Date()
            });
            const newProjectId = newProjRes.insertedId;

            // RECURSIVE FUNCTION FOR EMBEDDED STRUCTURE
            const migrateEmbeddedNode = async (node, currentPath) => {
                if (!node) return;

                // 1. Docs (Text files) - directly in the node
                for (const doc of (node.docs || [])) {
                    // Fetch actual content from docs collection
                    const docData = await sourceDb.collection('docs').findOne({ _id: doc._id });
                    if (docData) {
                        const isMain = oldProject.rootDoc_id && oldProject.rootDoc_id.toString() === docData._id.toString();
                        await destDb.collection('documents').insertOne({
                            project: newProjectId,
                            name: doc.name || 'unnamed.tex',
                            path: currentPath,
                            content: Array.isArray(docData.lines) ? docData.lines.join('\n') : '',
                            isBinary: false,
                            isFolder: false,
                            isMain: !!isMain
                        });
                    }
                }

                // 2. Files (Binary files) - directly in the node
                for (const fileRef of (node.fileRefs || [])) {
                    const fileId = fileRef._id;
                    const diskFileName = `${oldProject._id}_${fileId}`;
                    const diskPath = path.join(userFilesPath, diskFileName);
                    
                    let binaryData = null;
                    if (fs.existsSync(diskPath)) {
                        try {
                            const stats = fs.statSync(diskPath);
                            if (stats.size < 15 * 1024 * 1024) {
                                binaryData = fs.readFileSync(diskPath);
                            }
                        } catch (e) {}
                    }

                    await destDb.collection('documents').insertOne({
                        project: newProjectId,
                        name: fileRef.name || 'file',
                        path: currentPath,
                        content: '',
                        binaryData: binaryData,
                        isBinary: true,
                        isFolder: false,
                        isMain: false
                    });
                }

                // 3. Subfolders - directly in the node
                for (const subFolder of (node.folders || [])) {
                    const folderName = subFolder.name;
                    // Create folder record
                    await destDb.collection('documents').insertOne({
                        project: newProjectId,
                        name: folderName,
                        path: currentPath,
                        isFolder: true,
                        isBinary: false,
                        isMain: false
                    });
                    // RECURSE deeper into this folder node
                    await migrateEmbeddedNode(subFolder, `${currentPath}${folderName}/`);
                }
            };

            // Start migration from rootFolder
            if (oldProject.rootFolder && oldProject.rootFolder[0]) {
                await migrateEmbeddedNode(oldProject.rootFolder[0], '');
            }
        }

        console.log('✨ Migratie V7 Voltooid! Alles staat nu correct in LaTeX Workshop.');

    } catch (err) {
        console.error('❌ Fout tijdens migratie:', err);
    } finally {
        await sourceClient.close();
        await destClient.close();
    }
}

migrate();
