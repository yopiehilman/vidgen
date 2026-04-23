import { clearCollection } from './firestore_cleanup.mjs';

async function run() {
  try {
    const historyDeleted = await clearCollection('history');
    const queueDeleted = await clearCollection('video_queue');
    console.log(`Deleted ${historyDeleted} documents from history.`);
    console.log(`Deleted ${queueDeleted} documents from video_queue.`);
    console.log('Database cleared successfully (users and settings preserved).');
  } catch (error) {
    console.error('Error clearing data:', error);
    process.exitCode = 1;
  }
}

run();
