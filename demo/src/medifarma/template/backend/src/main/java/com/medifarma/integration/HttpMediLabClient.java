package com.medifarma.integration;

import com.medifarma.common.PeerUnavailableException;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

/** MediLabClient over MediLab's results API: GET /api/patients/{fiscalCode}/results?exam=CREA (newest first). */
@Component
public class HttpMediLabClient implements MediLabClient {

    /** One element of MediLab's answer (its PatientResult). */
    record Result(String orderId, String examCode, String examName, BigDecimal value, String unit, String flag, LocalDateTime reportedAt) {}

    private final RestClient http;

    public HttpMediLabClient(@Value("${medisuite.medilab.url}") String baseUrl,
                             @Value("${medisuite.medilab.timeout-ms:3000}") long timeoutMs) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(timeoutMs));
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        this.http = RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }

    @Override
    public Optional<LabValue> latestCreatinine(String fiscalCode) {
        try {
            Result[] results = http.get().uri("/api/patients/{fiscalCode}/results?exam=CREA", fiscalCode).retrieve().body(Result[].class);
            return Arrays.stream(results == null ? new Result[0] : results)
                    .findFirst()
                    .map(r -> new LabValue(r.value(), r.unit(), r.reportedAt(), r.orderId()));
        } catch (ResourceAccessException e) {
            throw new PeerUnavailableException("MediLab", e);
        }
    }
}
