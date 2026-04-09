import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';

const sourceUri = 'mongodb://mongo:27017/sharelatex';
const destUri = 'mongodb://latexworkshop-db:27017/latexworkshop';
const userFilesPath = '/user_files'; 

async function migrate() {
    console.log('🚀 Start Migratie V8 (Smart Text/Binary Handling)...');
    
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

            const migrateEmbeddedNode = async (node, currentPath) => {
                if (!node) return;

                // 1. Docs (Text files)
                for (const doc of (node.docs || [])) {
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

                // 2. Files (Binary files OR uploaded text files)
                for (const fileRef of (node.fileRefs || [])) {
                    const fileId = fileRef._id;
                    const diskFileName = `${oldProject._id}_${fileId}`;
                    const diskPath = path.join(userFilesPath, diskFileName);
                    
                    let binaryData = null;
                    let content = '';
                    let isBinary = true;

                    if (fs.existsSync(diskPath)) {
                        try {
                            const stats = fs.statSync(diskPath);
                            const ext = path.extname(fileRef.name).toLowerCase();
                            const isTextExt = ['.tex', '.sty', '.cls', '.bib', '.txt'].includes(ext);

                            if (isTextExt && stats.size < 1024 * 1024) { // Max 1MB for text files
                                content = fs.readFileSync(diskPath, 'utf8');
                                isBinary = false;
                            } else if (stats.size < 15 * 1024 * 1024) {
                                binaryData = fs.readFileSync(diskPath);
                                isBinary = true;
                            }
                        } catch (e) {
                            console.error(`   ❌ Failed to read file ${fileRef.name}:`, e.message);
                        }
                    }

                    await destDb.collection('documents').insertOne({
                        project: newProjectId,
                        name: fileRef.name || 'file',
                        path: currentPath,
                        content: content,
                        binaryData: binaryData,
                        isBinary: isBinary,
                        isFolder: false,
                        isMain: false
                    });
                }

                // 3. Subfolders
                for (const subFolder of (node.folders || [])) {
                    const folderName = subFolder.name;
                    await destDb.collection('documents').insertOne({
                        project: newProjectId,
                        name: folderName,
                        path: currentPath,
                        isFolder: true,
                        isBinary: false,
                        isMain: false
                    });
                    await migrateEmbeddedNode(subFolder, `${currentPath}${folderName}/`);
                }
            };

            if (oldProject.rootFolder && oldProject.rootFolder[0]) {
                await migrateEmbeddedNode(oldProject.rootFolder[0], '');
            }
        }

        console.log('✨ Migratie V8 Voltooid!');

    } catch (err) {
        console.error('❌ Fout:', err);
    } finally {
        await sourceClient.close();
        await destClient.close();
    }
}

migrate();
