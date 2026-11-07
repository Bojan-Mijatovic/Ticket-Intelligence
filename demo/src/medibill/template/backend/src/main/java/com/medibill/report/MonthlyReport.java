package com.medibill.report;

import java.math.BigDecimal;
import java.util.Map;

/** Receipts of a month ("Report incassi"): count, total at tariff price, exempt part, co-pay issued and collected. */
public record MonthlyReport(String month, int receipts, BigDecimal total, BigDecimal exempt, BigDecimal copay, BigDecimal collected, Map<String, Integer> byStatus) {}
