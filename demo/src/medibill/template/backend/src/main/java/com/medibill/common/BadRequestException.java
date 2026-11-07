package com.medibill.common;

/** A request that is well-formed but not allowed (400), e.g. an exemption that ends before it starts. */
public class BadRequestException extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }
}
