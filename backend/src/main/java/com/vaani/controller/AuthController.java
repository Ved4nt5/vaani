package com.vaani.controller;

import com.vaani.model.User;
import com.vaani.service.AuthService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@CrossOrigin(origins = "*")
public class AuthController {

    private final AuthService authService;

    @Autowired
    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/signup")
    public ResponseEntity<?> signup(@RequestBody Map<String, String> body) {
        try {
            String name = body.get("name");
            String email = body.get("email");
            String password = body.get("password");

            if (email == null || email.isBlank() || password == null || password.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Email and password are required."));
            }
            if (name == null || name.isBlank()) {
                name = "User";
            }

            Map<String, String> result = authService.signup(name.trim(), email.trim().toLowerCase(), password);
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/verify-otp")
    public ResponseEntity<?> verifyOtp(@RequestBody Map<String, String> body) {
        try {
            String email = body.get("email");
            String code = body.get("code");

            if (email == null || code == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "Email and code are required."));
            }

            Map<String, Object> result = authService.verifyOtp(email.trim().toLowerCase(), code.trim());
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Map<String, String> body) {
        try {
            String email = body.get("email");
            String password = body.get("password");

            if (email == null || email.isBlank() || password == null || password.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Email and password are required."));
            }

            Map<String, Object> result = authService.login(email.trim().toLowerCase(), password);
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/me")
    public ResponseEntity<?> me(@RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Not authenticated."));
        }

        String token = authHeader.substring(7);
        User user = authService.getUserFromToken(token);

        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Session expired. Please login again."));
        }

        return ResponseEntity.ok(Map.of(
            "name", user.getName(),
            "email", user.getEmail()
        ));
    }

    @PostMapping("/logout")
    public ResponseEntity<?> logout(@RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            authService.logout(authHeader.substring(7));
        }
        return ResponseEntity.ok(Map.of("message", "Logged out successfully."));
    }
}
