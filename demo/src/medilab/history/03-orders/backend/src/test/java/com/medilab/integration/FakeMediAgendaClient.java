package com.medilab.integration;

import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/** MediAgenda for the tests: the patients of the MediAgenda seed, no HTTP. Tests never call the real MediAgenda. */
@Component
@Primary
public class FakeMediAgendaClient implements MediAgendaClient {

    private final Map<Long, PatientInfo> patients = new TreeMap<>(Map.ofEntries(
            Map.entry(1L, new PatientInfo(1L, "RSSMRA80A01F205X", "Mario", "Rossi", LocalDate.of(1980, 1, 1), "M")),
            Map.entry(2L, new PatientInfo(2L, "BNCLRA85C45L219Y", "Laura", "Bianchi", LocalDate.of(1985, 3, 5), "F")),
            Map.entry(3L, new PatientInfo(3L, "VRDGPP72D12H501Z", "Giuseppe", "Verdi", LocalDate.of(1972, 4, 12), "M")),
            Map.entry(4L, new PatientInfo(4L, "FRRGLI90E50A794K", "Giulia", "Ferrari", LocalDate.of(1990, 5, 10), "F")),
            Map.entry(5L, new PatientInfo(5L, "RMNLCU66H20D969W", "Luca", "Romano", LocalDate.of(1966, 6, 20), "M")),
            Map.entry(6L, new PatientInfo(6L, "GLLSFN78M41F839J", "Stefania", "Gallo", LocalDate.of(1978, 8, 1), "F")),
            Map.entry(9L, new PatientInfo(9L, "MRNPLA61S03C351V", "Paolo", "Marino", LocalDate.of(1961, 11, 3), "M")),
            Map.entry(12L, new PatientInfo(12L, "GRCSRA95B62F205N", "Sara", "Greco", LocalDate.of(1995, 2, 22), "F"))));

    @Override
    public Optional<PatientInfo> patient(long id) {
        return Optional.ofNullable(patients.get(id));
    }

    @Override
    public List<PatientInfo> search(String q) {
        String term = q.toLowerCase(Locale.ROOT);
        return patients.values().stream()
                .filter(p -> p.lastName().toLowerCase(Locale.ROOT).contains(term) || p.fiscalCode().toLowerCase(Locale.ROOT).contains(term))
                .toList();
    }
}
