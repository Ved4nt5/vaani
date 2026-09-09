package com.vaani.service;

import com.vaani.model.Otp;
import com.vaani.model.User;
import com.vaani.repository.OtpRepository;
import com.vaani.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class AuthService {

    private static final Logger logger = LoggerFactory.getLogger(AuthService.class);

    private final UserRepository userRepository;
    private final OtpRepository otpRepository;
    private final EmailService emailService;

    // In-memory session store: token -> User
    private final ConcurrentHashMap<String, User> sessions = new ConcurrentHashMap<>();

    @Autowired
    public AuthService(UserRepository userRepository, OtpRepository otpRepository, EmailService emailService) {
        this.userRepository = userRepository;
        this.otpRepository = otpRepository;
        this.emailService = emailService;
    }

    /**
     * Register a new user. Creates user with hashed password, generates OTP, sends email.
     * If user already exists but is unverified, resends OTP.
     */
    @Transactional
    public Map<String, String> signup(String name, String email, String password) {
        Optional<User> existing = userRepository.findByEmail(email);

        if (existing.isPresent()) {
            User user = existing.get();
            if (user.isVerified()) {
                throw new RuntimeException("An account with this email already exists. Please login.");
            }
            // User exists but not verified — update password and resend OTP
            user.setName(name);
            user.setPassword(hashPassword(password));
            userRepository.save(user);
        } else {
            // Create new user
            User user = new User(name, email, hashPassword(password));
            userRepository.save(user);
        }

        // Generate and send OTP
        String otpCode = generateOtpCode();
        otpRepository.deleteByEmail(email);
        otpRepository.save(new Otp(email, otpCode, 5)); // 5 min expiry
        emailService.sendOtpEmail(email, otpCode, name);

        logger.info("Signup OTP sent to {}", email);
        return Map.of("message", "Verification code sent to " + email);
    }

    /**
     * Verify the OTP code. If valid, mark user as verified and return a session token.
     */
    @Transactional
    public Map<String, Object> verifyOtp(String email, String code) {
        Optional<Otp> otpOpt = otpRepository.findTopByEmailOrderByCreatedAtDesc(email);

        if (otpOpt.isEmpty()) {
            throw new RuntimeException("No verification code found. Please sign up again.");
        }

        Otp otp = otpOpt.get();

        if (otp.isExpired()) {
            throw new RuntimeException("Verification code has expired. Please sign up again.");
        }

        if (!otp.getCode().equals(code)) {
            throw new RuntimeException("Invalid verification code. Please try again.");
        }

        // Mark user as verified
        Optional<User> userOpt = userRepository.findByEmail(email);
        if (userOpt.isEmpty()) {
            throw new RuntimeException("User not found. Please sign up again.");
        }

        User user = userOpt.get();
        user.setVerified(true);
        userRepository.save(user);

        // Clean up OTPs
        otpRepository.deleteByEmail(email);

        // Create session
        String token = UUID.randomUUID().toString();
        sessions.put(token, user);

        logger.info("User {} verified and logged in", email);
        return Map.of(
            "token", token,
            "name", user.getName(),
            "email", user.getEmail()
        );
    }

    /**
     * Login with email and password. Returns session token if credentials are valid.
     */
    public Map<String, Object> login(String email, String password) {
        Optional<User> userOpt = userRepository.findByEmail(email);

        if (userOpt.isEmpty()) {
            throw new RuntimeException("No account found with this email. Please sign up first.");
        }

        User user = userOpt.get();

        if (!user.isVerified()) {
            throw new RuntimeException("Account not verified. Please sign up again to receive a new code.");
        }

        if (!checkPassword(password, user.getPassword())) {
            throw new RuntimeException("Incorrect password. Please try again.");
        }

        // Create session
        String token = UUID.randomUUID().toString();
        sessions.put(token, user);

        logger.info("User {} logged in successfully", email);
        return Map.of(
            "token", token,
            "name", user.getName(),
            "email", user.getEmail()
        );
    }

    /**
     * Get user from session token.
     */
    public User getUserFromToken(String token) {
        return sessions.get(token);
    }

    /**
     * Logout — invalidate session token.
     */
    public void logout(String token) {
        sessions.remove(token);
    }

    // ── Password Hashing (SHA-256 based, simple and dependency-free) ──

    private String hashPassword(String password) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(password.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException("Password hashing failed", e);
        }
    }

    private boolean checkPassword(String rawPassword, String hashedPassword) {
        return hashPassword(rawPassword).equals(hashedPassword);
    }

    // ── OTP Generation ──

    private String generateOtpCode() {
        SecureRandom random = new SecureRandom();
        int code = 100000 + random.nextInt(900000); // 6-digit
        return String.valueOf(code);
    }
}
