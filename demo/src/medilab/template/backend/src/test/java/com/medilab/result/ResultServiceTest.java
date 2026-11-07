package com.medilab.result;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.medilab.common.ConflictException;
import com.medilab.order.OrderStatus;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class ResultServiceTest {

    @Autowired
    ResultService service;

    private static ResultEntry entry(String code, String value) {
        return new ResultEntry(code, new BigDecimal(value));
    }

    private static ResultSheet.Row row(ResultSheet sheet, String code) {
        return sheet.rows().stream().filter(r -> r.examCode().equals(code)).findFirst().orElseThrow();
    }

    @Test
    void flagsWithTheRangeOfThePatientsSex() {
        // RL-2026-00058: Ferrari Giulia (F). ALT 38 is above the female range (≤ 33), inside the male one (≤ 41).
        ResultSheet woman = service.save("RL-2026-00058", List.of(entry("ALT", "38"), entry("GLU", "88")));
        assertThat(row(woman, "ALT").flag()).isEqualTo(Flags.HIGH);
        assertThat(row(woman, "ALT").refMax()).isEqualByComparingTo("33");
        assertThat(row(woman, "GLU").flag()).isEqualTo(Flags.NORMAL);

        // RL-2026-00060: Romano Luca (M). Hb 13.0 is below the male range (≥ 13.5), inside the female one.
        ResultSheet man = service.save("RL-2026-00060", List.of(entry("HB", "13.0")));
        assertThat(row(man, "HB").flag()).isEqualTo(Flags.LOW);
    }

    @Test
    void roundsToTheDecimalsOfTheCatalog() {
        ResultSheet sheet = service.save("RL-2026-00060", List.of(entry("K", "4.26")));
        assertThat(row(sheet, "K").value()).isEqualByComparingTo("4.3");
        assertThat(row(sheet, "K").unit()).isEqualTo("mmol/L");
    }

    @Test
    void resultsOfARequestThatIsNotInWorkCannotBeEntered() {
        assertThatThrownBy(() -> service.save("RL-2026-00061", List.of(entry("GLU", "90")))).isInstanceOf(ConflictException.class);
    }

    @Test
    void validationNeedsAValueForEveryTest() {
        service.save("RL-2026-00058", List.of(entry("GLU", "88")));
        assertThatThrownBy(() -> service.validate("RL-2026-00058", new ValidateRequest("Dr.ssa Anna Ferri")))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("ALT, AST, CREA");
    }

    @Test
    void validationReportsTheRequest() {
        service.save("RL-2026-00060", List.of(entry("K", "4.2"), entry("NA", "140"), entry("CREA", "0.95"), entry("HB", "14.1")));
        ResultSheet report = service.validate("RL-2026-00060", new ValidateRequest("Dr. Carlo Riva"));
        assertThat(report.status()).isEqualTo(OrderStatus.REFERTATA);
        assertThat(report.validatedBy()).isEqualTo("Dr. Carlo Riva");
        assertThat(service.report("RL-2026-00060").rows()).hasSize(4);
    }

    @Test
    void patientResultsAreValidatedAndCarryTheirUnit() {
        List<PatientResult> crea = service.ofPatient("MRNPLA61S03C351V", "CREA");
        assertThat(crea).hasSize(1);
        assertThat(crea.get(0).value()).isEqualByComparingTo("2.50");
        assertThat(crea.get(0).unit()).isEqualTo("mg/dL");
        assertThat(crea.get(0).flag()).isEqualTo(Flags.HIGH);

        service.save("RL-2026-00058", List.of(entry("CREA", "0.80")));
        assertThat(service.ofPatient("FRRGLI90E50A794K", null)).isEmpty(); // entered, not validated yet
    }
}
