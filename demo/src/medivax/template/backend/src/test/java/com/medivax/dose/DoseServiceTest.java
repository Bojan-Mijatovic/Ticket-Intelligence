package com.medivax.dose;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.medivax.common.BadRequestException;
import com.medivax.common.ConflictException;
import com.medivax.lot.LotRepository;
import com.medivax.patient.Patient;
import com.medivax.patient.PatientRepository;
import java.time.LocalDate;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

// The vaccines and lots come from the Flyway seed (V2, V3); the patients are made here.
@SpringBootTest
@Transactional
class DoseServiceTest {

    @Autowired
    DoseService service;

    @Autowired
    PatientRepository patients;

    @Autowired
    LotRepository lots;

    private Patient infant;
    private Patient adult;

    @BeforeEach
    void testPatients() {
        infant = patients.save(new Patient("ZZZNFN26A10H501A", "Prova", "Neonato", "M", LocalDate.of(2026, 1, 10), "Roma"));
        adult = patients.save(new Patient("ZZZDLT80A01H501B", "Prova", "Adulto", "F", LocalDate.of(1980, 1, 1), "Roma"));
    }

    private DoseView give(Patient p, String vaccine, LocalDate on, String lot) {
        return service.record(new DoseRequest(p.getId(), vaccine, on, lot));
    }

    @Test
    void theDosesOfASeriesAreNumberedInOrder() {
        assertThat(give(infant, "ESA", LocalDate.of(2026, 3, 10), "ESA-25B").doseNumber()).isEqualTo(1);
        assertThat(give(infant, "ESA", LocalDate.of(2026, 5, 9), "ESA-25B").doseNumber()).isEqualTo(2);
    }

    @Test
    void aDoseBeforeItsIntervalIsRefused() {
        give(infant, "ESA", LocalDate.of(2026, 3, 10), "ESA-25B");
        assertThatThrownBy(() -> give(infant, "ESA", LocalDate.of(2026, 5, 8), "ESA-25B"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("not before 09/05/2026");
    }

    @Test
    void aChildTooYoungForTheVaccineIsRefused() {
        assertThatThrownBy(() -> give(infant, "ESA", LocalDate.of(2026, 3, 9), "ESA-25B"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("from 2 months");
    }

    @Test
    void aPatientOverTheAgeLimitIsRefused() {
        assertThatThrownBy(() -> give(adult, "HPV", LocalDate.of(2026, 10, 1), "HPV-25D"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("up to 26 years");
    }

    @Test
    void aLotCanBeUsedOnItsExpiryDayButNotAfter() {
        assertThat(give(infant, "ESA", LocalDate.of(2026, 11, 30), "ESA-25A").lotCode()).isEqualTo("ESA-25A");
        Patient other = patients.save(new Patient("ZZZLTR26A05H501C", "Prova", "Lotto", "F", LocalDate.of(2026, 1, 5), "Roma"));
        assertThatThrownBy(() -> give(other, "ESA", LocalDate.of(2026, 12, 1), "ESA-25A"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("expired on 30/11/2026");
    }

    @Test
    void anEmptyLotIsRefused() {
        assertThatThrownBy(() -> give(infant, "ESA", LocalDate.of(2026, 3, 10), "ESA-24A"))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void aLotOfAnotherVaccineIsRefused() {
        assertThatThrownBy(() -> give(infant, "ESA", LocalDate.of(2026, 3, 10), "MPRV-25C"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("not a lot of ESA");
    }

    @Test
    void theLotLosesTheDoseGiven() {
        int before = lots.findById("TDAP-26A").orElseThrow().getDosesLeft();
        give(adult, "TDAP", LocalDate.of(2026, 10, 1), "TDAP-26A");
        assertThat(lots.findById("TDAP-26A").orElseThrow().getDosesLeft()).isEqualTo(before - 1);
    }

    @Test
    void aCompleteSeriesWithoutBoosterIsRefused() {
        Patient older = patients.save(new Patient("ZZZPCV50A01H501D", "Prova", "Anziano", "M", LocalDate.of(1950, 1, 1), "Roma"));
        give(older, "PCV", LocalDate.of(2026, 2, 1), "PCV-26C");
        assertThatThrownBy(() -> give(older, "PCV", LocalDate.of(2026, 10, 1), "PCV-26C"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("complete");
    }

    @Test
    void theCardShowsTheNextDose() {
        give(infant, "ESA", LocalDate.of(2026, 3, 10), "ESA-25B");
        PatientCard card = service.card(infant.getId());
        assertThat(card.doses()).hasSize(1);
        assertThat(card.next()).singleElement().satisfies(n -> {
            assertThat(n.doseNumber()).isEqualTo(2);
            assertThat(n.dueOn()).isEqualTo(LocalDate.of(2026, 5, 9));
        });
    }
}
