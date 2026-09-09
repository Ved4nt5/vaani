package com.vaani.repository;

import com.vaani.model.Otp;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface OtpRepository extends JpaRepository<Otp, Long> {
    Optional<Otp> findTopByEmailOrderByCreatedAtDesc(String email);
    void deleteByEmail(String email);
}
