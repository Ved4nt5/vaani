package com.vaani.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Base64;
import java.util.concurrent.TimeUnit;

@Service
public class EmailService {

    private static final Logger logger = LoggerFactory.getLogger(EmailService.class);

    @Value("${spring.mail.username:programmmariojs8@gmail.com}")
    private String mailUser;

    @Value("${spring.mail.password:eipsenitutruqzxo}")
    private String mailPassword;

    public void sendOtpEmail(String toEmail, String otpCode, String userName) {
        logger.info("=================================================");
        logger.info(" Vaani Verification Code for [{}]: {}", toEmail, otpCode);
        logger.info("=================================================");

        String recipientName = (userName != null && !userName.isBlank()) ? userName : "there";

        // 1. Try Python helper script (direct tested SMTP sender)
        if (sendViaPython(toEmail, otpCode, recipientName)) {
            logger.info("OTP email delivered successfully via Python helper to {}", toEmail);
            return;
        }

        // 2. Try Java SSL Socket directly
        try {
            sendViaSocket(toEmail, otpCode, recipientName);
            logger.info("OTP email delivered successfully via Java SSL socket to {}", toEmail);
        } catch (Exception e) {
            logger.error("Failed to deliver email to {}: {}", toEmail, e.getMessage());
            throw new RuntimeException("Could not send verification email to " + toEmail + ": " + e.getMessage(), e);
        }
    }

    private boolean sendViaPython(String toEmail, String otpCode, String userName) {
        try {
            String scriptPath = resolveScriptPath();
            if (scriptPath == null) {
                logger.warn("send_email.py not found, falling back to socket.");
                return false;
            }

            ProcessBuilder pb = new ProcessBuilder("python3", scriptPath, toEmail, otpCode, userName);
            pb.redirectErrorStream(true);
            Process p = pb.start();

            StringBuilder out = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                String line;
                while ((line = r.readLine()) != null) out.append(line).append("\n");
            }

            boolean finished = p.waitFor(20, TimeUnit.SECONDS);
            if (finished && p.exitValue() == 0) {
                return true;
            } else {
                logger.warn("Python email process output: {}", out);
                return false;
            }
        } catch (Exception e) {
            logger.warn("Python email helper failed: {}", e.getMessage());
            return false;
        }
    }

    private String resolveScriptPath() {
        String[] candidates = {
            "./send_email.py",
            "backend/send_email.py",
            "../backend/send_email.py"
        };
        for (String c : candidates) {
            Path p = Paths.get(c).toAbsolutePath().normalize();
            if (Files.exists(p)) return p.toString();
        }
        return null;
    }

    private void sendViaSocket(String toEmail, String otpCode, String userName) throws Exception {
        try (SSLSocket socket = (SSLSocket) SSLSocketFactory.getDefault().createSocket("smtp.gmail.com", 465)) {
            socket.setSoTimeout(10000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8));

            readResponse(reader); // 220
            sendCommand(writer, "EHLO localhost");
            readResponse(reader);

            sendCommand(writer, "AUTH LOGIN");
            readResponse(reader);

            sendCommand(writer, Base64.getEncoder().encodeToString(mailUser.getBytes(StandardCharsets.UTF_8)));
            readResponse(reader);

            sendCommand(writer, Base64.getEncoder().encodeToString(mailPassword.getBytes(StandardCharsets.UTF_8)));
            readResponse(reader); // 235 Authentication succeeded

            sendCommand(writer, "MAIL FROM:<" + mailUser + ">");
            readResponse(reader);

            sendCommand(writer, "RCPT TO:<" + toEmail + ">");
            readResponse(reader);

            sendCommand(writer, "DATA");
            readResponse(reader);

            writer.write("From: Vaani AI <" + mailUser + ">\r\n");
            writer.write("To: <" + toEmail + ">\r\n");
            writer.write("Subject: Your Vaani Verification Passcode: " + otpCode + "\r\n");
            writer.write("Content-Type: text/plain; charset=UTF-8\r\n\r\n");
            writer.write("Hello " + userName + ",\r\n\r\n");
            writer.write("Your Vaani verification code is: " + otpCode + "\r\n\r\n");
            writer.write("This code will expire in 5 minutes.\r\n");
            writer.write("— Team Vaani\r\n");
            writer.write(".\r\n");
            writer.flush();
            readResponse(reader);

            sendCommand(writer, "QUIT");
            readResponse(reader);
        }
    }

    private void sendCommand(BufferedWriter writer, String cmd) throws IOException {
        writer.write(cmd + "\r\n");
        writer.flush();
    }

    private String readResponse(BufferedReader reader) throws IOException {
        String line = reader.readLine();
        if (line == null) throw new IOException("SMTP connection closed unexpectedly");
        while (line.length() >= 4 && line.charAt(3) == '-') {
            line = reader.readLine();
        }
        return line;
    }
}
