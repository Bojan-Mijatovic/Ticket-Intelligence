package com.medivax.vaccine;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/vaccines")
public class VaccineController {

    private final VaccineRepository vaccines;

    public VaccineController(VaccineRepository vaccines) {
        this.vaccines = vaccines;
    }

    @GetMapping
    public List<Vaccine> list() {
        return vaccines.findAllByOrderByName();
    }
}
