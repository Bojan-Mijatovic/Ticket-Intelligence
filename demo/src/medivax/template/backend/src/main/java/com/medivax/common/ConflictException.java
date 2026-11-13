package com.medivax.common;

/** The request conflicts with the rules or the current state (409), e.g. a dose before its interval. */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
