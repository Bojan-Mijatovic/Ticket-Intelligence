package com.medibill.report;

import com.medibill.receipt.Receipt;
import com.medibill.receipt.ReceiptRepository;
import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/reports")
public class ReportController {

    private final ReceiptRepository receipts;

    public ReportController(ReceiptRepository receipts) {
        this.receipts = receipts;
    }

    /** GET /api/reports/monthly?month=2026-10: receipts issued in the month; cancelled (STORNATA) ones do not count. */
    @GetMapping("/monthly")
    @Transactional(readOnly = true)
    public MonthlyReport monthly(@RequestParam @DateTimeFormat(pattern = "yyyy-MM") YearMonth month) {
        List<Receipt> list = receipts.findAllByOrderByIssuedAtDesc().stream()
                .filter(r -> YearMonth.from(r.getIssuedAt()).equals(month))
                .filter(r -> !Receipt.STORNATA.equals(r.getStatus()))
                .toList();
        Map<String, Integer> byStatus = new TreeMap<>();
        list.forEach(r -> byStatus.merge(r.getStatus(), 1, Integer::sum));
        return new MonthlyReport(month.toString(), list.size(),
                sum(list, Receipt::getTotal), sum(list, Receipt::getExempt), sum(list, Receipt::getCopay),
                sum(list.stream().filter(r -> Receipt.PAGATA.equals(r.getStatus())).toList(), Receipt::getCopay), byStatus);
    }

    private static BigDecimal sum(List<Receipt> list, java.util.function.Function<Receipt, BigDecimal> field) {
        return list.stream().map(field).reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
