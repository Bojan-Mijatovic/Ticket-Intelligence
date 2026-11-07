package com.medibill.integration;

import com.medibill.common.PeerUnavailableException;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

/** MediAgendaClient over MediAgenda's REST API (medisuite.mediagenda.url). */
@Component
public class HttpMediAgendaClient implements MediAgendaClient {

    /** MediAgenda's paged search answer: { items, page, size, total }. */
    record Page(List<PatientInfo> items, int page, int size, long total) {}

    private final RestClient http;

    public HttpMediAgendaClient(@Value("${medisuite.mediagenda.url}") String baseUrl,
                                @Value("${medisuite.mediagenda.timeout-ms:5000}") long timeoutMs) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(timeoutMs));
        factory.setReadTimeout(Duration.ofMillis(timeoutMs));
        this.http = RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }

    @Override
    public Optional<PatientInfo> patient(long id) {
        try {
            return Optional.ofNullable(http.get().uri("/api/patients/{id}", id).retrieve().body(PatientInfo.class));
        } catch (HttpClientErrorException.NotFound e) {
            return Optional.empty();
        } catch (ResourceAccessException e) {
            throw new PeerUnavailableException("MediAgenda", e);
        }
    }

    @Override
    public List<PatientInfo> search(String q) {
        try {
            Page page = http.get().uri("/api/patients?q={q}&page=0&size=8", q).retrieve().body(Page.class);
            return page == null ? List.of() : page.items();
        } catch (ResourceAccessException e) {
            throw new PeerUnavailableException("MediAgenda", e);
        }
    }

    @Override
    public List<BookingInfo> bookings() {
        try {
            BookingInfo[] all = http.get().uri("/api/bookings").retrieve().body(BookingInfo[].class);
            return all == null ? List.of() : Arrays.asList(all);
        } catch (ResourceAccessException e) {
            throw new PeerUnavailableException("MediAgenda", e);
        }
    }
}
