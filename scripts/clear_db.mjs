import { cert, getApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env.local') });
dotenv.config({ path: path.join(rootDir, '.env') });

function getServiceAccount() {
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inlineJson) return JSON.parse(inlineJson);

  return {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  };
}

if (!getApps().length) {
  initializeAdminApp({
    credential: cert(getServiceAccount()),
  });
}

const db = getAdminFirestore();

async function clearCollection(collectionPath) {
  const collectionRef = db.collection(collectionPath);
  const snapshot = await collectionRef.get();
  
  if (snapshot.size === 0) {
    console.log(`Collection ${collectionPath} is already empty.`);
    return;
  }
  
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  
  await batch.commit();
  console.log(`Deleted ${snapshot.size} documents from ${collectionPath}.`);
}

async function run() {
  try {
    await clearCollection('history');
    await clearCollection('video_queue');
    console.log('Database cleared successfully (users and settings preserved).');
  } catch (error) {
    console.error('Error clearing data:', error);
  }
}

run();
