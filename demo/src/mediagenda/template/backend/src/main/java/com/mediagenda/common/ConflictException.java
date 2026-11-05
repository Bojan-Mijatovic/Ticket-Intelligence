package com.mediagenda.common;

/** The request is valid but clashes with existing data (e.g. a fiscal code already registered): HTTP 409. */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
