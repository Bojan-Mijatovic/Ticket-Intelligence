package com.medibill.exemption;

import jakarta.validation.Valid;
import java.util.Arrays;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/exemptions")
public class ExemptionController {

    /** An exemption code the form can choose. */
    public record TypeView(String code, String description, boolean total) {}

    private final ExemptionService service;

    public ExemptionController(ExemptionService service) {
        this.service = service;
    }

    @GetMapping
    public List<Exemption> list() {
        return service.list();
    }

    @GetMapping("/types")
    public List<TypeView> types() {
        return Arrays.stream(ExemptionType.values()).map(t -> new TypeView(t.code(), t.description(), t.total())).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Exemption register(@Valid @RequestBody ExemptionRequest request) {
        return service.register(request);
    }
}
