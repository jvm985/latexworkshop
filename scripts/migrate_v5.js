import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';

const sourceUri = 'mongodb://mongo:27017/sharelatex';
const destUri = 'mongodb://latexworkshop-db:27017/latexworkshop';
const userFilesPath = '/user_files'; 

async function migrate() {
    console.log('🚀 Start Migratie V5 (Robust Binary Handling)...');
    
    const sourceClient = new MongoClient(sourceUri);
    const destClient = new MongoClient(destUri);

    try {
        await sourceClient.connect();
        await destClient.connect();
        
        const sourceDb = sourceClient.db('sharelatex');
        const destDb = destClient.db('latexworkshop');

        // Clear existing data
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

            const migrateFolder = async (folder, currentPath) => {
                if (!folder) return;

                // 1. Docs
                for (const docRef of (folder.docs || [])) {
                    const docId = docRef._id || docRef;
                    const doc = await sourceDb.collection('docs').findOne({ _id: docId });
                    if (doc) {
                        const content = Array.isArray(doc.lines) ? doc.lines.join('\n') : '';
                        await destDb.collection('documents').insertOne({
                            project: newProjectId,
                            name: doc.name || 'unnamed.tex',
                            path: currentPath,
                            content: content,
                            isBinary: false,
                            isFolder: false
                        });
                    }
                }

                // 2. Binary Files
                for (const fileRef of (folder.fileRefs || [])) {
                    const fileId = fileRef._id || fileRef;
                    const diskFileName = `${oldProject._id}_${fileId}`;
                    const diskPath = path.join(userFilesPath, diskFileName);
                    
                    if (fs.existsSync(diskPath)) {
                        try {
                            const binaryData = fs.readFileSync(diskPath);
                            // Avoid huge files that break Mongo BSON limit (16MB)
                            if (binaryData.length > 15 * 1024 * 1024) {
                                console.warn(`⚠️ Skipping file ${fileRef.name} (Too large: ${binaryData.length} bytes)`);
                                continue;
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
                        } catch (err) {
                            console.error(`❌ Error reading binary file ${diskFileName}:`, err.message);
                        }
                    }
                }

                // 3. Subfolders
                for (const subFolder of (folder.folders || [])) {
                    const folderName = subFolder.name;
                    await destDb.collection('documents').insertOne({
                        project: newProjectId,
                        name: folderName,
                        path: currentPath,
                        isFolder: true,
                        isBinary: false
                    });
                    await migrateFolder(subFolder, `${currentPath}${folderName}/`);
                }
            };

            if (oldProject.rootFolder && oldProject.rootFolder[0]) {
                await migrateFolder(oldProject.rootFolder[0], '');
            }
        }

        console.log('✨ Migratie V5 Voltooid!');

    } catch (err) {
        console.error('❌ Fout:', err);
    } finally {
        await sourceClient.close();
        await destClient.close();
    }
}

migrate();
