import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';

const sourceUri = 'mongodb://mongo:27017/sharelatex';
const destUri = 'mongodb://latexworkshop-db:27017/latexworkshop';
const userFilesPath = '/user_files'; 

async function migrate() {
    console.log('🚀 Start Migratie V6 (Embedded Structure Sync)...');
    
    const sourceClient = new MongoClient(sourceUri);
    const destClient = new MongoClient(destUri);

    try {
        await sourceClient.connect();
        await destClient.connect();
        
        const sourceDb = sourceClient.db('sharelatex');
        const destDb = destClient.db('latexworkshop');

        // Fresh Start
        await destDb.collection('projects').deleteMany({});
        await destDb.collection('documents').deleteMany({});

        // 1. Users
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

        // 2. Projects
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

            // Recurse using the embedded structure from rootFolder[0]
            const migrateEmbeddedFolder = async (folderNode, currentPath) => {
                if (!folderNode) return;

                // A. Migrate Docs in this node
                for (const docRef of (folderNode.docs || [])) {
                    const doc = await sourceDb.collection('docs').findOne({ _id: docRef._id });
                    if (doc) {
                        const isMain = oldProject.rootDoc_id && oldProject.rootDoc_id.toString() === doc._id.toString();
                        await destDb.collection('documents').insertOne({
                            project: newProjectId,
                            name: docRef.name || 'unnamed.tex',
                            path: currentPath,
                            content: Array.isArray(doc.lines) ? doc.lines.join('\n') : '',
                            isBinary: false,
                            isFolder: false,
                            isMain: !!isMain
                        });
                    }
                }

                // B. Migrate Files in this node
                for (const fileRef of (folderNode.fileRefs || [])) {
                    const fileId = fileRef._id;
                    const diskFileName = `${oldProject._id}_${fileId}`;
                    const diskPath = path.join(userFilesPath, diskFileName);
                    
                    let binaryData = null;
                    if (fs.existsSync(diskPath)) {
                        try {
                            const stats = fs.statSync(diskPath);
                            if (stats.size < 15 * 1024 * 1024) {
                                binaryData = fs.readFileSync(diskPath);
                            } else {
                                console.warn(`   ⚠️ File too large: ${fileRef.name}`);
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

                // C. Recurse into subfolders (also embedded)
                for (const subFolder of (folderNode.folders || [])) {
                    const folderName = subFolder.name;
                    // Create folder entry
                    await destDb.collection('documents').insertOne({
                        project: newProjectId,
                        name: folderName,
                        path: currentPath,
                        isFolder: true,
                        isBinary: false,
                        isMain: false
                    });
                    // Recurse into the embedded subfolder structure
                    await migrateEmbeddedFolder(subFolder, `${currentPath}${folderName}/`);
                }
            };

            if (oldProject.rootFolder && oldProject.rootFolder[0]) {
                await migrateEmbeddedFolder(oldProject.rootFolder[0], '');
            }
        }

        console.log('✨ Migratie V6 Voltooid!');

    } catch (err) {
        console.error('❌ Fout:', err);
    } finally {
        await sourceClient.close();
        await destClient.close();
    }
}

migrate();
