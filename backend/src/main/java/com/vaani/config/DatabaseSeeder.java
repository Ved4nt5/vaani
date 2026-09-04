package com.vaani.config;

import com.vaani.model.Recording;
import com.vaani.repository.RecordingRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;

@Component
public class DatabaseSeeder implements CommandLineRunner {

    private final RecordingRepository recordingRepository;

    @Autowired
    public DatabaseSeeder(RecordingRepository recordingRepository) {
        this.recordingRepository = recordingRepository;
    }

    @Override
    public void run(String... args) throws Exception {
        if (recordingRepository.count() == 0) {
            byte[] sampleAudio1 = generateToneWav(440, 3);
            byte[] sampleAudio2 = generateToneWav(523.25, 3);
            byte[] sampleAudio3 = generateToneWav(659.25, 3);

            recordingRepository.save(new Recording(
                    "Lecture \u2014 AI and ML Basics",
                    "45:12",
                    "Artificial Intelligence is a broad field of computer science focused on creating systems that can perform tasks that normally require human intelligence. Machine Learning is a subset of AI where systems learn patterns from data.\n\nThere are three major types of machine learning: supervised learning, unsupervised learning, and reinforcement learning. Each approach has different applications across healthcare, finance, education, and autonomous systems.",
                    "This lecture introduces the fundamental concepts of Artificial Intelligence and Machine Learning. It explains the difference between AI, ML, and Deep Learning, covering supervised, unsupervised, and reinforcement learning.\n\nKey Points:\n\u2022 AI is broader; ML is a subset of AI.\n\u2022 ML enables systems to learn from data.\n\u2022 Types: supervised, unsupervised and reinforcement.\n\u2022 Data quality is crucial for accurate predictions.",
                    "lecture_ai_ml.wav",
                    "audio/wav",
                    sampleAudio1
            ));

            recordingRepository.save(new Recording(
                    "Team Meeting Discussion",
                    "32:05",
                    "During today's team sync, we discussed sprint objectives, current progress on backend architecture, database integration with MySQL, and frontend player UI components.",
                    "Summary of sprint alignment and backend API roadmap.\n\nKey Points:\n\u2022 Completed MySQL database schema definition.\n\u2022 Spring Boot REST APIs connected.\n\u2022 Added audio playback feature.",
                    "team_meeting.wav",
                    "audio/wav",
                    sampleAudio2
            ));

            recordingRepository.save(new Recording(
                    "Project Ideas Brainstorming",
                    "28:40",
                    "Brainstorming session covering automated audio transcription, key point summarization, export features, and real-time speech processing.",
                    "Creative brainstorming ideas for Vaani AI audio platform.\n\nKey Points:\n\u2022 Real-time speech recognition.\n\u2022 Auto export to PDF/Markdown.\n\u2022 Audio playback & annotation.",
                    "brainstorming.wav",
                    "audio/wav",
                    sampleAudio3
            ));
        }
    }

    private byte[] generateToneWav(double frequencyHz, double durationSeconds) {
        int sampleRate = 44100;
        int numSamples = (int) (durationSeconds * sampleRate);
        int dataSize = numSamples * 2;

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        DataOutputStream dos = new DataOutputStream(baos);

        try {
            dos.writeBytes("RIFF");
            dos.writeInt(Integer.reverseBytes(36 + dataSize));
            dos.writeBytes("WAVE");

            dos.writeBytes("fmt ");
            dos.writeInt(Integer.reverseBytes(16));
            dos.writeShort(Short.reverseBytes((short) 1));
            dos.writeShort(Short.reverseBytes((short) 1));
            dos.writeInt(Integer.reverseBytes(sampleRate));
            dos.writeInt(Integer.reverseBytes(sampleRate * 2));
            dos.writeShort(Short.reverseBytes((short) 2));
            dos.writeShort(Short.reverseBytes((short) 16));

            dos.writeBytes("data");
            dos.writeInt(Integer.reverseBytes(dataSize));

            for (int i = 0; i < numSamples; i++) {
                double t = (double) i / sampleRate;
                double envelope = Math.min(1.0, (numSamples - i) / (double) (sampleRate * 0.1));
                short sample = (short) (Math.sin(2.0 * Math.PI * frequencyHz * t) * 16384 * envelope);
                dos.writeShort(Short.reverseBytes(sample));
            }

            dos.flush();
            return baos.toByteArray();
        } catch (IOException e) {
            return new byte[0];
        }
    }
}
