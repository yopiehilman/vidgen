import React from 'react';
import { Bot, Cpu, Mic, Video, Layers, Star } from 'lucide-react';

export default function AgentsPage() {
  const agents = [
    {
      section: "🦙 LLM — Script & Prompt Generator",
      items: [
        {
          name: "Ollama + Mistral 7B",
          type: "Self-host di VPS • Gratis selamanya",
          desc: "Satu-satunya AI agent untuk semua kebutuhan teks. Generate naskah 2000+ kata, 25-30 video prompts, judul, deskripsi, tags, chapters YouTube dalam satu call.",
          icon: <Cpu className="text-accent" />,
          tags: ["✅ Gratis", "🖥️ VPS Local", "~4.5GB RAM"],
          recommended: true
        }
      ]
    },
    {
      section: "🎙️ Text-to-Speech — Narasi Audio",
      items: [
        {
          name: "Kokoro TTS",
          type: "Open Source • Self-host di VPS",
          desc: "TTS open source dengan suara paling natural. Support Bahasa Indonesia. Jalan di CPU, hanya butuh ~2GB RAM.",
          icon: <Mic className="text-accent2" />,
          tags: ["✅ Gratis", "🎙️ TTS", "🖥️ VPS Local"],
          recommended: true
        },
        {
          name: "Edge TTS",
          type: "Microsoft • Fallback otomatis",
          desc: "Dipakai sebagai fallback jika Kokoro TTS error. Kualitas sangat baik, 100+ bahasa, install via pip.",
          icon: <Mic className="text-muted" />,
          tags: ["✅ Gratis", "🎙️ Fallback"],
          recommended: false
        }
      ]
    },
    {
      section: "🎬 Video Generation — via HuggingFace",
      items: [
        {
          name: "Wan2.1 T2V-14B",
          type: "Alibaba Open Source • via HuggingFace API",
          desc: "Generate 25-30 clips @5-12 detik per video. Kualitas mendekati Sora & Kling. Dijalankan via HuggingFace Inference API.",
          icon: <Video className="text-accent3" />,
          tags: ["✅ Gratis", "🎬 12 detik/clip", "720p output"],
          recommended: true
        }
      ]
    }
  ];

  return (
    <div className="space-y-6">
      {agents.map((section, idx) => (
        <div key={idx} className="space-y-3">
          <div className="text-[11px] font-bold text-muted uppercase tracking-widest px-1">{section.section}</div>
          <div className="space-y-3">
            {section.items.map((agent, i) => (
              <div 
                key={i} 
                className={cn(
                  "bg-card2 border-1.5 rounded-2xl p-4 relative overflow-hidden",
                  agent.recommended ? "border-gold/30" : "border-border"
                )}
              >
                {agent.recommended && (
                  <div className="inline-flex items-center gap-1 px-2.5 py-1 bg-gold/15 text-gold rounded-full text-[10px] font-bold mb-3 uppercase">
                    <Star size={10} fill="currentColor" /> Recommended
                  </div>
                )}
                <div className="flex items-center gap-3.5 mb-2.5">
                  <div className="w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center text-xl">
                    {agent.icon}
                  </div>
                  <div>
                    <div className="font-syne font-bold text-[15px]">{agent.name}</div>
                    <div className="text-[11px] text-muted">{agent.type}</div>
                  </div>
                </div>
                <div className="text-[13px] text-[#9090B0] leading-relaxed mb-3.5 font-dm">
                  {agent.desc}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {agent.tags.map((tag, t) => (
                    <span key={t} className="px-2 py-0.5 bg-card border border-border rounded-full text-[10px] font-bold text-muted">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
