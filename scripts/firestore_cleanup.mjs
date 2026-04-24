import { cert, getApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, Timestamp } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env.local') });
dotenv.config({ path: path.join(rootDir, '.env') });

const DEFAULT_RETENTION_DAYS = Math.max(Number(process.env.VIDGEN_RETENTION_DAYS || 7), 1);
const MAX_BATCH_DELETE = 450;
let adminDb = null;

function getServiceAccount() {
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inlineJson) return JSON.parse(inlineJson);

  const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return { projectId, clientEmail, privateKey };
}

function getDb() {
  if (adminDb) {
    return adminDb;
  }

  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    return null;
  }

  const adminApp = getApps()[0] || initializeAdminApp({
    credential: cert(serviceAccount),
  });

  const databaseId = (process.env.FIRESTORE_DATABASE_ID || '').trim();
  adminDb = databaseId ? getAdminFirestore(adminApp, databaseId) : getAdminFirestore(adminApp);
  return adminDb;
}

function getCutoffTimestamp(retentionDays = DEFAULT_RETENTION_DAYS) {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return Timestamp.fromMillis(cutoffMs);
}

async function deleteQueryInBatches(query) {
  let totalDeleted = 0;

  while (true) {
    const snapshot = await query.limit(MAX_BATCH_DELETE).get();
    if (snapshot.empty) {
      return totalDeleted;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    totalDeleted += snapshot.size;

    if (snapshot.size < MAX_BATCH_DELETE) {
      return totalDeleted;
    }
  }
}

export async function clearCollection(collectionPath) {
  const db = getDb();
  if (!db) {
    return 0;
  }
  const collectionRef = db.collection(collectionPath);
  let totalDeleted = 0;

  while (true) {
    const snapshot = await collectionRef.limit(MAX_BATCH_DELETE).get();
    if (snapshot.empty) {
      return totalDeleted;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    totalDeleted += snapshot.size;

    if (snapshot.size < MAX_BATCH_DELETE) {
      return totalDeleted;
    }
  }
}

export async function pruneOldDocs(retentionDays = DEFAULT_RETENTION_DAYS) {
  const db = getDb();
  if (!db) {
    return {
      retentionDays,
      deletedHistory: 0,
      deletedQueue: 0,
    };
  }
  const cutoff = getCutoffTimestamp(retentionDays);
  const deletedHistory = await deleteQueryInBatches(
    db.collection('history').where('timestamp', '<', cutoff),
  );
  const deletedQueue = await deleteQueryInBatches(
    db.collection('video_queue').where('createdAt', '<', cutoff),
  );

  return {
    retentionDays,
    deletedHistory,
    deletedQueue,
  };
}

export function getRetentionDays() {
  return DEFAULT_RETENTION_DAYS;
}
