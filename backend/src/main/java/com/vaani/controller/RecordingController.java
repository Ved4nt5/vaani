package com.vaani.controller;

import com.vaani.dto.RecordingResponseDto;
import com.vaani.model.Recording;
import com.vaani.service.RecordingService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

@RestController
@RequestMapping("/api/recordings")
@CrossOrigin(origins = "*")
public class RecordingController {

    private final RecordingService recordingService;

    @Autowired
    public RecordingController(RecordingService recordingService) {
        this.recordingService = recordingService;
    }

    @GetMapping
    public ResponseEntity<List<RecordingResponseDto>> getAllRecordings() {
        return ResponseEntity.ok(recordingService.getAllRecordings());
    }

    @GetMapping("/{id}")
    public ResponseEntity<RecordingResponseDto> getRecordingById(@PathVariable Long id) {
        Optional<RecordingResponseDto> dto = recordingService.getRecordingDtoById(id);
        return dto.map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/{id}/audio")
    public ResponseEntity<byte[]> getRecordingAudio(@PathVariable Long id) {
        Optional<Recording> optionalRecording = recordingService.getRecordingEntityById(id);
        if (optionalRecording.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        Recording recording = optionalRecording.get();
        if (recording.getAudioData() == null || recording.getAudioData().length == 0) {
            return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
        }

        String contentType = recording.getAudioContentType();
        if (contentType == null || contentType.isBlank()) {
            contentType = "audio/webm";
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(contentType));
        headers.setContentLength(recording.getAudioData().length);
        headers.set(HttpHeaders.ACCEPT_RANGES, "bytes");
        headers.set(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + 
                (recording.getAudioFilename() != null ? recording.getAudioFilename() : "recording-" + id + ".webm") + "\"");

        return new ResponseEntity<>(recording.getAudioData(), headers, HttpStatus.OK);
    }

    @PostMapping
    public ResponseEntity<RecordingResponseDto> saveRecording(
            @RequestParam(value = "file", required = false) MultipartFile file,
            @RequestParam(value = "title", required = false) String title,
            @RequestParam(value = "lectureName", required = false) String lectureName,
            @RequestParam(value = "professorName", required = false) String professorName,
            @RequestParam(value = "duration", required = false) String duration,
            @RequestParam(value = "transcript", required = false) String transcript,
            @RequestParam(value = "summary", required = false) String summary) {
        try {
            RecordingResponseDto savedDto = recordingService.saveRecording(title, lectureName, professorName, duration, transcript, summary, file);
            return ResponseEntity.status(HttpStatus.CREATED).body(savedDto);
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteRecording(@PathVariable Long id) {
        if (recordingService.deleteRecording(id)) {
            return ResponseEntity.noContent().build();
        }
        return ResponseEntity.notFound().build();
    }
}
