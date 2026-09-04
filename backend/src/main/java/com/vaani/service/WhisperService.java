package com.vaani.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Service
public class WhisperService {

    private static final Logger logger = LoggerFactory.getLogger(WhisperService.class);

    @Value("${openai.api.key:#{null}}")
    private String openAiApiKey;

    @Value("${groq.api.key:#{null}}")
    private String groqApiKey;

    public String transcribe(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            return "";
        }

        Path tempAudioFile = null;
        try {
            String originalName = file.getOriginalFilename();
            String extension = ".webm";
            if (originalName != null && originalName.contains(".")) {
                extension = originalName.substring(originalName.lastIndexOf("."));
            }

            tempAudioFile = Files.createTempFile("whisper_input_", extension);
            file.transferTo(tempAudioFile.toFile());

            String tempPath = tempAudioFile.toAbsolutePath().toString();

            // 1. Try OpenAI / Groq Whisper API if key is present
            String apiKey = (openAiApiKey != null && !openAiApiKey.isBlank()) ? openAiApiKey : 
                            (groqApiKey != null && !groqApiKey.isBlank()) ? groqApiKey : 
                            System.getenv("OPENAI_API_KEY") != null ? System.getenv("OPENAI_API_KEY") : 
                            System.getenv("GROQ_API_KEY");

            if (apiKey != null && !apiKey.isBlank()) {
                String apiTranscript = callWhisperApi(tempAudioFile.toFile(), apiKey);
                if (apiTranscript != null && !apiTranscript.isBlank()) {
                    logger.info("OpenAI Whisper API transcription successful.");
                    return apiTranscript;
                }
            }

            // 2. Run Local OpenAI Whisper Model (faster-whisper)
            logger.info("Running Local OpenAI Whisper Model on CPU...");
            return runWhisperScript(tempPath);
        } catch (Exception e) {
            logger.error("Whisper transcription error:", e);
            return "";
        } finally {
            if (tempAudioFile != null) {
                try {
                    Files.deleteIfExists(tempAudioFile);
                } catch (IOException ignored) {}
            }
        }
    }

    private String callWhisperApi(File audioFile, String apiKey) {
        try {
            boolean isGroq = System.getenv("GROQ_API_KEY") != null || (groqApiKey != null && !groqApiKey.isBlank());
            String endpoint = isGroq ? "https://api.groq.com/openai/v1/audio/transcriptions" : "https://api.openai.com/v1/audio/transcriptions";
            String model = isGroq ? "whisper-large-v3" : "whisper-1";

            RestTemplate restTemplate = new RestTemplate();
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);
            headers.setBearerAuth(apiKey);

            MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
            body.add("file", new FileSystemResource(audioFile));
            body.add("model", model);

            HttpEntity<MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(body, headers);
            ResponseEntity<Map> response = restTemplate.exchange(endpoint, HttpMethod.POST, requestEntity, Map.class);

            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                Object textObj = response.getBody().get("text");
                return textObj != null ? textObj.toString().trim() : "";
            }
        } catch (Exception e) {
            logger.warn("OpenAI/Groq Whisper API call failed: {}", e.getMessage());
        }
        return "";
    }

    /** Convenience method for the async background task — transcribes a file already on disk. */
    public String transcribeFromPath(String audioFilePath) {
        // Try API key first
        String apiKey = (openAiApiKey != null && !openAiApiKey.isBlank()) ? openAiApiKey :
                        (groqApiKey   != null && !groqApiKey.isBlank())   ? groqApiKey   :
                        System.getenv("OPENAI_API_KEY") != null ? System.getenv("OPENAI_API_KEY") :
                        System.getenv("GROQ_API_KEY");

        if (apiKey != null && !apiKey.isBlank()) {
            String apiTranscript = callWhisperApi(new java.io.File(audioFilePath), apiKey);
            if (apiTranscript != null && !apiTranscript.isBlank()) {
                logger.info("OpenAI/Groq Whisper API transcription successful (from path).");
                return apiTranscript;
            }
        }

        return runWhisperScript(audioFilePath);
    }

    private String runWhisperScript(String audioFilePath) {
        try {
            String pythonPath = "/home/vedant/venv/bin/python";
            if (!new File(pythonPath).exists()) {
                pythonPath = "python3";
            }

            String scriptPath = "/home/vedant/vaani/backend/transcribe_whisper.py";

            ProcessBuilder pb = new ProcessBuilder(pythonPath, scriptPath, audioFilePath);
            pb.redirectErrorStream(true);

            Process process = pb.start();

            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append("\n");
                }
            }

            boolean finished = process.waitFor(120, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                logger.warn("Whisper process timed out after 120s.");
            }

            return output.toString().trim();
        } catch (Exception e) {
            logger.error("Failed to run Whisper script:", e);
            return "";
        }
    }
}
