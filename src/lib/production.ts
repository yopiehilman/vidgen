import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { ProductionJobInput } from '../types';
import { handleFirestoreError, OperationType } from './utils';

export async function enqueueProductionJob(input: ProductionJobInput) {
  if (!auth.currentUser) {
    throw new Error('Anda harus login untuk mengirim job ke antrean produksi.');
  }

  try {
    const docRef = await addDoc(collection(db, 'video_queue'), {
      uid: auth.currentUser.uid,
      title: input.title,
      description: input.description || '',
      prompt: input.prompt,
      status: input.status || 'pending',
      source: input.source,
      category: input.category || '',
      scheduledTime: input.scheduledTime || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      metadata: input.metadata || {},
    });

    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'video_queue');
  }
}
