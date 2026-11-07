package com.medifarma.drug;

import com.medifarma.common.NotFoundException;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/drugs")
public class DrugController {

    private final DrugRepository drugs;

    public DrugController(DrugRepository drugs) {
        this.drugs = drugs;
    }

    /** GET /api/drugs?q=metf: active drugs by name; q matches the name or the active ingredient. */
    @GetMapping
    public List<Drug> list(@RequestParam(defaultValue = "") String q) {
        String term = q.trim();
        return term.isEmpty()
                ? drugs.findByActiveTrueOrderByNameAsc()
                : drugs.findByActiveTrueAndNameContainingIgnoreCaseOrActiveTrueAndActiveIngredientContainingIgnoreCaseOrderByNameAsc(term, term);
    }

    @GetMapping("/{aic}")
    public Drug get(@PathVariable String aic) {
        return drugs.findById(aic).orElseThrow(() -> new NotFoundException("Drug", aic));
    }
}
