package com.medivax.common;

import java.time.LocalDate;
import java.time.Period;
import java.time.format.DateTimeFormatter;

/** Ages and dates as the vaccination schedule counts them. */
public final class Ages {

    private static final DateTimeFormatter ITALIAN = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    private Ages() {}

    /** Whole months from the birth date to `on` (a child is 2 months old on the day it turns 2 months). */
    public static int months(LocalDate birthDate, LocalDate on) {
        return (int) Period.between(birthDate, on).toTotalMonths();
    }

    /** Whole years from the birth date to `on`: the age goes up on the birthday, not on 1 January. */
    public static int years(LocalDate birthDate, LocalDate on) {
        return Period.between(birthDate, on).getYears();
    }

    /** "14/03/2026" for messages the centre's staff read. */
    public static String italian(LocalDate date) {
        return date.format(ITALIAN);
    }
}
