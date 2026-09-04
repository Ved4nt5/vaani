#!/usr/bin/env python3
import sys
import os
import json
import urllib.request
import urllib.error

def transcribe_audio(audio_path):
    if not os.path.exists(audio_path):
        return "Audio file not found."

    # 1. Try faster-whisper (OpenAI Whisper CTranslate2 engine)
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel("tiny", device="cpu", compute_type="int8")
        segments, info = model.transcribe(
            audio_path,
            beam_size=1,       # greedy decode — much faster on CPU
            vad_filter=True,   # skip silent segments
            language="en",     # skip language detection step
        )
        text = " ".join([segment.text for segment in segments]).strip()
        if text:
            return text
    except Exception as e:
        sys.stderr.write(f"Faster-Whisper error: {e}\n")

    # 2. Try standard openai-whisper
    try:
        import whisper
        model = whisper.load_model("tiny")
        result = model.transcribe(audio_path)
        text = result.get("text", "").strip()
        if text:
            return text
    except Exception as e:
        sys.stderr.write(f"Standard Whisper error: {e}\n")

    # 3. Fallback to Groq / OpenAI free Whisper API if key present or Hugging Face
    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("GROQ_API_KEY")
    if api_key:
        try:
            endpoint = "https://api.openai.com/v1/audio/transcriptions"
            if os.environ.get("GROQ_API_KEY"):
                endpoint = "https://api.groq.com/openai/v1/audio/transcriptions"

            # Perform multipart upload using curl or urllib
            import subprocess
            cmd = [
                "curl", "-s", "-X", "POST", endpoint,
                "-H", f"Authorization: Bearer {api_key}",
                "-F", f"file=@{audio_path}",
                "-F", "model=whisper-1" if "openai" in endpoint else "model=whisper-large-v3"
            ]
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode == 0 and res.stdout:
                data = json.loads(res.stdout)
                if "text" in data:
                    return data["text"].strip()
        except Exception as e:
            sys.stderr.write(f"Whisper API error: {e}\n")

    return ""

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: transcribe_whisper.py <audio_file_path>")
        sys.exit(1)

    filepath = sys.argv[1]
    transcript = transcribe_audio(filepath)
    print(transcript)
