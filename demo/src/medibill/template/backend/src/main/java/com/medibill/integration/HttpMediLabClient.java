package com.medibill.integration;

import com.medibill.common.PeerUnavailableException;
import java.time.Duration;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

/** MediLabClient over MediLab's requests API (medisuite.medilab.url, CUP_LAB-116 there). */
@Component
public class HttpMediLabClient implements MediLabClient {

    private final RestClient http;

    public HttpMediLabClient(@Value("${medisuite.medilab.url}") String baseUrl,
                             @Value("${medisuite.medilab.timeout-ms:5000}") long timeoutMs) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(timeoutMs));
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        this.http = RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }

    @Override
    public List<LabOrderInfo> reportedOrders(LocalDate day) {
        try {
            LabOrderInfo[] orders = http.get().uri("/api/orders?status=REFERTATA&from={day}&to={day}", day, day).retrieve().body(LabOrderInfo[].class);
            return orders == null ? List.of() : Arrays.asList(orders);
        } catch (ResourceAccessException e) {
            throw new PeerUnavailableException("MediLab", e);
        }
    }
}
