package com.mediagenda.common;

import java.time.Instant;
import java.util.List;

/** Error body returned by every endpoint. */
public record ApiError(Instant timestamp, int status, String error, List<String> details) {

    public static ApiError of(int status, String error, List<String> details) {
        return new ApiError(Instant.now(), status, error, details);
    }
}
