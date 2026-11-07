package com.medibill.tariff;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/tariffs")
public class TariffController {

    private final TariffRepository tariffs;

    public TariffController(TariffRepository tariffs) {
        this.tariffs = tariffs;
    }

    /** GET /api/tariffs: the active tariffs, visits first. */
    @GetMapping
    public List<Tariff> list() {
        return tariffs.findByActiveTrueOrderByKindAscCodeAsc();
    }
}
