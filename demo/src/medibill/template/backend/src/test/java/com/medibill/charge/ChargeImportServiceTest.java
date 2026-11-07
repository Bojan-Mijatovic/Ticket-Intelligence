package com.medibill.charge;

import static org.assertj.core.api.Assertions.assertThat;

import com.medibill.integration.FakeMediLabClient;
import com.medibill.integration.LabOrderInfo;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class ChargeImportServiceTest {

    @Autowired
    ChargeImportService importer;

    @Autowired
    ChargeRepository charges;

    @Autowired
    FakeMediLabClient mediLab;

    @AfterEach
    void defaults() {
        mediLab.reset();
    }

    private List<Charge> of(String fiscalCode) {
        return charges.findByFiscalCodeIgnoreCaseAndStatusOrderByServiceDateAscIdAsc(fiscalCode, Charge.APERTO);
    }

    @Test
    void importsTheVisitsOfADayAtTheTariffOfTheProvider() {
        ImportResult r = importer.importDay(LocalDate.of(2026, 11, 4));
        assertThat(r.visits()).isEqualTo(1);
        assertThat(of("FRRGLI90E50A794K")).extracting(Charge::getTariffCode, Charge::getAmount)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("95.02", new java.math.BigDecimal("22.50")));
    }

    @Test
    void importingADayTwiceChargesOnce() {
        ImportResult first = importer.importDay(LocalDate.of(2026, 11, 5));
        ImportResult again = importer.importDay(LocalDate.of(2026, 11, 5));
        assertThat(first.visits()).isEqualTo(2);
        assertThat(again.visits()).isZero();
        assertThat(again.alreadyImported()).isEqualTo(2);
        assertThat(of("FNTCHR88R55G273T")).hasSize(2);
        // MS_ALLERGOLOGIA has no tariff: skipped, both times.
        assertThat(again.skipped()).singleElement().asString().contains("MS_ALLERGOLOGIA");
    }

    @Test
    void importsTheTestsReportedInMediLab() {
        ImportResult r = importer.importDay(LocalDate.of(2026, 11, 3));
        assertThat(r.tests()).isEqualTo(5);
        assertThat(of("MRNPLA61S03C351V")).extracting(Charge::getSource).containsOnly(ChargeImportService.LABORATORIO);
    }

    @Test
    void testsAlreadyChargedAreNotChargedAgain() {
        ImportResult r = importer.importDay(LocalDate.of(2026, 11, 2));
        assertThat(r.tests()).isZero();
        assertThat(r.alreadyImported()).isEqualTo(3);
    }

    @Test
    void aTestWithoutTariffIsSkippedNotFailed() {
        mediLab.reported.put(LocalDate.of(2026, 11, 6), List.of(new LabOrderInfo("RL-2026-00099", "RSSMRA80A01F205X", "Rossi Mario", "REFERTATA",
                LocalDateTime.of(2026, 11, 6, 12, 0), List.of(FakeMediLabClient.exam("GLU", "90.27.1"), FakeMediLabClient.exam("VITD", "90.99.9")))));
        ImportResult r = importer.importDay(LocalDate.of(2026, 11, 6));
        assertThat(r.tests()).isEqualTo(1);
        assertThat(r.skipped()).singleElement().asString().contains("90.99.9");
    }
}
