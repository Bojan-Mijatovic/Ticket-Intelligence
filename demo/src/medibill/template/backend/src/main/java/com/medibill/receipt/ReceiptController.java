package com.medibill.receipt;

import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/receipts")
public class ReceiptController {

    private final ReceiptService service;

    public ReceiptController(ReceiptService service) {
        this.service = service;
    }

    @GetMapping
    public List<ReceiptView> list(@RequestParam(required = false) String status) {
        return service.list(status);
    }

    @GetMapping("/{id}")
    public ReceiptView get(@PathVariable String id) {
        return service.get(id);
    }

    /** POST /api/receipts { fiscalCode }: one receipt for every open charge of the patient. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ReceiptView issue(@Valid @RequestBody ReceiptRequest request) {
        return service.issue(request);
    }

    @PostMapping("/{id}/pay")
    public ReceiptView pay(@PathVariable String id) {
        return service.pay(id);
    }

    @PostMapping("/{id}/storno")
    public ReceiptView storno(@PathVariable String id) {
        return service.storno(id);
    }
}
