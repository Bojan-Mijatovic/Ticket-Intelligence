package com.medilab.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.medilab.common.BadRequestException;
import com.medilab.common.ConflictException;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class OrderServiceTest {

    @Autowired
    OrderService service;

    private static OrderRequest request(long patientId, String... exams) {
        return new OrderRequest(patientId, "Dr. Marco Fumagalli", "0301a4000556677", false, List.of(exams));
    }

    @Test
    void createsARequestWithOneTubePerSampleType() {
        OrderView o = service.create(request(9, "CREA", "HB", "GLU"));
        assertThat(o.id()).matches("RL-\\d{4}-\\d{5}");
        assertThat(o.status()).isEqualTo(OrderStatus.RICHIESTA);
        assertThat(o.patientName()).isEqualTo("Marino Paolo");
        assertThat(o.fiscalCode()).isEqualTo("MRNPLA61S03C351V");
        assertThat(o.prescriptionCode()).isEqualTo("0301A4000556677");
        assertThat(o.exams()).extracting(OrderView.ExamRef::code).containsExactly("CREA", "GLU", "HB");
        assertThat(o.samples()).extracting(OrderView.SampleRef::sampleType).containsExactlyInAnyOrder("SIERO", "SANGUE");
        assertThat(o.samples()).allSatisfy(s -> assertThat(s.barcode()).matches("LB\\d{8}"));
    }

    @Test
    void aTestChosenTwiceIsDoneOnce() {
        OrderView o = service.create(request(2, "GLU", "glu", "TSH"));
        assertThat(o.exams()).extracting(OrderView.ExamRef::code).containsExactly("GLU", "TSH");
    }

    @Test
    void rejectsAPatientThatIsNotInMediAgenda() {
        assertThatThrownBy(() -> service.create(request(999, "GLU")))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("not in the MediAgenda registry");
    }

    @Test
    void rejectsATestThatIsNotInTheCatalog() {
        assertThatThrownBy(() -> service.create(request(1, "GLU", "XYZ")))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("XYZ");
    }

    @Test
    void cancelsAWaitingRequestAndItsTubes() {
        OrderView o = service.cancel("RL-2026-00061", new CancelRequest("Paziente non presentato"));
        assertThat(o.status()).isEqualTo(OrderStatus.ANNULLATA);
        assertThat(o.samples()).extracting(OrderView.SampleRef::status).containsOnly("ANNULLATO");
    }

    @Test
    void aRequestInWorkCannotBeCancelled() {
        assertThatThrownBy(() -> service.cancel("RL-2026-00058", new CancelRequest("x")))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void listsTheRequestsReportedOnADay() {
        List<OrderView> day = service.list(OrderStatus.REFERTATA, null, LocalDate.of(2026, 11, 2), LocalDate.of(2026, 11, 2));
        assertThat(day).extracting(OrderView::id).containsExactly("RL-2026-00055");
        assertThat(day.get(0).exams()).extracting(OrderView.ExamRef::tariffCode).contains("90.62.2");
    }

    @Test
    void searchesByPatientNameOrFiscalCode() {
        assertThat(service.list(null, "marino", null, null)).extracting(OrderView::id).containsExactly("RL-2026-00052");
        assertThat(service.list("", "frrgli", null, null)).extracting(OrderView::id).containsExactly("RL-2026-00058");
    }
}
