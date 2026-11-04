package com.mediagenda.common;

import java.util.List;
import org.springframework.data.domain.Page;

/** Stable JSON shape for paged results (instead of serializing Spring's Page). */
public record PageResponse<T>(List<T> items, int page, int size, long total) {

    public static <T> PageResponse<T> of(Page<T> page) {
        return new PageResponse<>(page.getContent(), page.getNumber(), page.getSize(), page.getTotalElements());
    }
}
