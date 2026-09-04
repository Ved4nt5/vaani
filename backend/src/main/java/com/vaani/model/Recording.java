package com.vaani.model;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "recordings")
public class Recording {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String title;

    private String lectureName;

    private String professorName;

    private String duration;

    private LocalDateTime createdAt;

    private String status;

    @Lob
    @Column(columnDefinition = "LONGTEXT")
    private String transcript;

    @Lob
    @Column(columnDefinition = "LONGTEXT")
    private String summary;

    private String audioFilename;

    private String audioContentType;

    @Lob
    @Column(columnDefinition = "LONGBLOB")
    private byte[] audioData;

    public Recording() {
        this.createdAt = LocalDateTime.now();
        this.status = "Completed";
    }

    public Recording(String title, String duration, String transcript, String summary, String audioFilename, String audioContentType, byte[] audioData) {
        this.title = title;
        this.duration = duration;
        this.createdAt = LocalDateTime.now();
        this.status = "Completed";
        this.transcript = transcript;
        this.summary = summary;
        this.audioFilename = audioFilename;
        this.audioContentType = audioContentType;
        this.audioData = audioData;
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

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
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

    public String getAudioFilename() {
        return audioFilename;
    }

    public void setAudioFilename(String audioFilename) {
        this.audioFilename = audioFilename;
    }

    public String getAudioContentType() {
        return audioContentType;
    }

    public void setAudioContentType(String audioContentType) {
        this.audioContentType = audioContentType;
    }

    public byte[] getAudioData() {
        return audioData;
    }

    public void setAudioData(byte[] audioData) {
        this.audioData = audioData;
    }
}
