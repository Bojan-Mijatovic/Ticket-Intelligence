package com.medifarma.prescription;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.medifarma.common.BadRequestException;
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

    private static PrescriptionRequest request(long patientId, String... aics) {
        return new PrescriptionRequest(patientId, "Dr. Paolo Brambilla",
                List.of(aics).stream().map(a -> new PrescriptionRequest.Item(a, "1 compressa", "2 volte al giorno", 30, 2)).toList());
    }

    @Test
    void issuesAPrescriptionForAMediAgendaPatient() {
        PrescriptionView rx = service.issue(request(3, "101234014"));
        assertThat(rx.id()).matches("RX-\\d{4}-\\d{5}");
        assertThat(rx.status()).isEqualTo(Prescription.EMESSA);
        assertThat(rx.patientName()).isEqualTo("Verdi Giuseppe");
        assertThat(rx.items()).extracting(PrescriptionView.Item::name).containsExactly("Atorvastatina 20 mg compresse");
    }

    @Test
    void rejectsAPatientThatIsNotInMediAgenda() {
        assertThatThrownBy(() -> service.issue(request(999, "089012010"))).isInstanceOf(BadRequestException.class);
    }

    @Test
    void rejectsADrugThatIsNotInTheFormulary() {
        assertThatThrownBy(() -> service.issue(request(1, "999999999"))).isInstanceOf(BadRequestException.class);
    }
}
