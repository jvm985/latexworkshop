import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';

const sourceUri = 'mongodb://mongo:27017/sharelatex';
const destUri = 'mongodb://latexworkshop-db:27017/latexworkshop';
const userFilesPath = '/user_files'; // Mounted in container

async function migrate() {
    console.log('🚀 Start Migratie V2 (Volledige Boomstructuur)...');
    
    const sourceClient = new MongoClient(sourceUri);
    const destClient = new MongoClient(destUri);

    try {
        await sourceClient.connect();
        await destClient.connect();
        
        const sourceDb = sourceClient.db('sharelatex');
        const destDb = destClient.db('latexworkshop');

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

            // 3. Recursive Folder Migration
            const migrateFolder = async (folderId, currentPath) => {
                const folder = await sourceDb.collection('folders').findOne({ _id: folderId });
                if (!folder) return;

                // Migrate Docs
                for (const docRef of (folder.docs || [])) {
                    const doc = await sourceDb.collection('docs').findOne({ _id: docRef._id || docRef });
                    if (doc) {
                        await destDb.collection('documents').insertOne({
                            project: newProjectId,
                            name: doc.name || 'unnamed.tex',
                            path: currentPath,
                            content: Array.isArray(doc.lines) ? doc.lines.join('\n') : '',
                            isBinary: false,
                            isFolder: false
                        });
                    }
                }

                // Migrate Binary Files
                for (const fileRef of (folder.fileRefs || [])) {
                    const fileId = fileRef._id || fileRef;
                    // Actual filename on disk in ShareLaTeX
                    const diskFileName = `${oldProject._id}_${fileId}`;
                    const diskPath = path.join(userFilesPath, diskFileName);
                    
                    let binaryData = null;
                    if (fs.existsSync(diskPath)) {
                        binaryData = fs.readFileSync(diskPath);
                    }

                    await destDb.collection('documents').insertOne({
                        project: newProjectId,
                        name: fileRef.name || 'file',
                        path: currentPath,
                        content: '',
                        binaryData: binaryData,
                        isBinary: true,
                        isFolder: false
                    });
                }

                // Subfolders
                for (const subFolderRef of (folder.folders || [])) {
                    await migrateFolder(subFolderRef._id || subFolderRef, `${currentPath}${subFolderRef.name}/`);
                }
            };

            if (oldProject.rootFolder && oldProject.rootFolder[0]) {
                await migrateFolder(oldProject.rootFolder[0], '');
            }
        }

        console.log('✨ Migratie V2 Voltooid!');

    } catch (err) {
        console.error('❌ Fout:', err);
    } finally {
        await sourceClient.close();
        await destClient.close();
    }
}

migrate();
