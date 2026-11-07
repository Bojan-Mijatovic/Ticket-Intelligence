package com.medilab.sample;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/samples")
public class SampleController {

    private final SampleService service;

    public SampleController(SampleService service) {
        this.service = service;
    }

    /** GET /api/samples/LB00000850: the scanned tube (barcodes are upper case, as printed on the label). */
    @GetMapping("/{barcode}")
    public SampleView get(@PathVariable String barcode) {
        return service.get(barcode);
    }

    @PostMapping("/{barcode}/accept")
    public SampleView accept(@PathVariable String barcode) {
        return service.accept(barcode);
    }

    @PostMapping("/{barcode}/reject")
    public SampleView reject(@PathVariable String barcode, @Valid @RequestBody RejectRequest request) {
        return service.reject(barcode, request);
    }
}
