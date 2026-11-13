package com.medivax.lot;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/lots")
public class LotController {

    private final LotRepository lots;

    public LotController(LotRepository lots) {
        this.lots = lots;
    }

    /** The lots of a vaccine, the one that expires first first (it should be used first). */
    @GetMapping
    public List<Lot> list(@RequestParam String vaccine) {
        return lots.findByVaccineCodeOrderByExpiry(vaccine);
    }
}
