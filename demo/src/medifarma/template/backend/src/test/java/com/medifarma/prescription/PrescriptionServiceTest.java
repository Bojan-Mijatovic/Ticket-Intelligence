package com.medifarma.prescription;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.medifarma.common.BadRequestException;
import com.medifarma.common.ConflictException;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class PrescriptionServiceTest {

    @Autowired
    PrescriptionService service;

    private static PrescriptionRequest request(long patientId, boolean acknowledge, String... aics) {
        return new PrescriptionRequest(patientId, "Dr. Paolo Brambilla", acknowledge,
                List.of(aics).stream().map(a -> new PrescriptionRequest.Item(a, "1 compressa", "2 volte al giorno", 30, 2)).toList());
    }

    @Test
    void issuesAPrescriptionForAMediAgendaPatient() {
        PrescriptionView rx = service.issue(request(1, false, "101234014"));
        assertThat(rx.id()).matches("RX-\\d{4}-\\d{5}");
        assertThat(rx.status()).isEqualTo(Prescription.EMESSA);
        assertThat(rx.patientName()).isEqualTo("Rossi Mario");
        assertThat(rx.items()).extracting(PrescriptionView.Item::name).containsExactly("Atorvastatina 20 mg compresse");
    }

    @Test
    void highWarningsMustBeAcknowledged() {
        assertThatThrownBy(() -> service.issue(request(9, false, "012345016")))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Metformina");
        PrescriptionView rx = service.issue(request(9, true, "012345016"));
        assertThat(rx.warningsAcknowledged()).isTrue();
        assertThat(rx.egfr()).isBetween(26, 30);
    }

    @Test
    void rejectsAPatientThatIsNotInMediAgenda() {
        assertThatThrownBy(() -> service.issue(request(999, false, "089012010"))).isInstanceOf(BadRequestException.class);
    }

    @Test
    void aDispensedPrescriptionCannotBeCancelled() {
        assertThatThrownBy(() -> service.cancel("RX-2026-00028")).isInstanceOf(ConflictException.class);
        assertThat(service.cancel("RX-2026-00031").status()).isEqualTo(Prescription.ANNULLATA);
    }
}
