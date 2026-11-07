package com.medifarma.safety;

import static org.assertj.core.api.Assertions.assertThat;

import com.medifarma.integration.FakeMediLabClient;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class SafetyServiceTest {

    static final String METFORMINA = "012345016";
    static final String RAMIPRIL = "023456018";
    static final String ENOXAPARINA = "034567010";
    static final String IBUPROFENE = "056789014";
    static final String WARFARIN = "067890016";
    static final String PARACETAMOLO = "089012010";

    @Autowired
    SafetyService service;

    @Autowired
    FakeMediLabClient mediLab;

    @AfterEach
    void defaults() {
        mediLab.reset();
    }

    @Test
    void metforminIsContraindicatedBelowAnEgfrOf30() {
        // Marino Paolo (M, 1961): creatinine 221 µmol/L in MediLab = 2,50 mg/dL → eGFR about 28.
        SafetyCheck check = service.check(new SafetyRequest(9L, List.of(METFORMINA, ENOXAPARINA)));
        assertThat(check.egfr()).isBetween(26, 30);
        assertThat(check.creatinineUnit()).isEqualTo("µmol/L");
        assertThat(check.warnings()).extracting(Warning::drug, Warning::severity)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("Metformina 500 mg compresse", Warning.ALTA),
                        org.assertj.core.groups.Tuple.tuple("Enoxaparina 4000 UI siringhe", Warning.MEDIA));
    }

    @Test
    void normalKidneyFunctionGivesNoRenalWarning() {
        SafetyCheck check = service.check(new SafetyRequest(1L, List.of(METFORMINA)));
        assertThat(check.egfr()).isGreaterThan(90);
        assertThat(check.warnings()).isEmpty();
    }

    @Test
    void interactionsAreFoundInEitherOrder() {
        assertThat(service.check(new SafetyRequest(1L, List.of(WARFARIN, IBUPROFENE))).warnings())
                .extracting(Warning::type, Warning::severity).containsExactly(org.assertj.core.groups.Tuple.tuple("INTERAZIONE", Warning.ALTA));
        assertThat(service.check(new SafetyRequest(1L, List.of(IBUPROFENE, WARFARIN, RAMIPRIL))).warnings())
                .extracting(Warning::severity).containsExactly(Warning.ALTA, Warning.MEDIA);
    }

    @Test
    void withoutACreatinineTheRenalCheckIsSkippedNotFailed() {
        // Ferrari Giulia has no validated creatinine in MediLab.
        SafetyCheck check = service.check(new SafetyRequest(4L, List.of(METFORMINA, PARACETAMOLO)));
        assertThat(check.egfr()).isNull();
        assertThat(check.warnings()).extracting(Warning::type).containsExactly("INFO");
    }
}
