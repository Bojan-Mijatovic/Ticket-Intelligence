package com.medilab.result;

import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/orders/{id}")
public class ResultController {

    private final ResultService service;

    public ResultController(ResultService service) {
        this.service = service;
    }

    @GetMapping("/results")
    public ResultSheet sheet(@PathVariable String id) {
        return service.sheet(id);
    }

    /** PUT /api/orders/{id}/results [{ examCode, value }, …]: values in the unit of the catalog. */
    @PutMapping("/results")
    public ResultSheet save(@PathVariable String id, @RequestBody List<@Valid ResultEntry> entries) {
        return service.save(id, entries);
    }

    @PostMapping("/validate")
    public ResultSheet validate(@PathVariable String id, @Valid @RequestBody ValidateRequest request) {
        return service.validate(id, request);
    }

    @GetMapping("/report")
    public ResultSheet report(@PathVariable String id) {
        return service.report(id);
    }
}
