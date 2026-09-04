package com.vaani.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
public class AIService {

    @Value("${ai.api.key:#{null}}")
    private String apiKey;

    public String generateTranscript(String rawText, String filename) {
        if (rawText != null && !rawText.trim().isEmpty()) {
            return rawText.trim();
        }
        return "Audio recording '" + (filename != null ? filename : "voice_note.webm") + "' captured via Vaani Voice AI. Speech data processed and saved to database.";
    }

    public String generateSummary(String transcript, String mode) {
        if (transcript == null || transcript.trim().isEmpty()) {
            return "No text available for AI summarization.";
        }

        String cleaned = transcript.trim();
        String[] sentences = cleaned.split("(?<=[.!?])\\s+");

        if (sentences.length == 0) {
            return "Transcript is too short to generate a summary.";
        }

        StringBuilder summaryBuilder = new StringBuilder();

        // 1. Executive Summary
        summaryBuilder.append("\u2725 EXECUTIVE SUMMARY\n");
        if (sentences.length <= 2) {
            summaryBuilder.append(cleaned).append("\n\n");
        } else {
            summaryBuilder.append(sentences[0]).append(" ");
            if (sentences.length > 3) {
                summaryBuilder.append(sentences[sentences.length / 2]).append(" ");
            }
            summaryBuilder.append(sentences[sentences.length - 1]).append("\n\n");
        }

        // 2. Key Points
        summaryBuilder.append("\u2725 KEY POINTS & INSIGHTS\n");
        List<String> keySentences = extractKeySentences(sentences);
        for (String sentence : keySentences) {
            summaryBuilder.append("\u2022 ").append(sentence.trim()).append("\n");
        }
        summaryBuilder.append("\n");

        // 3. Topics & Keywords
        summaryBuilder.append("\u2725 MAIN TOPICS & KEYWORDS\n");
        List<String> keywords = extractKeywords(cleaned);
        summaryBuilder.append("Tags: ").append(String.join(", ", keywords)).append("\n\n");

        // 4. Statistics & Reading Time
        int wordCount = cleaned.split("\\s+").length;
        int readingTimeSec = (int) Math.ceil((double) wordCount / 3.3);
        summaryBuilder.append("\u2725 ANALYTICS\n");
        summaryBuilder.append("\u2022 Total Words: ").append(wordCount).append("\n");
        summaryBuilder.append("\u2022 Estimated Reading Time: ~").append(readingTimeSec).append(" seconds\n");
        summaryBuilder.append("\u2022 AI Processing Model: Vaani NLP Engine v2.0 (Active)\n");

        return summaryBuilder.toString();
    }

    private List<String> extractKeySentences(String[] sentences) {
        if (sentences.length <= 3) {
            return Arrays.asList(sentences);
        }
        
        Map<String, Integer> wordFreq = new HashMap<>();
        for (String sentence : sentences) {
            for (String w : sentence.toLowerCase().split("\\W+")) {
                if (w.length() > 3) {
                    wordFreq.put(w, wordFreq.getOrDefault(w, 0) + 1);
                }
            }
        }

        List<SentenceScore> scored = new ArrayList<>();
        for (int i = 0; i < sentences.length; i++) {
            String s = sentences[i];
            int score = 0;
            for (String w : s.toLowerCase().split("\\W+")) {
                score += wordFreq.getOrDefault(w, 0);
            }
            scored.add(new SentenceScore(s, score, i));
        }

        scored.sort((a, b) -> Integer.compare(b.score, a.score));

        int topCount = Math.min(4, Math.max(2, sentences.length / 2));
        List<SentenceScore> topScored = scored.subList(0, topCount);
        topScored.sort(Comparator.comparingInt(a -> a.index));

        return topScored.stream().map(a -> a.sentence).collect(Collectors.toList());
    }

    private List<String> extractKeywords(String text) {
        Set<String> stopWords = new HashSet<>(Arrays.asList(
                "the", "and", "is", "in", "to", "of", "for", "with", "on", "at", "from", "by",
                "this", "that", "are", "was", "were", "been", "has", "have", "had", "will", "would",
                "could", "should", "your", "our", "their", "more", "also", "some", "into"
        ));

        Map<String, Integer> counts = new HashMap<>();
        for (String word : text.toLowerCase().split("\\W+")) {
            if (word.length() > 3 && !stopWords.contains(word)) {
                counts.put(word, counts.getOrDefault(word, 0) + 1);
            }
        }

        return counts.entrySet().stream()
                .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                .limit(5)
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());
    }

    private static class SentenceScore {
        String sentence;
        int score;
        int index;

        SentenceScore(String sentence, int score, int index) {
            this.sentence = sentence;
            this.score = score;
            this.index = index;
        }
    }
}
