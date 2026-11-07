package com.medibill.integration;

import com.medibill.common.PeerUnavailableException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/**
 * MediAgenda for the tests: patients of the MediAgenda seed and the bookings its GET /api/bookings returns, no HTTP.
 * {@link #down} makes every call fail as if MediAgenda did not answer; {@link #reset()} restores the bookings ({@link #bookingList}).
 */
@Component
@Primary
public class FakeMediAgendaClient implements MediAgendaClient {

    public boolean down = false;
    public final List<BookingInfo> bookingList = new ArrayList<>();

    private final Map<Long, PatientInfo> patients = new TreeMap<>(Map.ofEntries(
            Map.entry(1L, new PatientInfo(1L, "RSSMRA80A01F205X", "Mario", "Rossi", LocalDate.of(1980, 1, 1), "M")),
            Map.entry(2L, new PatientInfo(2L, "BNCLRA85C45L219Y", "Laura", "Bianchi", LocalDate.of(1985, 3, 5), "F")),
            Map.entry(3L, new PatientInfo(3L, "VRDGPP72D12H501Z", "Giuseppe", "Verdi", LocalDate.of(1972, 4, 12), "M")),
            Map.entry(4L, new PatientInfo(4L, "FRRGLI90E50A794K", "Giulia", "Ferrari", LocalDate.of(1990, 5, 10), "F")),
            Map.entry(5L, new PatientInfo(5L, "RMNLCU66H20D969W", "Luca", "Romano", LocalDate.of(1966, 6, 20), "M")),
            Map.entry(8L, new PatientInfo(8L, "FNTCHR88R55G273T", "Chiara", "Fontana", LocalDate.of(1988, 10, 15), "F")),
            Map.entry(9L, new PatientInfo(9L, "MRNPLA61S03C351V", "Paolo", "Marino", LocalDate.of(1961, 11, 3), "M")),
            Map.entry(11L, new PatientInfo(11L, "BRNMTT83A15B157R", "Matteo", "Bruno", LocalDate.of(1983, 1, 15), "M"))));

    public FakeMediAgendaClient() {
        reset();
    }

    public void reset() {
        down = false;
        bookingList.clear();
        bookingList.add(visit("PR-2026-00412", "2026-09-07T09:20", "COMPLETATA", 1, "MS_DERMATOLOGIA"));
        bookingList.add(visit("PR-2026-00498", "2026-10-06T10:00", "COMPLETATA", 2, "MS_ORTOPEDIA"));
        bookingList.add(visit("PR-2026-00533", "2026-10-19T08:40", "COMPLETATA", 3, "TG_RADIOLOGIA"));
        bookingList.add(visit("PR-2026-00561", "2026-11-04T09:30", "CONFERMATA", 4, "LO_OCULISTICA"));
        bookingList.add(visit("PR-2026-00581", "2026-11-05T09:00", "CONFERMATA", 8, "MS_DERMATOLOGIA"));
        bookingList.add(visit("PR-2026-00582", "2026-11-05T10:30", "CONFERMATA", 8, "MS_ORTOPEDIA"));
        bookingList.add(visit("PR-2026-00583", "2026-11-05T11:00", "CONFERMATA", 11, "MS_ALLERGOLOGIA"));
        bookingList.add(visit("PR-2026-00584", "2026-11-06T09:00", "CONFERMATA", 2, "MS_DERMATOLOGIA"));
        bookingList.add(visit("PR-2026-00570", "2026-11-10T14:00", "CONFERMATA", 5, "CA_CARDIOLOGIA"));
        bookingList.add(visit("PR-2026-00575", "2026-11-16T08:00", "CONFERMATA", 1, "TG_LABORATORIO"));
    }

    /** A booking as MediAgenda's BookingView has it. */
    public BookingInfo visit(String id, String at, String status, long patientId, String resourceCode) {
        PatientInfo p = patients.get(patientId);
        return new BookingInfo(id, LocalDateTime.parse(at), status, patientId, p.displayName(), p.fiscalCode(), "AMBULATORIO " + resourceCode, resourceCode, null);
    }

    @Override
    public Optional<PatientInfo> patient(long id) {
        if (down) throw new PeerUnavailableException("MediAgenda", new java.net.ConnectException("Connection refused"));
        return Optional.ofNullable(patients.get(id));
    }

    @Override
    public List<PatientInfo> search(String q) {
        if (down) throw new PeerUnavailableException("MediAgenda", new java.net.ConnectException("Connection refused"));
        String term = q.toLowerCase(Locale.ROOT);
        return patients.values().stream()
                .filter(p -> p.lastName().toLowerCase(Locale.ROOT).contains(term) || p.fiscalCode().toLowerCase(Locale.ROOT).contains(term))
                .toList();
    }

    @Override
    public List<BookingInfo> bookings() {
        if (down) throw new PeerUnavailableException("MediAgenda", new java.net.ConnectException("Connection refused"));
        return List.copyOf(bookingList);
    }
}
