package com.medibill.common;

/** The request conflicts with the current state (409), e.g. paying a receipt that was paid already. */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
