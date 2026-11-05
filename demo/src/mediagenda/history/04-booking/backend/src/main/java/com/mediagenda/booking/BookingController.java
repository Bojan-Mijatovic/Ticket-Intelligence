package com.mediagenda.booking;

import com.mediagenda.common.NotFoundException;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/bookings")
public class BookingController {

    private final BookingRepository bookings;

    public BookingController(BookingRepository bookings) {
        this.bookings = bookings;
    }

    @GetMapping
    public List<Booking> list() {
        return bookings.findAllByOrderByAppointmentAtDesc();
    }

    @GetMapping("/{id}")
    public Booking get(@PathVariable String id) {
        return bookings.findById(id).orElseThrow(() -> new NotFoundException("Booking", id));
    }
}
