package com.medifarma.dispensing;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/prescriptions/{id}")
public class DispensingController {

    private final DispensingService service;

    public DispensingController(DispensingService service) {
        this.service = service;
    }

    /** POST /api/prescriptions/{id}/dispense: hands the prescription out from stock (FEFO). */
    @PostMapping("/dispense")
    public DispensingView dispense(@PathVariable String id) {
        return service.dispense(id);
    }

    @GetMapping("/dispensings")
    public List<DispensingView> list(@PathVariable String id) {
        return service.ofPrescription(id);
    }
}
