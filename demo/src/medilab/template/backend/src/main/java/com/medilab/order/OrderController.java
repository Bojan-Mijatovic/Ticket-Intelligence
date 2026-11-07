package com.medilab.order;

import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
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
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderService service;

    public OrderController(OrderService service) {
        this.service = service;
    }

    /** GET /api/orders?status=REFERTATA&q=ross&from=2026-11-02&to=2026-11-02 (all parameters optional). */
    @GetMapping
    public List<OrderView> list(@RequestParam(required = false) String status,
                                @RequestParam(required = false) String q,
                                @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return service.list(status, q, from, to);
    }

    @GetMapping("/{id}")
    public OrderView get(@PathVariable String id) {
        return service.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public OrderView create(@Valid @RequestBody OrderRequest request) {
        return service.create(request);
    }

    /** POST /api/orders/{id}/cancel {reason}: only a request whose samples were not accepted yet. */
    @PostMapping("/{id}/cancel")
    public OrderView cancel(@PathVariable String id, @Valid @RequestBody CancelRequest request) {
        return service.cancel(id, request);
    }
}
