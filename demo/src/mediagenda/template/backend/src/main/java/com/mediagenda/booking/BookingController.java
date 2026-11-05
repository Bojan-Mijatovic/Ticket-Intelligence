package com.mediagenda.booking;

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
@RequestMapping("/api/bookings")
public class BookingController {

    private final BookingService service;

    public BookingController(BookingService service) {
        this.service = service;
    }

    /** GET /api/bookings?status=CONFERMATA: newest appointment first; all statuses without the parameter. */
    @GetMapping
    public List<BookingView> list(@RequestParam(required = false) String status) {
        return service.list(status);
    }

    @GetMapping("/{id}")
    public BookingView get(@PathVariable String id) {
        return service.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public BookingView create(@Valid @RequestBody BookingRequest request) {
        return service.create(request);
    }

    /** POST /api/bookings/{id}/cancel {reason}: CONFERMATA → ANNULLATA. */
    @PostMapping("/{id}/cancel")
    public BookingView cancel(@PathVariable String id, @Valid @RequestBody CancelRequest request) {
        return service.cancel(id, request);
    }
}
