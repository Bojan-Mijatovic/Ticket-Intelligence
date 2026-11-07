package com.medibill.report;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.YearMonth;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class ReportControllerTest {

    @Autowired
    ReportController reports;

    @Test
    void theMonthlyReportLeavesOutCancelledReceipts() {
        // October: RC-2026-00038 (paid 22,50 €), RC-2026-00041 (issued 15,49 €); RC-2026-00039 was cancelled.
        MonthlyReport october = reports.monthly(YearMonth.of(2026, 10));
        assertThat(october.receipts()).isEqualTo(2);
        assertThat(october.copay()).isEqualByComparingTo("37.99");
        assertThat(october.collected()).isEqualByComparingTo("22.50");
        assertThat(october.byStatus()).containsOnlyKeys("EMESSA", "PAGATA");
    }
}
