#!/usr/bin/env python3
import sys
import os
import math

def generate_srt(text, duration, output_path):
    # Split text into chunks (max 30 chars per line for readability)
    words = text.split()
    chunks = []
    current_chunk = []
    current_len = 0
    
    for word in words:
        if current_len + len(word) + 1 > 30:
            chunks.append(" ".join(current_chunk))
            current_chunk = [word]
            current_len = len(word)
        else:
            current_chunk.append(word)
            current_len += len(word) + 1
    if current_chunk:
        chunks.append(" ".join(current_chunk))
    
    total_chars = sum(len(c) for c in chunks)
    time_per_char = duration / total_chars if total_chars > 0 else 0
    
    with open(output_path, "w", encoding="utf-8") as f:
        current_time = 0.0
        for i, chunk in enumerate(chunks):
            chunk_duration = len(chunk) * time_per_char
            start_time = current_time
            end_time = current_time + chunk_duration
            
            # Format to HH:MM:SS,mmm
            def format_time(seconds):
                h = int(seconds // 3600)
                m = int((seconds % 3600) // 60)
                s = int(seconds % 60)
                ms = int((seconds * 1000) % 1000)
                return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
            
            f.write(f"{i+1}\n")
            f.write(f"{format_time(start_time)} --> {format_time(end_time)}\n")
            f.write(f"{chunk}\n\n")
            
            current_time = end_time

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: generate_subtitles.py <text_file> <duration_secs> <output_srt>")
        sys.exit(1)
        
    text_path = sys.argv[1]
    duration = float(sys.argv[2])
    output_path = sys.argv[3]
    
    with open(text_path, "r", encoding="utf-8") as f:
        text = f.read()
        
    generate_srt(text, duration, output_path)
    print(f"SRT generated: {output_path}")
