package com.medifarma.common;

/** The request conflicts with the current state (409), e.g. dispensing a prescription that was dispensed already. */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
