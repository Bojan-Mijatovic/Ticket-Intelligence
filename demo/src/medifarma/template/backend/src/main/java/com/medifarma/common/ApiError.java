package com.medifarma.common;

import java.time.Instant;
import java.util.List;

/** Error body returned by every endpoint (same shape as the other applications of the suite). */
public record ApiError(Instant timestamp, int status, String error, List<String> details) {

    public static ApiError of(int status, String error, List<String> details) {
        return new ApiError(Instant.now(), status, error, details);
    }
}
