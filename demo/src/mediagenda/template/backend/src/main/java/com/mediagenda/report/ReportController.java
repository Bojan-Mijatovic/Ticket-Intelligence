package com.mediagenda.report;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/reports")
public class ReportController {

    public record MonthlyBookings(String month, String structureId, long bookings) {}

    private final JdbcTemplate jdbc;

    public ReportController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Bookings per month and structure. */
    @GetMapping("/monthly-bookings")
    public List<MonthlyBookings> monthlyBookings() {
        return jdbc.query("""
                SELECT FORMATDATETIME(b.appointment_at, 'yyyy-MM') AS month, t.structure_id, COUNT(*) AS bookings
                FROM bookings b JOIN time_slots t ON t.id = b.time_slot_id
                GROUP BY month, t.structure_id
                ORDER BY month, t.structure_id
                """,
                (rs, i) -> new MonthlyBookings(rs.getString("month"), rs.getString("structure_id"), rs.getLong("bookings")));
    }
}
