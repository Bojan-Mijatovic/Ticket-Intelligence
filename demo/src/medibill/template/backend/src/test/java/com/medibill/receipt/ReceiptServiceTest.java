package com.medibill.receipt;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.medibill.charge.Charge;
import com.medibill.charge.ChargeImportService;
import com.medibill.charge.ChargeRepository;
import com.medibill.common.ConflictException;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class ReceiptServiceTest {

    @Autowired
    ReceiptService service;

    @Autowired
    ChargeImportService importer;

    @Autowired
    ChargeRepository charges;

    @Test
    void theCopayOfAReceiptIsCapped() {
        importer.importDay(LocalDate.of(2026, 11, 5)); // Fontana Chiara: two visits of 22,50 €
        ReceiptView r = service.issue(new ReceiptRequest("FNTCHR88R55G273T"));
        assertThat(r.total()).isEqualByComparingTo("45.00");
        assertThat(r.copay()).isEqualByComparingTo("36.15");
        assertThat(r.lines()).hasSize(2);
    }

    @Test
    void amountsAreExactToTheCent() {
        ReceiptView r = service.issue(new ReceiptRequest("RSSMRA80A01F205X")); // three tests of 1,13 €
        assertThat(r.copay()).isEqualByComparingTo("3.39");
        assertThat(r.copay().stripTrailingZeros().scale()).isLessThanOrEqualTo(2);
    }

    @Test
    void aDiseaseExemptionCoversItsTariffsOnly() {
        importer.importDay(LocalDate.of(2026, 11, 3)); // Marino Paolo, exemption 013: glucose and HbA1c are free
        ReceiptView r = service.issue(new ReceiptRequest("MRNPLA61S03C351V"));
        assertThat(r.exempt()).isEqualByComparingTo("10.73");
        assertThat(r.copay()).isEqualByComparingTo("3.39");
        assertThat(r.exemptionCodes()).isEqualTo("013");
    }

    @Test
    void anExpiredExemptionDoesNotApply() {
        // Bianchi Laura: E02 ended on 2026-06-30, the visit is of 2026-11-06.
        importer.importDay(LocalDate.of(2026, 11, 6));
        ReceiptView r = service.issue(new ReceiptRequest("BNCLRA85C45L219Y"));
        assertThat(r.exempt()).isEqualByComparingTo("0");
        assertThat(r.exemptionCodes()).isEmpty();
        assertThat(r.copay()).isPositive();
    }

    @Test
    void aTotalExemptionMakesTheReceiptFree() {
        importer.importDay(LocalDate.of(2026, 11, 10)); // Romano Luca, exemption 048
        ReceiptView r = service.issue(new ReceiptRequest("RMNLCU66H20D969W"));
        assertThat(r.copay()).isEqualByComparingTo("0");
        assertThat(r.exemptionCodes()).isEqualTo("048");
    }

    @Test
    void anUnpaidReceiptCanBeCancelledAPaidOneNot() {
        importer.importDay(LocalDate.of(2026, 11, 5));
        ReceiptView issued = service.issue(new ReceiptRequest("FNTCHR88R55G273T"));
        service.storno(issued.id());
        assertThat(charges.findByFiscalCodeIgnoreCaseAndStatusOrderByServiceDateAscIdAsc("FNTCHR88R55G273T", Charge.APERTO)).hasSize(2);

        assertThat(service.pay("RC-2026-00041").status()).isEqualTo(Receipt.PAGATA);
        assertThatThrownBy(() -> service.pay("RC-2026-00041")).isInstanceOf(ConflictException.class);
        assertThatThrownBy(() -> service.storno("RC-2026-00041")).isInstanceOf(ConflictException.class);
    }
}
