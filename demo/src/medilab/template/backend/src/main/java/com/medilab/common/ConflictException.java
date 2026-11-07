package com.medilab.common;

/** The request conflicts with the current state (409), e.g. accepting a sample that was already accepted. */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
