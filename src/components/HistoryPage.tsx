import React, { useEffect, useState } from 'react';
import { History as HistoryIcon, Trash2, Zap } from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { HistoryItem } from '../types';
import { handleFirestoreError, isFirestoreQuotaError, OperationType } from '../lib/utils';

interface HistoryPageProps {
  history: HistoryItem[];
  onClear: () => void | Promise<void>;
  onLoad: (item: HistoryItem) => void;
}

export default function HistoryPage({ history: localHistory, onClear, onLoad }: HistoryPageProps) {
  const [dbHistory, setDbHistory] = useState<HistoryItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentUser) {
      return;
    }

    const historyQuery = query(
      collection(db, 'history'),
      where('uid', '==', auth.currentUser.uid),
    );

    const unsubscribe = onSnapshot(
      historyQuery,
      (snapshot) => {
        const items = snapshot.docs
          .map((item) => {
            const data = item.data();
            return {
              desc: data.desc,
              kategori: data.kategori,
              result: data.result,
              time: data.timestamp?.toDate().toLocaleTimeString('id-ID') || '',
              slots: [],
            } as HistoryItem;
          })
          .sort((a, b) => b.time.localeCompare(a.time));

        setDbHistory(items);
        setLoadError(null);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'history');
        setLoadError(
          isFirestoreQuotaError(error)
            ? 'Quota Firestore habis untuk hari ini, menampilkan riwayat lokal jika tersedia.'
            : 'Riwayat Firestore sedang limit, menampilkan data lokal jika tersedia.',
        );
      },
    );

    return () => unsubscribe();
  }, []);

  const displayHistory = dbHistory.length > 0 ? dbHistory : localHistory;

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {loadError}
        </div>
      )}
      <div className="rounded-[20px] border border-border bg-card p-4.5">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 font-syne text-base font-bold">
            <HistoryIcon size={18} className="text-accent" />
            Riwayat Prompt
          </div>
          {displayHistory.length > 0 && (
            <button
              onClick={onClear}
              className="flex items-center gap-1.5 rounded-lg border border-danger/20 bg-danger/10 px-3 py-1.5 text-[11px] font-bold text-danger"
            >
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {displayHistory.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted">
            Belum ada riwayat.
            <br />
            Generate dulu yuk.
          </div>
        ) : (
          displayHistory.map((item, index) => (
            <div
              key={`${item.desc}-${index}`}
              onClick={() => onLoad(item)}
              className="cursor-pointer rounded-2xl border border-border bg-card2 p-4 transition-all hover:border-accent active:scale-[0.98]"
            >
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent2">
                <Zap size={12} /> {item.kategori}
              </div>
              <div className="line-clamp-2 text-[14px] font-dm text-[#9090B0]">{item.desc}</div>
              <div className="mt-2 flex items-center gap-1 text-[11px] text-muted">{item.time}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
