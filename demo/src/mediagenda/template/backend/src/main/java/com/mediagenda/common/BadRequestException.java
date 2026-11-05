package com.mediagenda.common;

/** A business rule rejects the request (checked in a service, not by Bean Validation): HTTP 400. */
public class BadRequestException extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }
}
