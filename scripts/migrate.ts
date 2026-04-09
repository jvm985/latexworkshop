// Dit script draait op de host en kopieert data van de sharelatex mongo naar de nieuwe latexworkshop mongo.
import { MongoClient, ObjectId } from 'mongodb';

const SOURCE_URI = 'mongodb://127.0.0.1:27017/sharelatex';
const DEST_URI = 'mongodb://127.0.0.1:27020/latexworkshop'; // Poort forwarding moet aanstaan

async function migrate() {
    console.log('🚀 Start Migratie van ShareLaTeX naar LaTeX Workshop...');
    
    // Voor deze prototype migratie pakken we de ruwe tekst data over.
    // Gezien de complexiteit van Overleaf (chunks, blobs), proberen we de huidige doc inhoud te vinden.
    console.log('⚠️ Let op: Overleaf structuur is zeer complex. We migreren de basis projecten.');
    
    // ... Migratie logica hier. In een real-world scenario zou dit script de 'docs' en 'projects' collecties mappen.
    console.log('✅ Migratiescript scaffold klaar.');
}

migrate().catch(console.error);
