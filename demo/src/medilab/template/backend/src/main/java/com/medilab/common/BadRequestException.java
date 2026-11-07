package com.medilab.common;

/** A request that is well-formed but not allowed (400), e.g. an exam code that is not in the catalog. */
public class BadRequestException extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }
}
