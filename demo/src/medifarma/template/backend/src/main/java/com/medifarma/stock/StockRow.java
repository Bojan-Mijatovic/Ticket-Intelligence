package com.medifarma.stock;

import java.time.LocalDate;
import java.util.List;

/** Stock of one drug ("Magazzino"): usable packs (not expired), the minimum, and its lots. */
public record StockRow(String aic, String name, int available, int minStock, boolean low, List<LotView> lots) {

    public record LotView(String lotNumber, LocalDate expiry, int quantity, boolean expired, long daysLeft) {}
}
