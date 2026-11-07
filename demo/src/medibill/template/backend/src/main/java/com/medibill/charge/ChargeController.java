package com.medibill.charge;

import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/charges")
public class ChargeController {

    private final ChargeRepository charges;
    private final ChargeImportService importer;

    public ChargeController(ChargeRepository charges, ChargeImportService importer) {
        this.charges = charges;
        this.importer = importer;
    }

    /** GET /api/charges?status=APERTO: newest service first; all without the parameter. */
    @GetMapping
    @Transactional(readOnly = true)
    public List<Charge> list(@RequestParam(required = false) String status) {
        return charges.findAllByOrderByServiceDateDescIdAsc().stream()
                .filter(c -> status == null || status.isBlank() || status.equalsIgnoreCase(c.getStatus()))
                .toList();
    }

    /** POST /api/charges/import?date=2026-11-04: the visits (MediAgenda) and tests (MediLab) of that day. */
    @PostMapping("/import")
    public ImportResult importDay(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return importer.importDay(date);
    }
}
