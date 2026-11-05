package com.mediagenda.timeslot;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

/** Body of POST /api/timeslots ("Nuova fascia oraria"): one slot is created per selected weekday. */
public record TimeSlotCreateRequest(
        @NotBlank String resourceCode,
        @NotBlank @Size(max = 120) String agendaName,
        @NotEmpty List<@Pattern(regexp = "lunedì|martedì|mercoledì|giovedì|venerdì|sabato", message = "is not a weekday") String> weekdays,
        @NotNull LocalTime startTime,
        @NotNull LocalTime endTime,
        @NotNull LocalDate startDate,
        @NotNull LocalDate endDate,
        @NotBlank @Pattern(regexp = "^[UBDP]$", message = "must be U, B, D or P") String priority) {}
