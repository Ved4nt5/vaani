package com.vaani.config;

import com.vaani.service.AuthService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Lightweight authentication filter.
 * Protects /api/** endpoints (except /api/auth/**) by requiring a valid Bearer token.
 * Static resources and auth endpoints are allowed through without authentication.
 */
@Component
public class AuthFilter extends OncePerRequestFilter {

    private final AuthService authService;

    @Autowired
    public AuthFilter(AuthService authService) {
        this.authService = authService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String path = request.getRequestURI();

        // Allow CORS preflights
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            filterChain.doFilter(request, response);
            return;
        }

        // Allow auth endpoints, static resources, and non-API paths through
        if (!path.startsWith("/api/") || path.startsWith("/api/auth/") || path.endsWith("/audio")) {
            filterChain.doFilter(request, response);
            return;
        }

        // Check for Bearer token in header or query parameter
        String authHeader = request.getHeader("Authorization");
        String token = null;
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            token = authHeader.substring(7);
        } else if (request.getParameter("token") != null) {
            token = request.getParameter("token");
        }

        if (token == null) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Authentication required. Please login.\"}");
            return;
        }

        if (authService.getUserFromToken(token) == null) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Session expired. Please login again.\"}");
            return;
        }

        filterChain.doFilter(request, response);
    }
}
