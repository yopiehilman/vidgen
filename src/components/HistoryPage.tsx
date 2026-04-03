import React, { useEffect, useState } from 'react';
import { HistoryItem } from '../types';
import { Trash2, History as HistoryIcon, Zap } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface HistoryPageProps {
  history: HistoryItem[]; // Still keep local history for immediate UI updates
  onClear: () => void;
  onLoad: (item: HistoryItem) => void;
}

export default function HistoryPage({ history: localHistory, onClear, onLoad }: HistoryPageProps) {
  const [dbHistory, setDbHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, 'history'),
      where('uid', '==', auth.currentUser.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          desc: data.desc,
          kategori: data.kategori,
          result: data.result,
          time: data.timestamp?.toDate().toLocaleTimeString('id-ID') || '',
          slots: [] // Simplified for now
        } as HistoryItem;
      });
      setDbHistory(items);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'history');
    });

    return () => unsubscribe();
  }, []);

  const displayHistory = dbHistory.length > 0 ? dbHistory : localHistory;
  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-[20px] p-4.5">
        <div className="flex items-center justify-between mb-2">
          <div className="font-syne text-base font-bold flex items-center gap-2">
            <HistoryIcon size={18} className="text-accent" /> Riwayat Prompt
          </div>
          {history.length > 0 && (
            <button 
              onClick={onClear}
              className="px-3 py-1.5 bg-danger/10 text-danger border border-danger/20 rounded-lg text-[11px] font-bold flex items-center gap-1.5"
            >
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {displayHistory.length === 0 ? (
          <div className="text-center py-16 text-muted text-sm">
            Belum ada riwayat.<br />Generate dulu yuk! ⚡
          </div>
        ) : (
          displayHistory.map((item, i) => (
            <div 
              key={i} 
              onClick={() => onLoad(item)}
              className="bg-card2 border border-border rounded-2xl p-4 cursor-pointer hover:border-accent transition-all active:scale-[0.98]"
            >
              <div className="text-[11px] font-bold text-accent2 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Zap size={12} /> {item.kategori}
              </div>
              <div className="text-[14px] text-[#9090B0] line-clamp-2 font-dm">
                {item.desc}
              </div>
              <div className="text-[11px] text-muted mt-2 flex items-center gap-1">
                🕐 {item.time}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
