package com.mediagenda.timeslot;

import java.time.DayOfWeek;
import java.util.Map;

/** Weekday names as stored in time_slots.weekday ("lunedì" … "domenica"). */
public final class Weekdays {

    private static final Map<DayOfWeek, String> ITALIAN = Map.of(
            DayOfWeek.MONDAY, "lunedì",
            DayOfWeek.TUESDAY, "martedì",
            DayOfWeek.WEDNESDAY, "mercoledì",
            DayOfWeek.THURSDAY, "giovedì",
            DayOfWeek.FRIDAY, "venerdì",
            DayOfWeek.SATURDAY, "sabato",
            DayOfWeek.SUNDAY, "domenica");

    private Weekdays() {}

    public static String italian(DayOfWeek day) {
        return ITALIAN.get(day);
    }

    public static DayOfWeek fromItalian(String weekday) {
        return ITALIAN.entrySet().stream()
                .filter(e -> e.getValue().equals(weekday))
                .map(Map.Entry::getKey)
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("unknown weekday: " + weekday));
    }
}
