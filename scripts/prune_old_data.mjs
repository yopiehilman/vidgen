import { getRetentionDays, pruneOldDocs } from './firestore_cleanup.mjs';

async function run() {
  try {
    const result = await pruneOldDocs(getRetentionDays());
    console.log(
      `Pruned old data successfully. history=${result.deletedHistory}, video_queue=${result.deletedQueue}, retentionDays=${result.retentionDays}.`,
    );
  } catch (error) {
    console.error('Error pruning old data:', error);
    process.exitCode = 1;
  }
}

run();
