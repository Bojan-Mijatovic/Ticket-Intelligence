package com.medifarma.stock;

import com.medifarma.drug.Drug;
import com.medifarma.drug.DrugRepository;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/stock")
public class StockController {

    private final DrugRepository drugs;
    private final LotRepository lots;

    public StockController(DrugRepository drugs, LotRepository lots) {
        this.drugs = drugs;
        this.lots = lots;
    }

    /** GET /api/stock: every active drug with its lots; expired packs do not count as available. */
    @GetMapping
    @Transactional(readOnly = true)
    public List<StockRow> stock() {
        LocalDate today = LocalDate.now();
        Map<String, List<Lot>> byDrug = lots.findAllByOrderByExpiryAsc().stream().collect(Collectors.groupingBy(Lot::getAic));
        return drugs.findByActiveTrueOrderByNameAsc().stream().map(d -> row(d, byDrug.getOrDefault(d.getAic(), List.of()), today)).toList();
    }

    /** GET /api/stock/expiring?days=60: lots with packs left that expire within `days` days (or have expired). */
    @GetMapping("/expiring")
    @Transactional(readOnly = true)
    public List<StockRow> expiring(@RequestParam(defaultValue = "60") int days) {
        LocalDate today = LocalDate.now();
        LocalDate limit = today.plusDays(days);
        return stock().stream()
                .map(r -> new StockRow(r.aic(), r.name(), r.available(), r.minStock(), r.low(),
                        r.lots().stream().filter(l -> l.quantity() > 0 && !l.expiry().isAfter(limit)).toList()))
                .filter(r -> !r.lots().isEmpty())
                .toList();
    }

    private static StockRow row(Drug d, List<Lot> lots, LocalDate today) {
        List<StockRow.LotView> views = lots.stream()
                .map(l -> new StockRow.LotView(l.getLotNumber(), l.getExpiry(), l.getQuantity(), l.isExpiredOn(today), ChronoUnit.DAYS.between(today, l.getExpiry())))
                .toList();
        int available = lots.stream().filter(l -> !l.isExpiredOn(today)).mapToInt(Lot::getQuantity).sum();
        return new StockRow(d.getAic(), d.getName(), available, d.getMinStock(), available < d.getMinStock(), views);
    }
}
