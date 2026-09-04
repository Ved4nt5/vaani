package com.vaani.dto;

import com.vaani.model.Recording;
import java.time.format.DateTimeFormatter;

public class RecordingResponseDto {

    private Long id;
    private String title;
    private String lectureName;
    private String professorName;
    private String duration;
    private String createdAt;
    private String status;
    private String transcript;
    private String summary;
    private boolean hasAudio;
    private String audioUrl;

    public RecordingResponseDto() {
    }

    public static RecordingResponseDto fromEntity(Recording recording) {
        RecordingResponseDto dto = new RecordingResponseDto();
        dto.setId(recording.getId());
        dto.setTitle(recording.getTitle());
        dto.setLectureName(recording.getLectureName());
        dto.setProfessorName(recording.getProfessorName());
        dto.setDuration(recording.getDuration());
        if (recording.getCreatedAt() != null) {
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("dd MMM yyyy, hh:mm a");
            dto.setCreatedAt(recording.getCreatedAt().format(formatter));
        } else {
            dto.setCreatedAt("Just now");
        }
        dto.setStatus(recording.getStatus() != null ? recording.getStatus() : "Completed");
        dto.setTranscript(recording.getTranscript());
        dto.setSummary(recording.getSummary());
        boolean hasAudio = recording.getAudioData() != null && recording.getAudioData().length > 0;
        dto.setHasAudio(hasAudio);
        dto.setAudioUrl(hasAudio ? "/api/recordings/" + recording.getId() + "/audio" : null);
        return dto;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getLectureName() {
        return lectureName;
    }

    public void setLectureName(String lectureName) {
        this.lectureName = lectureName;
    }

    public String getProfessorName() {
        return professorName;
    }

    public void setProfessorName(String professorName) {
        this.professorName = professorName;
    }

    public String getDuration() {
        return duration;
    }

    public void setDuration(String duration) {
        this.duration = duration;
    }

    public String getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(String createdAt) {
        this.createdAt = createdAt;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getTranscript() {
        return transcript;
    }

    public void setTranscript(String transcript) {
        this.transcript = transcript;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public boolean isHasAudio() {
        return hasAudio;
    }

    public void setHasAudio(boolean hasAudio) {
        this.hasAudio = hasAudio;
    }

    public String getAudioUrl() {
        return audioUrl;
    }

    public void setAudioUrl(String audioUrl) {
        this.audioUrl = audioUrl;
    }
}
