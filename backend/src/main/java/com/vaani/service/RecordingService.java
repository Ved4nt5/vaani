package com.vaani.service;

import com.vaani.dto.RecordingResponseDto;
import com.vaani.model.Recording;
import com.vaani.repository.RecordingRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

@Service
public class RecordingService {

    private static final Logger logger = LoggerFactory.getLogger(RecordingService.class);

    private final RecordingRepository recordingRepository;
    private final AIService aiService;
    private final WhisperService whisperService;

    @Autowired
    public RecordingService(RecordingRepository recordingRepository, AIService aiService, WhisperService whisperService) {
        this.recordingRepository = recordingRepository;
        this.aiService = aiService;
        this.whisperService = whisperService;
    }

    public List<RecordingResponseDto> getAllRecordings() {
        return recordingRepository.findAllByOrderByIdDesc()
                .stream()
                .map(RecordingResponseDto::fromEntity)
                .collect(Collectors.toList());
    }

    public Optional<RecordingResponseDto> getRecordingDtoById(Long id) {
        return recordingRepository.findById(id).map(RecordingResponseDto::fromEntity);
    }

    public Optional<Recording> getRecordingEntityById(Long id) {
        return recordingRepository.findById(id);
    }

    /**
     * Saves the recording metadata + audio immediately with status "Processing",
     * then kicks off transcription and summarization in a background thread.
     * Returns the saved DTO right away so the frontend can poll for updates.
     */
    public RecordingResponseDto saveRecording(String title, String lectureName, String professorName,
                                              String duration, String transcript, String summary,
                                              MultipartFile file) throws IOException {
        Recording recording = new Recording();
        recording.setTitle((title != null && !title.isBlank()) ? title : "Audio Recording");
        recording.setLectureName((lectureName != null && !lectureName.isBlank()) ? lectureName : null);
        recording.setProfessorName((professorName != null && !professorName.isBlank()) ? professorName : null);
        recording.setDuration((duration != null && !duration.isBlank()) ? duration : "00:00");
        recording.setStatus("Processing");

        String originalFilename = (file != null) ? file.getOriginalFilename() : "recording.webm";
        byte[] audioBytes = (file != null && !file.isEmpty()) ? file.getBytes() : new byte[0];

        if (audioBytes.length > 0) {
            recording.setAudioFilename(originalFilename);
            recording.setAudioContentType(file.getContentType());
            recording.setAudioData(audioBytes);
        }

        // If the caller supplied a transcript/summary already, use them and skip AI processing
        boolean hasProvidedTranscript = transcript != null && !transcript.isBlank();
        if (hasProvidedTranscript) {
            recording.setTranscript(transcript.trim());
            String finalSummary = (summary != null && !summary.isBlank())
                    ? summary : aiService.generateSummary(transcript.trim(), "Medium");
            recording.setSummary(finalSummary);
            recording.setStatus("Completed");
        }

        // Save immediately — returns to client right away
        Recording saved = recordingRepository.save(recording);

        // If we still need AI processing, run it in background
        if (!hasProvidedTranscript && file != null && !file.isEmpty()) {
            final Long recordingId = saved.getId();
            final String fname = originalFilename;
            // Capture audio bytes for the async task (file InputStream may be consumed)
            final byte[] audioCopy = audioBytes;
            CompletableFuture.runAsync(() -> processInBackground(recordingId, fname, audioCopy));
        }

        return RecordingResponseDto.fromEntity(saved);
    }

    /** Runs in a background thread: transcribes audio then generates summary, updates DB record. */
    private void processInBackground(Long recordingId, String originalFilename, byte[] audioBytes) {
        try {
            logger.info("Background processing started for recording id={}", recordingId);

            // Write bytes to a temp file so WhisperService can process it
            String ext = originalFilename.contains(".") ? originalFilename.substring(originalFilename.lastIndexOf('.')) : ".webm";
            java.nio.file.Path tempFile = java.nio.file.Files.createTempFile("vaani_bg_", ext);
            try {
                java.nio.file.Files.write(tempFile, audioBytes);

                // 1. Transcription via Whisper
                String whisperTranscript = whisperService.transcribeFromPath(tempFile.toAbsolutePath().toString());
                if (whisperTranscript == null || whisperTranscript.isBlank()) {
                    whisperTranscript = aiService.generateTranscript(null, originalFilename);
                }

                // 2. Summarization
                String generatedSummary = aiService.generateSummary(whisperTranscript, "Medium");

                // 3. Persist results
                recordingRepository.findById(recordingId).ifPresent(rec -> {
                    rec.setTranscript(whisperTranscript);
                    rec.setSummary(generatedSummary);
                    rec.setStatus("Completed");
                    recordingRepository.save(rec);
                    logger.info("Background processing completed for recording id={}", recordingId);
                });
            } finally {
                java.nio.file.Files.deleteIfExists(tempFile);
            }
        } catch (Exception e) {
            logger.error("Background processing failed for recording id={}", recordingId, e);
            recordingRepository.findById(recordingId).ifPresent(rec -> {
                rec.setStatus("Failed");
                recordingRepository.save(rec);
            });
        }
    }

    public boolean deleteRecording(Long id) {
        if (recordingRepository.existsById(id)) {
            recordingRepository.deleteById(id);
            return true;
        }
        return false;
    }
}
