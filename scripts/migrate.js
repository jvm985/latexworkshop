import { MongoClient } from 'mongodb';

const sourceUri = 'mongodb://mongo:27017/sharelatex';
const destUri = 'mongodb://latexworkshop-db:27017/latexworkshop';

async function migrate() {
    console.log('🚀 Start Migratie van ShareLaTeX naar LaTeX Workshop...');
    
    const sourceClient = new MongoClient(sourceUri);
    const destClient = new MongoClient(destUri);

    try {
        await sourceClient.connect();
        await destClient.connect();
        console.log('✅ Verbonden met beide databases.');
        
        const sourceDb = sourceClient.db('sharelatex');
        const destDb = destClient.db('latexworkshop');

        // 1. Migrate Users
        const sourceUsers = await sourceDb.collection('users').find({}).toArray();
        const userMap = {}; 
        
        for (const oldUser of sourceUsers) {
            let email = oldUser.email || (oldUser.emails && oldUser.emails[0] ? oldUser.emails[0].email : `user_${oldUser._id}@irishof.cloud`);
            
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
        console.log(`✅ Gemigreerde/Gevonden Gebruikers: ${sourceUsers.length}`);

        // 2. Migrate Projects
        const sourceProjects = await sourceDb.collection('projects').find({}).toArray();
        const projectMap = {}; 
        
        for (const oldProject of sourceProjects) {
            const ownerIdStr = oldProject.owner_ref ? oldProject.owner_ref.toString() : null;
            const newOwnerId = ownerIdStr ? userMap[ownerIdStr] : null;
            
            if (!newOwnerId) continue;

            const res = await destDb.collection('projects').insertOne({
                name: oldProject.name || 'Untitled',
                owner: newOwnerId,
                lastModified: oldProject.lastUpdated || new Date()
            });
            projectMap[oldProject._id.toString()] = res.insertedId;
        }
        console.log(`✅ Gemigreerde Projecten: ${Object.keys(projectMap).length}`);

        // 3. Migrate Docs (The actual .tex files)
        const sourceDocs = await sourceDb.collection('docs').find({}).toArray();
        let docsCount = 0;
        
        for (const oldDoc of sourceDocs) {
            const newProjectId = projectMap[oldDoc.project_id?.toString()];
            if (!newProjectId) continue;
            
            // ShareLaTeX slaat bestanden op als een array van tekstregels in de 'lines' eigenschap.
            const content = Array.isArray(oldDoc.lines) ? oldDoc.lines.join('\n') : '';
            
            await destDb.collection('documents').insertOne({
                project: newProjectId,
                name: oldDoc.name || 'document.tex',
                content: content
            });
            docsCount++;
        }
        console.log(`✅ Gemigreerde Documenten (Tex files): ${docsCount}`);
        console.log('✨ Migratie Voltooid! Je data staat nu in LaTeX Workshop.');

    } catch (err) {
        console.error('❌ Fout tijdens migratie:', err);
    } finally {
        await sourceClient.close();
        await destClient.close();
    }
}

migrate();
